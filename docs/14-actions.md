# Actions, orders, and the unified resolution architecture

> **Superseded in part by [the Game Master](24-game-master.md).** The order
> and workflow model described here — registered typed workflows, the single
> executor gate, persistent operations, the order/refusal projection — is
> current. The AI orchestration around it is not: the interpret/assess/
> adjudicate chain, the director committee, and the Workflow Manager have been
> replaced by one tool-using agent acting against a staged world.

This is two things in one document, because they are the same subsystem seen
at two grains. Sections 1-4 are the concrete reference for what a player (or
NPC, or faction) submits and what the simulation makes of it -- the doc many
other files already cite as `docs/14`. Sections 5-9 are the architecture
overview requested for the unified world-resolution redesign: state
ownership, the AI/deterministic boundary, event timing, migration, and the
phased roadmap the rest of that redesign follows.

## 1. What already existed

Before this phase, almost everything the redesign needs was already built,
just not fully wired together:

- **`resolveTurn`** (`apps/web/lib/resolution/pipeline.ts`) already runs one
  turn as a single sequential pipeline: interpret free text -> assess
  feasibility -> adjudicate into proposed deltas -> run three AI "directors"
  (Reaction, Simulator, Character) in parallel over the post-player world ->
  consolidate their output -> World Director arbitrates -> character agency
  turns approved NPC intents into candidates -> **Workflow Manager** reviews
  every candidate from every source -> **executor** actually mutates
  `WorldState` -> Chronicle assembly -> narrator prose -> commit.
- **Authority and procedure** already exist:
  `characters/political-authority.ts` (`resolveEligibility`,
  `canSponsorProcedure`) and `character-agency/political-resolver.ts`
  validate office/institution standing; `workflows/policy.ts`'s
  `validateCandidate` runs a deterministic policy check (registered action,
  valid parameters, actor alive, `authority_mismatch`, `scope_violation`,
  `treasury_unauthorised`, duplicate) before any AI ever sees a candidate.
- **NPCs already use a parallel origination path** that converges at the
  same gate as the player: `character-agency/{candidates,scoring,conflicts}.ts`
  score and resolve NPC intents into `ProposedInvocation`s, which
  `workflow-manager.ts`'s `collectCharacterAgencyCandidates` feeds into the
  exact same `runWorkflowManager` call as the player's candidates. This is
  the one convergence point every order, from any source, already passes
  through -- and the one this phase builds on rather than duplicates.
- **Chronicle fact/prose separation** already exists
  (`chronicle/knowledge.ts`, `chronicle/dispatch.ts`,
  `chronicle/causal-chain.ts`): a `ChronicleFactRecord` is redacted per
  viewer and projected before any prose is generated; the narrator pass
  (`prompts.ts`'s `buildChronicleNarratorPrompt`) only ever rewrites an
  already-committed summary sentence, never invents one.

## 2. What was missing (this phase closes the first of these)

1. **No universal order model was actually wired.** `OngoingActionSchema`
   (`actions/orders.ts`) was fully designed -- status machine, revision
   history, supersession -- but `pipeline.ts` never read or wrote
   `world.actions`, and no workflow ever populated it. It also lacked
   target, desired outcome, method/posture, authority basis, required
   procedure, resources, and any link to a multi-turn operation.
2. **No persistent-operation entity existed at all.** `start_siege`/
   `end_siege` were (and still are, until Phase 3) two independent atomic
   workflow flips, not a multi-turn effort with stage, risk, and standing
   instructions.
3. **No provincial material/demographic layer exists** -- no population,
   manpower, food security, tax capacity, or stability, anywhere. Deferred
   to Phase 2 (below).
4. **Battle resolution is schema-only.** `warfare/battle.ts` defines
   `BattleResultSchema` in full, but nothing computes one; a battle's actual
   outcome goes through the AI verdict/workflow path today. Deferred to
   Phase 3, and treated there as a hard requirement, not an enhancement --
   it is the one place the current design lets prose imply a material fact
   no deterministic function actually decided.
5. **Three unaligned level-of-detail schemes** exist (the Simulator's
   star/near/far/coarse polity tiers, the Reaction Director's geographic
   adjacency, the Character Director's continuity tiers). Deferred to
   Phase 4.
6. **No intra-province operational position.** A force has only a
   `locationId` (a province); the map resolves each force's pixel
   independently, so two forces sharing a province silently overlap.
   Deferred to Phase 3.

## 3. The order model (this phase)

`OngoingActionSchema` gained the fields the redesign's universal order model
needs, all optional so a pre-existing (always-empty, per finding 1 above)
snapshot still parses:

- `issuerRef` / `targetRefs` (`OrderPartyRefSchema`) -- who issued the order
  and what it acts on, as a `{ kind, id }` pair over characters, factions,
  polities, institutions, forces, provinces, settlements, accounts, offices,
  or procedures.
- `desiredOutcome`, `method`, `posture` -- free text; warfare-specific
  postures (advance/besiege/withdraw/...) arrive with Phase 3's operational
  layer rather than being invented here ahead of the schema that needs them.
- `authorityBasis` (`OrderAuthorityBasisSchema`) -- a record of the
  authority/policy decision already made elsewhere (`resolveEligibility`,
  `validateCandidate`), not a second authority engine.
- `requiredProcedureId`, `resourceRefs`, `operationId` -- links into the
  existing political-procedure objects, treasury/force resources, and the
  new `PersistentOperation` below.
- `updatedAtStep`, `chronicleChainId` -- rounding out provenance alongside
  the existing `startedAtStep`/`sourceIntentId`.

`PersistentOperationSchema` (`actions/operations.ts`) is new: `id`,
`originatingOrderId`, `ownerRef`, `objective`, a free-form `stage` (concrete
stage vocabularies are a Phase 3 concern), `standingInstructions`, `risks`,
`blockers`, `nextScheduledStep`, `relatedForceIds`/`relatedPositionIds`/
`relatedProcedureId`/`relatedOperationIds`, and a `status` (`active |
completed | failed | paused | cancelled | superseded`) that requires a
`statusReason` once terminal -- the same pattern `OngoingActionSchema`
already uses for its own terminal states.

`WorldState.operations: PersistentOperation[]` sits next to the existing
`actions: OngoingAction[]`, defaulted to `[]` so old snapshots load cleanly.
Neither field required a migration: both live inside the versioned jsonb
snapshot (`packages/db/src/schema/game.ts`), the same place every other
character-sim phase has added state.

## 4. Wiring: `projectOrdersAndOperations`

The pipeline already produces exactly the record this needs and previously
discarded most of it: `finalWorkflowAudit.candidates`
(`WorkflowAuditEntry[]`) already carries every candidate's source, requested
invocation, `policyViolation`, manager decision, and execution outcome --
for the player, for every NPC, and for the World Director's own synthesis,
because they all pass through the one `runWorkflowManager` gate. Only the
audit blob (a diagnostic record) ever read it; nothing turned it into
world-visible history.

`packages/shared/src/actions/order-projection.ts`'s `projectOrdersAndOperations`
is a pure function that closes that gap:

- Every audit candidate becomes exactly one `OngoingAction` -- `completed`
  or `active` (if it maps to a multi-turn action, by the same
  `estimateWorkflowDurationDays` threshold `pipeline.ts` already uses to
  schedule Chronicle) on success, `failed` on a dry-run/execution failure,
  or **`impossible` on an authority/policy rejection** -- with
  `authorityBasis.validated: false` and a `terminalReason` quoting the
  actual `PolicyViolation` message (`authority_mismatch`,
  `scope_violation`, `treasury_unauthorised`, or an AI-reviewed rejection).
- Every rejection this way also becomes an `OrderRefusalFact`, which
  `pipeline.ts` turns into a genuine Chronicle entry (`scope:
  "order_refusal"`, title `"The Refusal of <name>"`) -- so an unauthorised
  order is committed history with a responsible actor and a grounded reason,
  never a silently dropped candidate, exactly as the redesign's "Player X
  attempted to order Legio X to Capua, but Commander Y refused" example
  requires.
- Every non-terminal `PersistentOperation` from the prior turn is carried
  forward untouched. This -- not a new scheduler -- is what makes an
  unfinished operation continue under standing instructions: it is checked
  once per turn, in the same place `resolveDueProcedures` and
  `advancePressureLifecycle` already are, and otherwise left alone.
- An explicit `"cancel"` directive (Phase 6, `applyCancellationDirectives`)
  is applied deterministically, before this turn's new actions are
  projected: it needs no AI interpretation, since it names the exact
  `OngoingAction.id` it targets, and cascades to that action's linked
  `PersistentOperation` if it has one. Cancelling an already-terminal or
  unknown action is a silent no-op -- cancellation stops unfinished work, it
  never rewrites what already happened.

Nothing about the AI directors, `consolidateProposals`, or the
`WORKFLOW_REGISTRY` execution semantics changed. This phase adds a persisted
record of a decision the pipeline already made, plus the refusal-grounding
Chronicle entry; it does not add a second pipeline.

One documented approximation: `OngoingAction.invocation.source` still uses
the older, narrower `InvocationSourceSchema` (`grammar | assessment | npc |
event_director | simulation`), while the Workflow Manager's own
`WorkflowCandidateSource` has five more specific values (`player_directive`,
`character_director`, `near_event`/`far_event`/`coarse_event`,
`reaction_director`, `simulator`, `world_director_synthesis`).
`order-projection.ts` bridges them with an explicit, lossy mapping table.
Unifying the two enums is left to a later phase rather than risking a
schema change to `ActionInvocationSchema` that other, unrelated code already
depends on.

## 5. State ownership

`WorldState` (`packages/shared/src/world/world-state.ts`) is the single
source of truth: one immutable, versioned, hashed document per turn
(ADR-0002), stored as jsonb on the game/scenario rows
(`packages/db/src/schema/game.ts`) rather than normalized relational tables.
This is a deliberate, already-argued choice (see `world-state.ts`'s own
comments): anything the determinism/replay test must cover has to be inside
the one hashed document, and a relational table would be a second source of
truth for state a replay has to reproduce exactly. Every phase of this
redesign -- the order/operation model here, the material layer in Phase 2,
operational positions in Phase 3 -- adds fields to this same document,
defaulted for backward compatibility, never a parallel store.

## 6. The AI/deterministic boundary

```
Interpret (AI) -> Assess (AI) -> Adjudicate (AI, deterministic repair)
    -> Reaction / Simulator / Character Directors (AI, parallel)
    -> Consolidate (deterministic dedupe)
    -> World Director (AI arbitration)
    -> Character Agency (deterministic scoring/conflict resolution)
    -> Workflow Manager (AI review + deterministic policy gate)  <- sole commit gate
    -> Executor (deterministic, WORKFLOW_REGISTRY)               <- sole mutator
    -> Order/operation projection (deterministic, this phase)
    -> Chronicle assembly (deterministic) -> Narrator (AI prose only)
    -> Commit
```

Every AI box produces an untrusted, schema-validated proposal
(`ProposedInvocation`, never a direct state patch -- `verdict.ts`'s
`StateDeltaSchema` comment is explicit that there is no "set this balance"
variant, on purpose). Every mutation happens in exactly one place, the
executor, gated by exactly one review step, the Workflow Manager. Chronicle
prose is generated only from already-committed facts; the narrator rewrites
sentences, it does not decide what happened. **This invariant is the one
thing every later phase (material, warfare, Chronicle depth) must preserve.**
A deterministic battle resolver (Phase 3) is required specifically because
today's battle outcome is the one place this invariant is not yet fully
honored -- see finding 4 above.

## 7. Event timing

The pipeline already resolves one turn as a deterministic sequence of
committed beats within `resolveTurn`, keyed to `elapsedStep` (`world.
elapsedStep`, the "elastic clock", ADR-0016/ADR-0032) rather than a fixed
per-real-day tick. Persistent operations hook into this the same way
existing per-turn systems do -- `resolveDueProcedures`,
`advancePressureLifecycle`, and now `projectOrdersAndOperations` all run
once per turn against the exact world state the prior turn produced, so "the
next event resolves from the exact state the prior event produced" continues
to hold without a new scheduler. Phase 2 and 3 must follow the same rule:
detailed updates run only for provinces/forces actually affected this turn,
not a full-world recompute per event.

## 8. Migration

Every field this phase adds is optional or `.default()`-ed:
`OngoingAction`'s new fields are all `.optional()`; `WorldState.operations`
is `.default([])`. No DB migration is required -- both live inside the
existing jsonb snapshot column, loaded through `WorldStateSchema.parse`,
which already applies these defaults to any snapshot that predates them.
`world-view.ts`'s existing `ongoingActions: world.actions` passthrough is
unaffected; the two built-in scenarios' `WorldStateSchema.parse({...})`
calls need no changes for the same reason.

## 9. Phased roadmap

- **Phase 1 (this document, delivered):** universal order + persistent
  operation model, wired into the existing pipeline via
  `projectOrdersAndOperations`; authority refusals become grounded Chronicle
  history.
- **Phase 2 -- material society (delivered, docs/18):** a provincial
  material/demographic layer in `packages/shared/src/material-state.ts`
  (population, manpower, food security, tax capacity, stability, displaced
  population, war damage, last update step), deterministic update rules
  connecting it to the existing treasury/force/recruitment systems via two
  new workflows (`recruit_from_province`, `collect_emergency_taxation`), and
  bounded/coarse-vs-detailed update budgets (`advanceProvinceMaterial`).
- **Phase 3 -- operational warfare (delivered, docs/19):** intra-province
  `Position` entities (stable id/label/type/modifiers/capacity,
  scenario-authored with a deterministic fallback); a deterministic
  `resolveBattle()` engine that actually consumes real
  troop/commander/terrain/position/supply inputs and produces a real
  `BattleResult`, closing the gap in finding 4, wired in via a
  system-only `resolve_battle` workflow no AI candidate can ever propose;
  map rendering that offsets incidentally co-located forces and groups
  deliberately combined ones (a battle, a joint siege) into one marker.
  Deferred within Phase 3: tactical-modifier proposals, multi-force battles,
  and coarse province-wide supply/attrition beyond the existing
  `Force.provisionStatus` + Phase 2 food-security signal already consumed by
  the engine.
- **Phase 4 -- Chronicle depth (delivered, docs/21):** dispatch/paragraph/
  scene tiers driven by `playerRelevance`/material consequence, wired across
  the player/character/reaction/simulator/order-refusal/battle streams; a
  structured battle-brief object handed to the narrator instead of
  flattened text; a previously-missing Chronicle entry for every resolved
  battle. Deferred within Phase 4: depth for the remaining streams
  (political procedure, life event, command change, family event,
  commitment -- default to "paragraph"), and merging the three directors'
  internal LOD schemes (only their Chronicle-facing depth is unified so far).
- **Phase 5 -- interrupt and Chronicles UI (delivered, docs/22):** a
  dismissible resolution overlay ("Return to map") that returns to the
  normal map screen while resolution keeps running to completion in the
  background -- committed history is never undone because nothing was
  undone before either; a persistent Chronicles button, now always visible
  directly beneath Orders, reading already-committed history without ever
  resuming simulation. Scoped explicitly to what the current one-turn,
  non-resumable pipeline architecture actually allows -- see docs/22 for
  what a literal multi-event autoplay interrupt would require instead.
- **Phase 6 -- scenarios, migration, diagnostics, test matrix (delivered,
  docs/23):** confirmed no scenario-schema extension or migration was needed
  (every prior phase's additions are optional/defaulted); an admin-only
  order/operation/material/position diagnostics endpoint; a First Punic War
  vertical-slice test exercising every phase's mechanism end to end against
  the real scenario; a fixed bounded-growth gap in Phase 1's action history;
  and the full 28-item test matrix mapped to covered/partial/deferred with
  reasons, not silently assumed complete.

Each later phase should link back to this document rather than re-deriving
scope, and should extend `WorldState` the same additive, defaulted way this
phase did.
