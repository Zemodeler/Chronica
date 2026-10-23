# Plan: an engine that cannot quietly be wrong

Five playtest rounds each found new errors, and most of them were of three kinds:

1. **An order's state is not kept, it is guessed.** A part stores raw fields (`refusal`, `whyNot`, `note` with meaningful prefixes,
   `closedAtStep` with no reason, stages) and every reader recomputes its state with `orderPartStatus`, then corrects it its own way.
   At least six hand-written "finished" lists differ; `lineOf` overrides the status by reading words (raised, appointed, project) while
   the Council, the slice, the Chronicle's claim check and `settleDelegations` do not; `answerTheParts` and `recordOrder` decide "held or
   refused" by different rules; the UI reads "Did not go ahead" out of the display text by regex. Dependencies between parts are
   turned into world conditions once, at `recordOrder`, so "a part after a refused part" is only caught when the earlier part's refusal
   happens to be a refusal string on the day of the order.
2. **The world's rules are checked late or not at all.** `findInvariantViolations` holds three rules. A new violation in a tick is
   pushed to `skipped` and the tick is kept; the money audit runs only in tests and in sanity scripts that exit 0 whatever it finds.
   Fifteen thousand vanished in year five and nothing stopped.
3. **What the player reads is written apart from what happened.** Fact summaries are text made at the moment of the act; the outcome
   line, the Council row, the history and the chronicle each pick their own reason (`refusal ?? whyNot ?? note` in one place,
   `procedureReasonOf / refusal / whyNot / siege text` in another). Deadlines are put into words with different numbers from the ones
   the engine keeps (a ship wait reads "lapses in 90 days" and fails at 60).

"Works 100% of the time" cannot mean no bug is left in a simulation of this size. It can mean, and this plan is built to mean:

- **G1.** Every order part is in exactly one stored state, every state change goes through one function, and every part reaches a
  final state with a stored reason within a known bound. Proven by the type system (exhaustive unions) and by property tests over
  generated orders, not by playtests.
- **G2.** No reader can show a state or reason other than the stored one. There is one view function; the rest are not allowed to
  read the raw fields (a lint rule).
- **G3.** A broken world rule is never silent. In tests, sanity runs and CI it throws, naming the rule, the things and the stage
  that broke it. In a player's game it keeps the last sound world and writes an engine fault the player and the logs can see.
- **G4.** Every word about an order's or a deadline's state is made from the stored state and the same constants the engine enforces.

## Part 1: the order as a state machine

### The record

`packages/shared/src/world/orders.ts`. `OrderPart` gains one stored field and loses its meaning-bearing text:

```ts
type PartState =
  | { kind: "held"; waitsOn: PartCondition[]; since: number; lapsesAt: number }
  | { kind: "acting"; since: number }                      // acts carried, effect not yet seen
  | { kind: "delegated"; attemptId: string; since: number }
  | { kind: "done"; at: number; how: "achieved" | "partly" | "already_so" | "on_application" }
  | { kind: "refused"; at: number; reason: Reason }
  | { kind: "failed"; at: number; reason: Reason }
  | { kind: "lapsed"; at: number; reason: Reason }
  | { kind: "superseded"; at: number; byPart: PartRef }
  | { kind: "not_needed"; at: number; reason: Reason };

type PartCondition = StageCondition | { kind: "part"; part: PartRef; needs: "done" | "answered" };
type Reason = { code: ReasonCode; args: Record<string, string | number> }; // words are made at render (Part 3)
```

- `closedAtStep`, `refusal`, `refusedAtStep`, `whyNot` and the "Lapsed:/Not needed:/Not all of it:/Check:" prefixes of `note` are
  replaced by the state. `note` keeps only free notes. The schema migrates old saves once (a pure function from the old fields to a
  state, tested against every fixture save).
- **A dependency on another part is kept as a dependency** (`{ kind: "part" }`), not translated into a world condition at order time.
  When a part reaches a final state that is not `done`, every part waiting on it fails the same hop with that part named. This is the
  general form of the `refusedEarlier` patch and also covers refusal by `whyNot`, unwritten acts, later refusals and lapses.

### One writer

`packages/sim/src/order-machine.ts`:

```ts
type PartEvent =
  | { kind: "recorded"; acts: ActOutcome[]; conditions: PartCondition[] }
  | { kind: "condition_met" } | { kind: "condition_impossible"; reason: Reason }
  | { kind: "acts_carried"; acts: ActOutcome[] } | { kind: "delegated"; attemptId: string }
  | { kind: "attempt_settled"; outcome: "carried_out" | "abandoned" | "refused" }
  | { kind: "effect_seen" } | { kind: "effect_lost"; reason: Reason }
  | { kind: "superseded"; byPart: PartRef } | { kind: "dependency_closed"; part: PartRef; state: PartState }
  | { kind: "day"; step: number };     // deadlines

function step(part: OrderPart, event: PartEvent, now: number): PartState
```

- A transition table, written as data, says which events are allowed in which states; `step` is a `switch` with `never` checks, so
  adding a state or event without handling it does not compile. A disallowed event throws in strict mode (Part 2) and is a fault
  otherwise.
- `recordOrder`, `advanceStages`, `settleDelegations`, `lapseStaleParts`, the supersede pass, `continueMissions`,
  `creditDelegatedWork` and `answerTheParts` stop writing part fields and emit events instead. `answerTheParts` writes its fact from the
  state `recordOrder` reached, so the two can no longer disagree about "held or refused".
- Deadlines live in the state (`lapsesAt`) and come from one table (`ORDER_DEADLINES`: review 14, part lapse 60, ship wait 60, stage
  lapse 90, delegation stalled 21). The `day` event is the only thing that lapses a part.
- "Done" is a state, not a guess. The world-reading that today happens in every reader (a project done, a force raised, an
  appointment made, a march arrived, a siege lifted, a letter answered) moves into one function, `observe(part, world)`, run once per
  hop, which emits `effect_seen` / `effect_lost` / `condition_*`. `lineOf`'s word overrides become cases of `observe`.
- Delegated attempts keep their own machine (`order-attempt.ts` already is one); the part listens to it through `attempt_settled`, and
  `requests.ts:settleAccepted` stops settling attempts that serve a part.

### One reader

`partView(part, world, clock) → { state, finished: boolean, label, line, reason?, deadline? }` in shared. `isFinished(state)` is
the only "finished" list. `orderOutcomeLines`, `lineOf`, `ordersUnderWay`, `readStandingOrders`, the Council history
(`room-service.ts`), the slice, `outcomeOfOrder`, `open-threads`, the scorecard, the narrator and the chronicle's `claimsItDone` all
take `partView`. An ESLint `no-restricted-syntax` rule forbids reading `part.state.kind`, `part.stages` or `orderPartStatus` outside
`orders.ts`, `order-machine.ts` and their tests. The UI gets `state.kind`, so `orders-panel.tsx` stops matching "Refused|Failed" in text.

### What proves it

- **Exhaustiveness:** the types above.
- **Table test:** every (state, event) pair is either a listed transition or a listed refusal.
- **Property tests (fast-check, added as a dev dependency of sim):** generate orders of 1 to 10 parts with random `afterParts`
  graphs, random act outcomes (carried, refused, unwritten, dropped as unreadable), random answers and delays, then drive days.
  Assert, for every run:
  - every part reaches a final state within `max(lapsesAt) + one hop`;
  - every final state other than `done` has a reason, and a part that failed because of another part names it;
  - no part is `done` while a part it depends on is not;
  - `partView` of the same part gives the same `state.kind` to every caller (Council, outcome lines, slice, chronicle);
  - renumbering after dropped or salvaged acts keeps every act owned by exactly one part.
- **Regression set:** every order bug of rounds 1 to 9 becomes a fixture run through the machine (the tests exist; they are re-pointed
  at the state, not the words).

## Part 2: invariants that stop the world

### One registry

`packages/sim/src/invariants.ts` becomes a registry:

```ts
type Invariant = { id: string; about: string; check(world: WorldState, before?: WorldState): Violation[] };
type Violation = { invariant: string; things: string[]; sentence: string };
```

Each invariant has a test that builds a world breaking it and sees it caught. The first set, each from a bug already met:

| id | rule |
| --- | --- |
| `money.conserved` | `auditMoney(before, after).unexplained` is empty and total money moves only through doors |
| `money.whole` | every balance is a whole, non-negative number, and the transaction that made a fraction is named |
| `office.one-man` | a man holds or is designated to at most one seat, and `character.officeId` matches the seat |
| `office.living` | a held seat's holder is alive and not under a bar |
| `force.paid` | a force with men has an active pay obligation, or is outlaw or private |
| `force.pay-covers` | the obligation is at least the men's pay at the set rates |
| `force.kind-kept` | a split conserves men by kind; a force of warships is not named or run as a garrison |
| `force.commander-of-power` | a force's commander and controller belong to its power, unless a contract or a defection explains it |
| `rising.own-leader` | a rising is led by a man of the power it rises for, never by a living officer of another standing power |
| `polity.ended-is-empty` | an ended power holds no active agreement, province, force or money |
| `diplomacy.consistent` | no pair is both allied and at war; at most one truce per pair; no truce between powers not at war |
| `siege.one-storm` | one storm per siege per day, and no question left open once one is answered |
| `ids.unique` | ids are unique in every collection |
| `orders.machine` | every open part's state is reachable from its events, no part waits on a closed part, every act has one owner |

The three rules already there (one voyage per fleet, one army per man, no person made twice) stay.

### Where it runs

Once after each tick in `tickTo`, after each bookkeeping stage in `checkpoint`, and after each applied batch in `applyDeltas`
(which already rolls back a delta that adds a violation). Each check is indexed by id so a run of a month stays well under a second.

Two modes, chosen by `CHRONICA_STRICT=1` (set in the sim vitest config, so in CI, and by default in every `*-sanity.mts` and
`world-alone`; the hand-run harnesses take it when asked, since a fault thrown twenty minutes into a hand-played burst loses the
burst, and they print every fault anyway):

- **strict:** a new violation throws `InvariantBroken` with the rule, the things, the stage and the burst id. Sanity scripts exit
  non-zero when the money audit is not clean.
- **play:** the stage is rolled back to the last sound world (as `checkpoint` does today), an `engine_fault` record is kept in the
  world and logged, and the burst's result lists it. A violation never passes without leaving a trace.

### Long runs in CI

A nightly job runs `world-alone` for two years and `war-sanity` for three in strict mode (about 15 to 30 minutes each, by the
five-year reports), plus a fast-check run of the order machine with a fixed seed and a larger number of cases. A failure files the
seed and the stage, so it can be replayed (the engine is deterministic, `a-burst-replayed.test.ts`).

## Part 3: words made from the state

- **Reasons are codes, not sentences.** `Reason = { code, args }`. One table, `reasonWords`, holds a sentence per code in the
  period voice, and an exhaustive `Record<ReasonCode, ...>` makes a missing one a compile error. `refusalInPeriodWords` and the three
  `conditionInWords` functions merge into it.
- **Facts about an order carry its state.** `order_part_unanswered`, `order_resumed`, `order_stage_failed` and `order_wait_review`
  are written by the machine at the transition, with `{ part, state }` in the fact. Their summary is made from that state, so a fact
  cannot say "It could not be done" of a part the ledger holds as waiting.
- **Deadlines in words read the deadline in the state.** `waitingUntil` reads `lapsesAt`.
- **One check over all of it:** a test drives the property-test runs and asserts that each order fact's state, each `partView` line
  and each Council row agree for every part, every day.

The narrator, historian and letters stay model-written; they already get the outcome lines, and the parity and claim checks
(`fact-parity.ts`, `claimsItDone`) are re-pointed at `partView`.

## Order of work

1. **Invariant registry and strict mode** (Part 2, without `orders.machine`). Smallest change, finds the most. Expect the first
   strict runs to fail; each failure is a real bug to fix before going on.
2. **Order state and the machine** (Part 1): the state field and migration, `step`, the writers moved to events, `observe`. Behind
   the same tests, with the old `orderPartStatus` kept as a cross-check in strict mode until it never disagrees, then removed.
3. **One reader** (`partView`, the lint rule) and **reasons as codes** (Part 3).
4. **Property tests and the nightly long runs**; add `orders.machine` to the registry.

Each step lands on its own branch from `main`, with the full sim suite green.
