# Architecture guide

How the system is put together. For the reasoning behind the simulation engine specifically, see
[SIMULATION-LOOP-V1.md](SIMULATION-LOOP-V1.md) — this is the map, that is the argument.

## The shape

```
apps/web            Next.js: pages, API routes, and the services that bind the
                    simulation to the database, the session, and billing
packages/sim        the simulation loop. Pure: no database, no network, no Next
packages/shared     the world's types and rules -- WorldState, facts, authority,
                    characters, material state, and the AI↔code contract
packages/db         Drizzle schema, migrations, and queries
packages/ai         provider adapters and the coin gate
packages/billing    coin accounting
```

The dependency rule that matters: **`packages/sim` depends on `packages/shared` only.** Not on
`@chronica/ai`, which depends on `@chronica/db` — a simulation core that transitively required a
database could not be unit-tested without one. The loop declares a narrow `SimModelPort` and
`apps/web` supplies it, wrapped in the coin gate.

## Source of truth

`WorldState` (`packages/shared/src/world/world-state.ts`) is the authoritative world: one validated
JSON document per game, stored in `game_worlds`. It holds the map, characters, material state
(accounts, forces, offices, obligations), projects, authority grants, diplomacy, and the character
simulation's own layers — beliefs, pressures, relationships, commitments.

Deliberately **not** in it: the fact ledger. What is true and who knows it are different questions,
and the record must be queryable by time and visibility without loading a world.

## Time

`WorldState.instant` (day + minute from the scenario's epoch) is authoritative, and `elapsedStep` is
maintained as exactly `instant.day` — a schema invariant. A "step" is a day, not a turn. Time
advances only inside a burst, through `advanceWorldTo`, which refuses to run backwards.

Scenarios supply a calendar epoch and minimum/maximum span in days. There is no turn counter
anywhere in the system.

## The simulation loop

One player order produces one **burst**. `runSimulationBurst` (`packages/sim/src/burst.ts`):

1. **Catch up.** `runDeterministicTick` applies everything that fell due since the last order —
   revenue (no more than a power's lands can bear, `material/taxation.ts`), wages, project
   milestones, office terms and the elections that refill them (`sim/src/elections.ts`) — with no
   model call.
2. **Orchestrate.** One model call reads a bounded world slice and the order, and returns a
   proposal: deltas, facts, delegations, scheduled events.
3. **Apply.** `applyDeltas` validates and applies it, assigning every id.
4. **Advance.** The world walks to the next moment that matters, ticking as it goes.
5. **Route attention.** Deterministic: who could know, would care, and can act — capped at three.
6. **Cognition.** One batched model call, each actor seeing only what they know.
7. **Stop.** On a decision, accumulated significance, the budget, or the scenario's maximum span.

A Chronicle is then composed from the facts the player could actually have learned.

Everything except steps 2, 6 and the Chronicle is deterministic code. That is what holds a normal
interaction to two-to-four model calls.

## The AI↔code contract

`packages/shared/src/sim/` — a closed discriminated union of 14 delta operations, plus the proposal
shape that both the orchestrator and NPC cognition return. The model never assigns an id (it uses
`local:` handles the engine resolves), never states a date (offsets in days), and never computes a
balance.

A delta that cannot apply is rejected as *friction* and recorded as a fact; the rest of the batch
still applies. A delta beyond the actor's authority is applied anyway and recorded as a *breach*.

## Persistence

Seven tables, split by lifetime rather than by turn (migration `0034_simulation_loop.sql`, and
`0037_delta_audit.sql` for the last):

| Table | Holds |
| --- | --- |
| `game_worlds` | the live world document, one row per game, with a `revision` token |
| `world_facts` | the append-only record, with visibility, discovery and significance |
| `scheduled_events` | the future queue |
| `simulation_bursts` | one run of the loop, for inspection afterwards |
| `chronicle_checkpoints` | what the player was shown |
| `player_decisions` | forks needing the player's own authority |
| `delta_audit` | every act refused, ignored or carried out with a detail the engine filled in; never shown to the player |

`commitBurst` writes all of it in one transaction under one revision bump, behind an advisory lock —
the conversation path writes world state too, and a slow burst must not interleave with a fast
conversation.

`delta_audit` exists because a refusal filed as unreadable (`"reference"`) never reaches the Chronicle,
so an order refused for want of a detail no player would know simply did less than it said, and nobody
saw it. `npm run audit:deltas` ranks what the engine refuses and fills, with ids taken out of the
reasons (`--order` for the order's own acts, `--kind reference` for the unreadable). The fills come
from `packages/sim/src/apply/fill-gaps.ts`: for an actor's own act, a payer that names no account is
his purse (his treasury where the name says public money), and a place that names no province is where
he stands. Never a null, a recipient, a target or a destination.

What no other act fits is an arrangement (`generic_entity_create`), and three things keep that honest:

- **It has a price when it pays.** An arrangement with an income effect costs `VENTURE_PRICE_MONTHS` of
  what it clears each month (income less keep), paid down or bought on credit like a venture, and is kept
  from its owner's account unless somebody else was named. An update pays only for what it adds. Before,
  an income arrangement with no keep was money every month for nothing.
- **An unreadable act of the order's is kept, not dropped.** What is still refused as `"reference"` after
  the repair, if it set something going (a venture, a holding, an income, a project, an arrangement), is
  kept as an arrangement owned by the actor where he stands, at that price
  (`packages/sim/src/apply/keep-as-arrangement.ts`). A payment, a march, a battle or a letter is never
  kept this way: that would put in the world something that did not happen.
- **An order that left nothing is still something he is doing.** If no act of the order was carried out
  and none was refused by the world, and the order was not a question, the burst records a `"pursuit"`
  arrangement labelled with the order's intent: one per person, the latest replacing the last, with no
  effects and no cost. It is what the next order's slice shows him doing.

All three are written to `delta_audit` (kinds `kept` and `pursuit`).

Two faults the first live run of private orders found (`scripts/eval-orders`, chains `trade-rome`,
`trade-syracuse`, `private-life`), and what now stops them:

- **A reference written as a bare id** (`"marcus-metellus"` where `{kind, id}` is wanted) is wrapped with
  its kind from the world, or from what minted the handle in the same answer, before salvage drops
  anything (`packages/sim/src/bare-refs.ts`, in both the orchestrator and cognition parsers). Salvage
  gives up past twelve complaints, and three whole answers in seven were lost to nothing else.
- **The world's business written into the order**: an act of the order's that makes a force or a
  person for another power with the actor nowhere in it (not commanding, answering for or paying it,
  directly or through anything else the order made) is judged as the world's
  (`packages/sim/src/apply/misfiled.ts`, audit kind `refiled`). Left in the order, the Ligurians' new army
  was headlined as a merchant raising men who would not follow him.
- And a fill: the actor's own money paid to no account the world has is money spent (`toAccountRef: null`).

The second run found more, and each is now handled where it arises:

- References written `"character:decius-vibellius"` lose the kind prefix (`normalizeRefs`), and a
  `{kind, id}` written where the id alone was wanted becomes the id (`wrapBareRefs`).
- Parsing puts right and salvages in up to three rounds (`readLeniently`): dropping a gathering's only
  event leaves an empty list, which the next round drops, instead of losing the whole answer.
- A person named in `employeeRef` and never made is made, like any other person named.
- An unreadable private income is kept as what yields it: trade as a one-market venture, land as a
  holding, at those acts' prices; anything else as an arrangement.
- The world does not spend the player's own purse. A world act (not the order's) paying from it is
  refused: a narrator seed asking "who paid for the games" answered "the merchant" and spent the money
  his order needed. The world can still ruin him through what it does to his trade, land and name.

Scenario definitions and their starting worlds live in `scenario_versions`, and those rows are
**immutable**. Changing a scenario file does nothing to an existing database until a new version is
published in `ensureBuiltInScenarios`.

## A world that fills itself in

A scenario is sparse by design: it names polities and territory and leaves the rest to be generated
when history requires it (VISION §4, §5). `packages/sim/src/population.ts` finds countries that hold
land but have no leader or no forces, ranks them by whether the player is dealing with them now,
whether they border us, and how much they hold, and states the gap in the slice. The orchestrator
fills it in the call it was already making — no extra model call, no new contract surface.

Relevance decides *which* countries, and size only orders equals. On a map of 163 peoples a quiet
people holding sixty-four provinces would otherwise outrank the country the player is actually
invading. A country also has to be in contact before the world owes it anyone: reachable across a
border, already named in the facts, or large enough that the powers of the age would reckon with it.
The rest stay names on the map until play arrives — which is the moment the same check starts
returning them.

The slice is therefore **not** filtered to the player's own polity. Foreign secrets are filtered by
the fact ledger; the existence of a neighbour's army is not a secret. But it *is* chosen: every list
has a hard cap, and once the world outgrew those caps the choice stopped being free. Provinces are
ranked by where we are, where we could march next, and what the order names outright — the failure
mode being a model handed thirty arbitrary provinces and left inventing an id for the one it was
asked about.

## Knowledge

`Fact` carries a `visibility` (`public` / `polity` / `private`) and a per-observer discovery ledger
with travel time. Callers should use **`factsKnownTo`**, not `factsVisibleTo`: the latter cannot
resolve polity membership and treats every `polity`-scoped fact as unknown, which silently hid a
government's own dispatches from that government.

## Characters and conversations

The character system (`packages/shared/src/characters/`) models people as people: relationships with
causes, beliefs with provenance, pressures, promises. Conversations run through
`apps/web/lib/dialogue-service.ts`, propose `CharacterSocialEvent`s, and
`applyConversationConsequences` applies them immediately and records them in the fact ledger.

A conversation is not a burst: it costs no simulation model call, does not advance the clock, and
does not wake the world.

`whoSeeksThePlayer` (`packages/sim/src/initiative.ts`) is the trigger for NPC-initiated contact —
deterministic and free, drawn from who owes the ruler an answer, whose promise has come due, and who
is in serious trouble in the ruler's own polity.

## Map

The province graph inside `WorldState.map` is authoritative for control and adjacency. Rendering
geometry is separate, immutable GeoJSON referenced by `scenarioVersions.mapAssetId`.
`apps/web/lib/world-view.ts` projects world state into the overlay the map draws.

That projection reports what the world contains and nothing else, which means the world has to
contain everything the map shows. For a long time it did not: the Punic Wars scenario wrote down
twenty provinces and ten polities while the map drew the western Mediterranean entire, and the
difference was made up by a hardcoded overlay table merged in at render time. When that table stopped
being merged, the rest of the map went blank — there had never been anything behind it.

The whole drawn world is now authored state: 6,321 provinces, 15,117 borders and the 163 peoples who
hold them, over Europe, North Africa and the Near East as far as Iran. The provinces are grown from the settlements alive in
270 BCE and traced on shared vertices by `scripts/map-gen` (see its README and
`docs/plans/imperator-density-map.md`); the same build step writes the province graph, checked in as
`packages/db/src/punic-wars-map-graph.ts`, and the GeoJSON asset. It is a build step because a graph
this size should be reviewable as data rather than recomputed per process. Every province carries its
area and centre, every border its length in kilometres, and every drawn town is a settlement of the world.
`packages/db/src/punic-wars-scenario.ts` takes the graph as its single source and adds only what the
scenario alone knows: the governments, the Roman alliances, the people and the armies, and the two
positions (Etna and the strait) in the province holding Messana. The scenario, its tests and its scripts
spell places through `PUNIC_IDS`, which the builder's anchors keep pointing at the right province.

Two things about that graph are worth knowing. Borders are exact: neighbouring provinces share their
vertices, so adjacency is read from the arcs and not guessed. And the landmasses are joined by a minimum
spanning tree of their shortest crossings, with the strait and sea-lane crossings a fleet needs
(Messana, Otranto, the Gulf of Corinth, Sicily to Africa) added by length, so every crossing is real
geography rather than an artefact of iteration order.

The invariants that make "authoritative" mean something are asserted in
`packages/db/src/punic-wars-scenario.test.ts`, because nothing enforces them at runtime:
`ProvinceGraphSchema` validates ids and settlements but never edges or terrain, so a scenario could
otherwise ship a border to a province that does not exist, or a sea lane out of a landlocked upland,
and the first sign of it would be an army that cannot move.

Some ground belongs to nobody: forty-odd provinces of open desert (desert-steppe with no town, river or
coast, and none within eighty kilometres of one) have `controllerPolityId: null`. Nobody taxes or levies
them (both loop over a power's own provinces), an army may cross and camp on them like any ground, and
`province_control_set` claims one by standing in it or by holding the province next to it, without
plundering anyone. They never generate famine, hunger or unrest facts, nobody flees to them, and a slice
calls them "held by no one". `packages/sim/src/unowned-ground.test.ts` holds each of these.

Carrying the whole map costs a burst a few tens of milliseconds, against several model calls taking
seconds (`scripts/load-check-map.mts`): the opening world is 2.9 MB of JSON (0.47 MB on the old map),
`WorldStateSchema.parse` takes about 60 ms, `ensureProvinceMaterial` 4 ms, `liveProvinceIds` 6 ms, the
world view the client is sent 60 to 100 ms, a 30-day tick of the clock about 0.55 s and a year of them
under 8 s, and the map document the client downloads once is 12.9 MB (built once per version in
under a second, kept after). The Seleucid Empire holds 1,125 provinces and is written about as a power
of a dozen is: `a-thousand-provinces.test.ts` keeps its slice, its chambers and its facts short. What a
map this size actually threatens is not speed but honesty: see the slice and population notes above, both
of which had to start *choosing* once the world stopped being small enough to send whole.

## Development

```bash
npm run typecheck    # all packages
npm run test         # all packages
npm run dev          # the web app
```

`packages/sim`'s tests drive a scripted model port, never a live adapter — a test that can disagree
with itself run-to-run is worth nothing as a regression guard.
