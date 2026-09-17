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
   revenue, wages, project milestones — with no model call.
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

Six tables, split by lifetime rather than by turn (migration `0034_simulation_loop.sql`):

| Table | Holds |
| --- | --- |
| `game_worlds` | the live world document, one row per game, with a `revision` token |
| `world_facts` | the append-only record, with visibility, discovery and significance |
| `scheduled_events` | the future queue |
| `simulation_bursts` | one run of the loop, for inspection afterwards |
| `chronicle_checkpoints` | what the player was shown |
| `player_decisions` | forks needing the player's own authority |

`commitBurst` writes all of it in one transaction under one revision bump, behind an advisory lock —
the conversation path writes world state too, and a slow burst must not interleave with a fast
conversation.

Scenario definitions and their starting worlds live in `scenario_versions`, and those rows are
**immutable**. Changing a scenario file does nothing to an existing database until a new version is
published in `ensureBuiltInScenarios`.

## Characters and conversations

The character system (`packages/shared/src/characters/`) models people as people: relationships with
causes, beliefs with provenance, pressures, promises. Conversations run through
`apps/web/lib/dialogue-service.ts`, propose `CharacterSocialEvent`s, and
`applyConversationConsequences` applies them immediately and records them in the fact ledger.

A conversation is not a burst: it costs no simulation model call, does not advance the clock, and
does not wake the world.

## Map

The province graph inside `WorldState.map` is authoritative for control and adjacency. Rendering
geometry is separate, immutable GeoJSON referenced by `scenarioVersions.mapAssetId`.
`apps/web/lib/world-view.ts` projects world state into the overlay the map draws.

## Development

```bash
npm run typecheck    # all packages
npm run test         # all packages
npm run dev          # the web app
```

`packages/sim`'s tests drive a scripted model port, never a live adapter — a test that can disagree
with itself run-to-run is worth nothing as a regression guard.
