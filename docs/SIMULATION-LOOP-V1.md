# Simulation Loop v1 — what was built, and why

This describes the engine built to satisfy [`docs/VISION.md`](VISION.md) §33, which named
**Simulation Loop v1** as the thing to get right before economy, combat, diplomacy or intrigue are
attempted — so those systems can later plug into one resolution architecture instead of growing
separate incompatible ones.

It is written for whoever picks this up next. It explains the reasoning behind each boundary, not
just the shape, because the shape is recoverable from the code and the reasoning is not.

---

## 1. The problem this had to solve

The previous commit deleted the entire old engine: Chronicle, Orders, Turns, the multi-agent
dispatcher, the Game Master tool-loop, and a workflow-execution registry of roughly 97 tools. That
was deliberate, and it left the repository in a half-state — rich domain types survived, but
**nothing persisted a world at all**. `getWorldView`, `persistOpeningWorld` and `createGame` had all
lived in the deleted `queries/turns.ts`, so game creation and the Chat NPC system were both severed
from their runtime.

So this work had two jobs at once: build the loop, and give the world somewhere to live again.

The design principle it is built to serve:

> The LLM is sovereign over causality. Software is sovereign over memory, arithmetic, scheduling and
> consistency.

Everything below is an attempt to make that sentence load-bearing rather than decorative.

---

## 2. The central decision: a closed transaction contract

**The model never mutates the world. It proposes a transaction, and deterministic code validates,
arbitrates, assigns every id, and applies it atomically.**

The contract lives in `packages/shared/src/sim/`:

- `deltas.ts` — `WorldDeltaSchema`, a discriminated union of **14 operations**. This is the complete
  set of ways the world can change.
- `proposal.ts` — what an actor returns: `narrativeSummary`, `frictions`, `deltas`, `facts`,
  `delegations`, `schedule`. The orchestrator and NPC cognition return the *same* shape.
- `refs.ts` — the `local:` reference scheme.

### Why a closed union rather than a tool registry

The deleted engine gave the model ~97 bespoke workflow tools and still could not keep the books
straight. The lesson taken here is that a **narrow closed set plus one honest escape hatch beats a
wide one**, because every arm of a narrow set can actually be validated. The escape hatch is
`generic_entity_create`, backed by `WorldState.genericEntities` — VISION §9's "dynamically created
mechanics" works by recording a novel institution as a first-class-but-untyped entity, rather than
by having pre-authored a mechanic for it.

### Why the model never supplies an id

A model that invents ids will eventually invent one that does not exist, and a hallucinated id that
reaches storage is indistinguishable from a real one afterwards. So the model gets a scratch
namespace instead: it declares `localId: "legion_v"` on the delta that creates a thing and writes
`"local:legion_v"` to refer to it later in the same payload. The engine assigns every real id
(`force-<burstId>-3`) and resolves the handles. A reference that resolves to nothing is rejected as
friction, never written.

This is enforced structurally: every delta arm is `.strict()`, so a payload carrying an `id` field
fails to parse rather than being quietly ignored.

### Why time is always expressed in days

The model never states a date. It says `dueInDays: 60`. Date arithmetic is the engine's job, and a
model asked to do it will eventually schedule something into its own past.

### Why rejection is friction, not failure

VISION §8 is explicit that "build 200 warships in six months" should not return
`ERROR: insufficient resources`. So `applyDeltas` returns `{ world, applied, rejected, breaches }`:
a delta that cannot apply is rolled back individually, the rest of the batch still applies, and the
rejection becomes an `execution_friction` fact the Chronicle can report. An over-ambitious order
partly succeeds and the player learns why.

### Why lack of authority does not block an act

`applyDeltas` runs `checkAuthority` on every delta — and then **applies it anyway**, recording a
breach. VISION §12 is the reason: a general who marches without orders has not performed an invalid
action, he has committed insubordination. Coups, embezzlement, unauthorized wars and illegal seizures
are only expressible if the engine treats "unauthorized" as a property of an act rather than a veto.

---

## 3. The loop

`packages/sim/` is a pure package: it takes a `WorldState` and a model port and returns a committed
world plus everything it recorded. It touches no database and no Next.js.

```
apps/web route ──load──▶ packages/db ──▶ world + known facts + due events
      │
      ▼
runSimulationBurst(input)
      1. buildWorldSlice(...)      code    §27 token-budgeted projection
      2. orchestrate(...)          MODEL   intent, deltas, facts, delegations, schedule
      3. applyDeltas(...)          code    refs → authority → arithmetic → commit
      4. routeAttention(...)       code    §18 funnel to ≤3 actors
      5. runCognition(...)         MODEL   batched, per-actor knowledge only
      6. (back to 3, causalDepth+1)
      7. pressure + caps           code    §22 stop evaluation
      ▼
 CONTINUE        CHRONICLE ──▶ MODEL (visible facts only)        DECISION ──▶ player
```

**Three model calls, everything else deterministic.** That is what makes VISION §29's budget of
two-to-four calls per interaction achievable: attention routing, arithmetic, authority, id
assignment, scheduling, information filtering, pressure accumulation and termination are all code.

### Why the world only moves during a burst

Between orders the world is perfectly still. That is the intended game: it is the player's, paced by
them, and nothing happens behind their back while they read.

This makes the burst responsible for carrying the world far enough to be worth the asking. It takes
a short first step — so word can travel and the people the order touched can answer — and then jumps
to whatever is next on the calendar, bounded by the scenario's maximum span. A single order can
therefore span days or months depending on what is pending, which is what lets a sixty-day levy
mature rather than creeping forward two days at a time forever.

### The deterministic tick (`tick.ts`)

Everything that happens because time passed and for no other reason: revenue collected, wages paid,
project milestones reached. VISION §7 is explicit that there is no reason to invoke a model to
calculate a monthly surplus, and nothing does — a burst spanning sixty days collects two months of
revenue and pays two months of wages in one pass, free.

What it will not do is decide anything. A treasury that cannot meet the army's wages accrues arrears
and emits a fact saying so; whether that becomes a mutiny is for an actor to judge. Note the
asymmetry: revenue arriving as expected emits no fact at all, because a treasury filling on schedule
is not history and a fact per tax payment would drown every Chronicle in bookkeeping. An unpaid army
emphatically is.

### Why `packages/sim` is its own package

The old engine lived in `apps/web/lib/resolution/` and was untestable for exactly that reason. The
new one depends on `@chronica/shared` **only** — deliberately not on `@chronica/ai`, because
`@chronica/ai` depends on `@chronica/db` (its coin gate takes a live database). A simulation core
that transitively requires a database cannot be unit-tested without one.

So `packages/sim/src/ports.ts` declares the narrow interface it needs:

```ts
export interface SimModelPort {
  complete(operation: SimOperation, systemPrompt: string, userMessage: string): Promise<string>;
}
```

`apps/web/lib/simulation-service.ts` supplies a closure over `callWithCoinGate`; tests supply a
scripted fake. The whole loop is exercised with no network and no database.

### The slice (`slice.ts`)

`WorldState` is far too large to send. `buildWorldSlice` projects the part that matters, under hard
caps (12 characters, 10 forces, 8 projects, 12 facts…) so the slice does **not** grow as a campaign
runs — a slice that grew with the world would make the loop more expensive the longer you play,
which is exactly backwards.

Its history section is filtered through `factsVisibleTo` for the ordering actor. The orchestrator
speaks for the player's government, so it must not be handed secrets that government has not
discovered, or the world starts acting on knowledge nobody in it has.

### The attention router (`attention.ts`)

Entirely deterministic, four gates mirroring VISION §18:

1. **Inside the causal horizon and the news has arrived.** A fact past `maxCausalDepth` cannot wake
   anyone (§21 — otherwise every reaction breeds another forever). A fact whose
   `discovery.knowableAtInstant` is still in the future cannot either.
2. **Could they know?** `factsVisibleTo` for that specific character.
3. **Would they care?** Direct involvement, their polity, live pressures, open commitments, an
   unanswered order.
4. **Could they act?** An office, a command, or a standing authority grant.

Top scorers become `focused` (≤3, model cognition); the next tier `active`; the rest dormant.

A router that asked the model "who should react?" would answer "everyone interesting" and defeat its
own purpose. Activity level is derived per burst rather than stored, because importance here is
emergent from what a character is currently entangled in.

#### One correction worth knowing about

`factsVisibleTo` treats every `public` fact as visible the instant it exists. That is right for "is
this a secret" and wrong for "has word reached Carthage yet". The router therefore applies
`knowableAtInstant` as a separate gate — that is the mechanism behind §16's travelling news, and it
is driven by the model marking a fact `delayed`/`rumoured` with `knowableInDays`.

### Cognition (`cognition.ts`)

One batched call covers every focused actor, and each actor's section is built **only** from their
own knowledge. Handing one model the omniscient world and asking it to play several characters
produces one narrator wearing masks — precisely what §28 says to avoid — and it leaks: a general who
has not been told of the treaty starts acting as though he had.

The answer comes back in the same `Proposal` shape the orchestrator uses, so symmetric agency
(§10) falls out of one contract rather than a parallel NPC system that drifts.

### Delegation (`burst.ts`)

An instruction aimed at someone who could refuse is **not** a delta. It becomes an `OrderAttempt`,
and that person decides separately — via the surviving `decideOrderAttempt`, which already forces an
unauthorized "accept" to be recorded as `subvert`, so an authority breach can never silently acquire
the standing of a lawful order.

### Stopping (§21, §22, §23)

Significance is scored **by the actors, as a field on each fact they emit**, and accumulated by code.
This is how §22 gets contextual AI judgment of what matters without spending a fourth model call on
it.

Hard caps, all in `DEFAULT_BUDGET`: `maxIterations 3`, `maxModelCalls 4`, `maxSimulatedDays 90`,
`maxCausalDepth 3`, `maxFocusedActors 3`, `pressureThreshold 100`, plus the scenario's own
`maxSpanDays`. Anything unresolved when a burst stops becomes a scheduled event — stable pending
state, never dropped.

### The Chronicle (`chronicle.ts`)

Written only from `factsVisibleTo(facts, player, now)`. The constraint is enforced by **what the
historian is handed**, not by an instruction in the prompt: a prompt asking the model not to mention
secrets would eventually be disobeyed and nobody would notice. The model is only ever shown facts
that passed the filter, so it cannot leak what it never saw.

---

## 4. The clock was inverted

Time used to be a turn counter: `elapsedStep` was authoritative, one step meant "a season", and
`WorldInstant` was a finer clock derived *inside* one turn's resolution window.

VISION §15 removes turns and §16 asks for real timestamps, so the relationship is now reversed:

- **`WorldState.instant` (day + minute from the scenario epoch) is authoritative**, and required.
- **`elapsedStep` is maintained as exactly `instant.day`** — a schema invariant, enforced in
  `WorldStateSchema`'s `superRefine`, and only ever changed through `advanceWorldTo`, which also
  refuses to run backwards.

### Why `elapsedStep` was kept rather than deleted

About forty schemas across material state, projects, authority and the character system store
`*AtStep` fields. Every one of them stays meaningful when a step is a day. What changed is only what
a step *means* — it is now a date, not a turn. Deleting it would have been a large mechanical
rewrite with no behavioural gain.

Consequences, all applied:

- `ScenarioClock` lost `stepLabel`/`stepLabelPlural`/`stepsPerYear`/`minSpan`/`maxSpan` and gained a
  **required** `epoch` plus `minSpanDays`/`maxSpanDays`. A world that cannot name its own date
  cannot produce the timestamps §16 asks for.
- `currentAgeYears` no longer takes `stepsPerYear`; it reads days directly against
  `DAYS_PER_YEAR`. Ageing is still fully modelled — VISION §5 and §11 need NPCs who age and die —
  it just measures days now.
- Scenario data was rescaled: a consular term of `4` (seasons) became `365`, monthly cadences
  became `30`, and so on.
- `formatWorldDate` / `calendarDateOf` convert an instant to a real date ("1 March 264 BC"), using
  proleptic Gregorian arithmetic with astronomical year numbering so deep BCE and the BCE→CE
  boundary are both correct.

`WORLD_SCHEMA_VERSION` went to 2. **There was no migration burden** — nothing persisted a world at
the time — which is exactly why this was the moment to do it.

---

## 5. Persistence

Six tables, in `packages/db/src/schema/simulation.ts`, migration `0034_simulation_loop.sql`. Split by
lifetime rather than by turn, which is what made the old `turns`/`worldSnapshots` pair impossible to
advance continuously:

| Table | Holds |
| --- | --- |
| `game_worlds` | The live world document, one row per game, with a `revision` token |
| `world_facts` | The append-only historical record, with visibility, discovery and significance |
| `scheduled_events` | The future queue |
| `simulation_bursts` | One run of the loop, for inspection afterwards |
| `chronicle_checkpoints` | What the player was actually shown |
| `player_decisions` | The rare fork needing the ruler's own authority |

Facts live **outside** the world document on purpose: what is true and who knows it are different
questions, and the record must be queryable by time and visibility without loading a world.

`commitBurst` writes all of it in one transaction under one revision bump, behind
`pg_advisory_xact_lock(hashtext(gameId))`. The failure mode worth designing against is a partial
commit — a world that advanced without its facts, or facts describing a world that was never saved,
are both unrecoverable by inspection afterwards. The advisory lock matters because the chat path
writes world state too: a slow burst and a fast conversation must not interleave.

`getWorldView` was deliberately shaped to match its deleted predecessor's return type, so
`character-service.ts` and `dialogue-service.ts` — severed by the wipe — compile and run again
unchanged.

### Migration 0034 also retires the turn era

The wipe deleted the TypeScript schema but never wrote a migration, so the database still carried
every old table. `0034` drops `turns`, `orders`, `world_snapshots`, `chronicle_entries`,
`world_events`, `world_facts`, `turn_news_readiness`, `capability_requests`, `invented_workflows`
(+uses), `pending_workflow_proposals`, their enums, and the orphaned columns on
`games`/`players`/`character_claims`/`player_game_ui_state`.

The old `world_facts` in particular **collided by name** with the new fact ledger, which a
`CREATE TABLE IF NOT EXISTS` would have silently resolved in favour of the old shape. This is
irreversible and was confirmed before running.

---

## 6. Authority was un-stubbed

`officeIdToDomainPowers` had become a stub returning `[]` when the workflow registry it classified
against was deleted, taking office-derived authority with it (three tests were left `it.skip`'d
documenting the intent).

Its replacement is the delta union: an office's `authorisedActionIds` are now written in exactly the
vocabulary the world can be changed in. An office authorising `force_create` holds military command
power; one authorising `money_transfer` holds fiscal spend power. An id in neither vocabulary confers
nothing rather than guessing. Fiscal authority stays scoped to the office's own named treasury
account, so a governor authorised to spend does not thereby reach the national treasury.

The three skipped tests are **live again**, and the scenarios' offices were rewritten into the new
vocabulary.

To break the resulting import cycle (deltas are classified *by* domain; offices derive authority
*from* the delta vocabulary), the authority enums were extracted into a leaf module,
`packages/shared/src/authority/vocabulary.ts`. The orphaned `buildWorkflowAuthorityGate` — a hook
for the deleted GM session, with no callers — was removed.

---

## 7. What is reused rather than rebuilt

The wipe left most of the substrate. Each survivor carries a vision section:

| Survivor | Serves |
| --- | --- |
| `world/facts.ts` — `Fact`, `FactDiscovery`, `emitFacts`, `factsVisibleTo` | §14 objective vs. known, §18 signals, §25 chronicle boundaries |
| `world/instant.ts` — `WorldInstant`, `addMinutes`, `worldInstantToSortKey` | §16 continuous time |
| `authority/order-attempt.ts` — the issue→decide→carry-out machine | §13 delegation, §12 refusal and subversion |
| `authority/authority-grant.ts` — `buildAuthorityIndex`, `checkAuthority` | §12 authority as classification |
| `world/project.ts` — projects and milestones | §8 ambitious orders persist, §17 scheduling |
| `material-state.ts` — accounts, obligations, income, forces, office seats | §7 economy |
| `world/references.ts` — `findWorldReferenceViolations` | §3 code owns consistency |
| `world/scope.ts`, `world/watch.ts`, `clock.ts`'s `StopReason` | §18/§19 attention, §21/§23 stopping |
| `characters/*` including `applySocialEvents` | §10/§11 NPCs as real actors |

---

## 8. The page layer

`apps/web/lib/game-repository.ts` was deleted with the turn system and is rewritten rather than
restored: the in-memory demo repository is gone, as are every Orders, News and turn method, leaving
the eleven operations the pages actually call. `world-view.ts` is likewise new — its predecessor
keyed knowledge labels to a turn index and carried hardcoded scenario overlay tables that papered
over gaps in the opening state. The replacement reports what `WorldState` contains and nothing else.

Two database functions had to come back with it (`createGame`, `requestGameEnd`), and `createGame`
now materializes the world immediately: its predecessor opened turn 0 and left the scenario's
`initialWorld` to stand in until the first turn resolved, and with turns gone there is nothing to
stand in for it.

One consequence worth knowing: a definition change does not reach a database by editing a scenario
file, because `scenario_versions` rows are immutable by design. The continuous clock and the widened
office powers each required publishing a **new scenario version** in `ensureBuiltInScenarios`.

## 9. Conversations are part of the record

A conversation is not a side channel. `applyConversationConsequences`
(`apps/web/lib/conversation-consequences.ts`) closes the gap the wipe left: a proposed
`CharacterSocialEvent` used to wait for a turn to apply it, and since turns were deleted, nothing
ever did — every relationship change, belief, pressure and promise from every conversation simply
never reached canonical state.

Now a conversation takes effect as it happens, through the character system's own
`applySocialEvents`, and — new — it is recorded in the fact ledger by
`packages/sim/src/conversation.ts`. What was said becomes history, which means the attention router
can wake someone because of a promise, and the Chronicle can report a conversation the player
actually had.

The discovery ledger is what makes this safe. A private conversation's fact is marked discovered by
the people in the room and nobody else, so `factsVisibleTo` lets the participants act on it while
the rest of the world cannot see it at all until someone tells them.

Deliberately *not* a burst: a conversation is not an order. It costs no model call here, does not
advance the clock, and does not wake the world on its own. It records what happened and stops.

## 10. Verification

`packages/sim` has **64 tests**, all driven by a scripted model port — never a live adapter, because
a test that can disagree with itself run-to-run is worth nothing as a regression guard. Repo-wide:
479 tests pass, none skipped, and the whole repo typechecks.

The end-to-end case is VISION §30's own example. One order — *"Raise two new legions."* — produces,
in two model calls:

- 220 talents leaving the treasury;
- a persistent NPC (Marcus Fabius Varro, Military Quaestor) generated because the mobilization needed
  a financier;
- a recruitment `Project` with two milestones;
- a recurring 31/month army-upkeep obligation;
- a scheduled milestone 60 days out;
- an `OrderAttempt` to the treasury official, still awaiting his answer;
- a public mobilization fact that becomes knowable elsewhere after a day, and a private borrowing
  fact that does not;
- Carthage, woken by the router, quietly reinforcing Sicily — and that reinforcement staying
  invisible to the player.

Other tests cover: money conservation and over-spending as friction, batch partial application,
unauthorized acts applying as recorded breaches, unresolved `local:` handles, dangling references,
every budget cap terminating a burst, a model that answers with prose instead of JSON, and the
Chronicle never being handed an undiscovered fact.

The attention router has its own suite, because it is the piece that decides what everything else
costs: a secret nobody discovered wakes no one, a secret shared with someone wakes them, news that
has not travelled yet wakes no one until it has, a fact past the causal horizon wakes no one, the
player is never woken, and the same world wakes the same people every time.

Writing those tests found that the focus threshold was set one point above the score of the very
actor it exists to select — someone who can know, has cause to care, and holds authority — so an
ordinary public event woke nobody at all. The bar is now that actor's score exactly, and
`maxFocused` is what bounds the cost.

---

## 11. What the first live model run changed

Scripted tests prove the loop. Only a real model proves the *prompt*, and the first live run against
`gpt-5.6-luna` found four things no unit test would have:

1. **The model described the order instead of carrying it out.** It returned intent, delegations and
   a schedule, and changed nothing — the treasury was untouched. Fixed by an explicit rule: *"Then
   actually do it… an answer with no deltas asserts that the world did not move at all, which is
   rarely true of an order a government has accepted."*
2. **It paid from `"Marcus Atilius's purse"`** — the *label* the slice printed, not the id. The
   TREASURY section rendered names without ids while every other section showed `[id]`. The slice
   now prints ids everywhere, and the prompt says to use them.
3. **A character had no authority over their own money.** Office grants cover an office's named
   treasury and nothing else, so spending one's own purse was recorded as an authority breach, which
   made every privately funded act look like embezzlement. `deriveOwnerGrants` now grants fiscal
   power over an account to the character who owns it. Ownership is not an office, and does not
   expire.
4. **Unscoped deltas were judged against the wrong polity.** `scopeOf`'s fallback reached for
   `map.polities[0]` — Carthage — so a Roman consul's every unscoped act was checked against an enemy
   state and breached. It now falls back to the actor's own polity.

Both (3) and (4) produced *false insubordination*, which is the worst possible failure for a system
whose whole point is that real insubordination is meaningful. Each has a regression test naming the
live run that found it.

Also learned: delegations could name a person the same payload was still creating, and the
`local:` handle was written into the order attempt verbatim; delegations now resolve through the
same id map as deltas and drop orders to people who do not exist. And a fact may now name a
`project` as an affected entity — the ref enum had no way to say that an event concerned an ongoing
effort.

The loop's own numbers held up: the slice renders at ~165 tokens, the system prompt ~4,600, and a
good answer arrives in one call with the repair path catching the rest.

## 12. What is deliberately not done

- **NPC-initiated contact is gone.** Its only trigger was a Chronicle entry field, so the route that
  opened those conversations was deleted; `openInitiatedDialogue` survives and needs a new source,
  most naturally a pressure or an unanswered commitment.
- **Single-player.** The burst assumes one sovereign. Multiplayer reintroduces exactly the
  turn-synchronization problem §15 exists to avoid, and was scoped out on purpose.
- **`docs/product.md` and `docs/architecture.md` still describe the deleted Turns/Orders/Chronicle
  loop.** They are stale and should be rewritten against this document.
- **Games created before this work cannot be opened.** Their state lived in `world_snapshots`, which
  migration 0034 dropped; they have no `game_worlds` row and the game page returns 404. Nothing
  resurrects them, deliberately.
- **The simulation panel appears only after character declaration**, since that is what the game page
  gates `playerCharacterId` on. That is the existing product flow, not a decision taken here.

## 13. What completing the loop changed

Three holes remained after the first pass, all the same shape: the world recorded intentions it
never honoured.

- **The queue was write-mostly.** A milestone came due, was mentioned to the orchestrator, and was
  retired whether or not anything happened. Nothing advanced the project it belonged to, so "raise
  two legions" scheduled legions that could never arrive. `runDeterministicTick` resolves them.
- **A burst crept forward two days and stopped**, so a sixty-day levy would have needed thirty
  orders to mature. It now walks to the next moment that matters.
- **The attention router's middle tier was computed and discarded.** Actors who cared but did not
  warrant a model call now record what they mean to do, deterministically and for free.
- **`social_events` parsed and did nothing**, so the orchestrator could not author relationship
  change at all. It routes through `applySocialEvents`, the same applier a conversation uses.

Writing the pacing found a mistake in it: significance crossing the threshold was gated behind the
minimum span, so a world where Rome had just declared war would carry on for another week before
telling the player. The minimum span exists to avoid waking someone for trivia; it now gates only
the quiet stop.

## 14. The known risk

**Prompt size, not loop logic.** `buildWorldSlice` is where this design succeeds or fails. The
orchestrator's system prompt is ~4,600 tokens (mostly the generated JSON schema, identical every call
and therefore cacheable), and the slice is bounded — but whether the slice carries *the right* bounded
subset for a given order is the thing most likely to need iteration once real models run against real
campaigns.

The secondary risk is burst duration inside a request-scoped API route. `simulation_bursts` exists
partly so that moving a burst to a background job later is cheap.
