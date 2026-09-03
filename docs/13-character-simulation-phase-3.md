# Character simulation, phase 3: autonomous character agency and commitments

Phase 2 gave every important character a private mind, pressures,
multidimensional relationships, and an individually-owned belief store, but
left two real gaps behind: the Character Director's goal/plot suggestions
were pure advice that nothing ever committed to `world.characterGoals`/
`characterPlots`, and a dialogue "promise" was a regex-matched DB row with no
check that the NPC could actually keep it. Phase 3 closes both, and adds the
missing piece entirely: a bounded, scored, deterministic process that lets an
NPC choose and carry out one concrete action of their own, entirely without
player involvement.

## The intent hierarchy

One coherent chain, most enduring to most concrete, each already-existing
concept kept exactly where it was:

- **Drive** (Phase 2 `CharacterMind.drives`) -- security, status, wealth,
  family, faith, duty, revenge.
- **Ambition** (`Character.ambitions`, unchanged) -- a long-term desired
  outcome, e.g. a targeted office.
- **Goal** (`CharacterGoal`, unchanged schema) -- a current, achievable
  objective.
- **Plan** (`CharacterPlot`, unchanged schema -- this *is* the "bounded
  route toward a goal" the spec asks for; no new type was needed).
- **Intent** (`CharacterIntent`, new --
  `packages/shared/src/character-agency/intents.ts`) -- one concrete action
  a character wants to take this turn: actor, source goal/plot/commitment,
  action type, targets, rationale, prerequisites, candidate workflow ids,
  priority, and a status (`proposed → prepared/blocked → executed/deferred/
  failed/abandoned`) that always carries the reason it landed there.
- **Commitment** (`Commitment`, new --
  `packages/shared/src/character-agency/commitments.ts`) -- an obligation
  owed to another character, itself a future source of an intent (fulfil,
  defer, renegotiate, or break it).

## Two real gaps, closed

**Goal/plot bookkeeping already had a validated workflow, just no caller.**
`create_character_goal`, `update_character_goal`, `create_character_plot`,
`advance_character_plot`, and `resolve_character_plot`
(`packages/shared/src/workflows/definitions/character-agency.ts`) already
existed, fully guarded (goal/plot caps, alive-actor checks, deterministic
ids) -- but `pipeline.ts` never built a `WorkflowCandidate` from an approved
`CharacterSuggestion`, so an "approved" goal or plot suggestion never
actually became one. `apps/web/lib/resolution/character-agency.ts`'s
`buildCharacterSuggestionInvocation` is the missing translation: an approved
suggestion becomes a real invocation of the existing workflow, fed through
the same `runWorkflowManager`/`executeWorkflows` gate as every other action
this turn.

**A dialogue "promise" checked nothing.** `extractDialogueCommitment`
(deleted this phase) pattern-matched an NPC's reply for phrases like "I
will..." and wrote a DB row with a free-text `promiseType` -- no check that
the NPC held the office, or had the money, they were "promising". Canonical
`Commitment`s now flow through the exact same `CharacterSocialEvent` ledger
as a belief or a pressure change (`commitmentProposal`, extended with
`promisorCharacterId`, `requiredOfficeId`, `requiredResource`): `dialogue-
service.ts`'s structured AI call proposes one only for the NPC's own
resources (a payment names the NPC's own `personalAccountId`, never one the
AI invents), and `applySocialEvents` rejects the whole event outright if
`checkCommitmentAuthority` finds the promisor doesn't actually control what
they promised -- before any of that event's other effects apply, so a
promise no one can keep never leaves a partially-applied event behind.

## Candidate generation, scoring, and conflict resolution

For each **principal**-tier character in this turn's already-selected,
already-capped working set (`selectRelevantCharacters`, unchanged, still
capped at 8), `generateCandidateActions`
(`packages/shared/src/character-agency/candidates.ts`) reads real world
state only -- a commitment actually due, an active plot with a stated next
move, an active pressure, a rival social link, an account balance, an
ambition targeting a vacant office -- and returns a bounded list of legal
candidates: `fulfill/defer/break_commitment`, `advance_plot`, `threaten`/
`reconcile` (toward a rival), `request_assistance`/`economic_action` (under
debt), `seek_office` (under a political opportunity pressure), and always a
baseline `wait`. It never invents an army, an office, a resource, or a
target that wasn't already there.

`scoreCandidate`/`rankCandidates`
(`packages/shared/src/character-agency/scoring.ts`) is one documented,
bounded formula: drive alignment, a trait's decision modifier
(`traits.ts`'s existing `decisionModifiers`), a risk discount from
`riskTolerance`/`boldness`, current pressure urgency, existing relationship
affection/trust as a bonus for a cooperative act and a discount for an
aggressive one, a plot's own momentum, and a flat cost for choosing to wait.
Exact ties are broken by `stableHash`
(`packages/shared/src/determinism.ts`, new -- an FNV-1a hash over
characterId/step/action, the one deterministic-tie-break utility this
codebase didn't have yet) -- never by array order, never by
`Math.random()`.

Before any chosen intent executes, `resolveIntentConflicts`
(`packages/shared/src/character-agency/conflicts.ts`) reconciles every claim
on a shared, exclusive thing across this turn's chosen intents: two claims
on the same account are accepted in score order until the balance runs out,
two claims on the same office or the same military target keep only the
higher-scored one. A losing claim is marked `blocked` with a specific
reason, never silently dropped.

## Execution: still one validated path

A chosen intent becomes exactly one of three things, and never bypasses
validation to get there:

- A **commitment** action (fulfil/defer/break) calls the corresponding
  `commitments.ts` lifecycle function directly -- it spends the real
  resource (or creates the real breach pressure), the same narrow,
  deterministic pattern `applySocialEvents`/`advancePressureLifecycle`
  already established for non-workflow canonical mutations.
- A **material** action (`advance_plot`, `seek_office`, `economic_action`)
  becomes a `ProposedInvocation` (`character-agency.ts`'s
  `buildIntentInvocation`) tagged `source: "character_director"`
  (`collectCharacterAgencyCandidates`, `workflow-manager.ts` -- the
  `WorkflowCandidateSource` enum already had this value; nothing ever used
  it before this phase) and merged into the exact same `finalCandidates`
  list the player's and the World Director's invocations already go
  through, so it clears the identical policy/authority/resource checks
  (`workflows/policy.ts`) and the identical `executeWorkflows` gate.
- A **pure social** action (`threaten`, `reconcile`, `offer_favour`,
  `negotiate`, `publicly_oppose`) becomes a `CharacterSocialEvent`
  (`buildIntentSocialEvent`) applied through the same `applySocialEvents`
  ledger dialogue itself uses -- one boundary for every relation-cause
  change in the game, whether it originated in a chat reply or in a
  character's own autonomous choice.

An action with no modeled mechanical effect yet (`wait`, `prepare`, `travel`,
`investigate`, `seek_support`, `spread_belief`) is still scored, chosen, and
recorded as `executed` with an explicit "no mechanical effect modeled yet"
reason -- a deliberate, narrow scope cut (see "Deferred" below), not a
silent gap.

**Remembered**-tier characters get no candidate generation at all: their
existing `continuity.plan` (`NpcPlan`, unchanged) simply advances one step.
**Ordinary**-tier characters (or any character not in this turn's selected
working set) get none of this -- identity, location, and existing
commitments are preserved, nothing is invented.

## Turn-pipeline integration

One new step, `character_agency`, inserted between World Director and the
Workflow Manager (`apps/web/lib/resolution/pipeline.ts`): approved
suggestions become goal/plot invocations, due commitments become fulfil/
defer/break decisions or workflow-track material intents, conflicts resolve
deterministically, and everything not already resolved is merged into the
same `runWorkflowManager`/`executeWorkflows` call the player's and the World
Director's actions already share. `agencyWorld` (starting from
`resolutionWorld`, the pre-player-preview canonical state) replaces
`resolutionWorld` as the base every subsequent step executes against, so a
commitment fulfilled or a relation cause applied by an intent is visible to
the same turn's workflow execution and Chronicle. A `"prepared"` intent's
final status (`executed`/`failed`/`blocked`/`deferred`) is resolved once the
Workflow Manager's audit blob is known, by matching the intent's own id as
the candidate's `sourceRef`.

## Diagnostics

`buildCharacterInspectorView`
(`packages/shared/src/characters/inspector.ts`) now also reports a
character's `canonicalCommitments` (from `world.commitments`) and
`recentIntents` (from `world.characterIntents`) alongside everything Phase 2
already exposed -- still only via the admin-gated
`GET /api/admin/character-mind/[gameId]/[characterId]` route, never ordinary
player UI.

## Migration

No new database table and no schema migration: `world.commitments` and
`world.characterIntents` are additive, `.default([])`-guarded `WorldState`
fields, the identical pattern Phase 2 established for pressures/beliefs/
social links -- an archived snapshot from before this phase still parses.
The only compatibility concern is the pre-existing `npc_commitments` DB
table, which dialogue no longer writes to (`extractDialogueCommitment` and
its call site are deleted): `backfillLegacyCommitments`
(`packages/db/src/queries/backfill-legacy-commitments.ts`, run via
`scripts/backfill-legacy-commitments.ts`) folds each game's still-pending
legacy rows into `world.commitments` as `legacy:<row id>`-prefixed entries
(idempotent -- a row already folded in is skipped by id), deliberately
without a required office/resource (the old rows never recorded one, so
none is fabricated). `buildCharacterInspectorView` keeps reading the legacy
DB rows too (its existing `pendingCommitments` parameter, unchanged), so an
old game's un-backfilled commitments remain visible in diagnostics either
way.

## Tests

`packages/shared/src/character-agency/{commitments,intents,candidates,
scoring,conflicts}.test.ts` and `packages/shared/src/determinism.test.ts`
cover: a commitment rejected at creation for an office/resource the
promisor doesn't hold; two commitments/intents that cannot both be honored
by the same account, resolved deterministically in creation/priority order;
a cautious character discounting a risky candidate more than a bold one
under identical risk; candidate generation never inventing a target/office/
resource/plot the character doesn't already have; conflict resolution being
reproducible for the same input. `apps/web/lib/resolution/character-
agency.test.ts` covers the three invocation/event builders directly,
including every "returns null" (no mechanical translation) case.

## Deferred to phase 4

Autonomous per-turn action generation for the whole population (still
bounded to the selected working set, unchanged), factions/voting/formal
political procedures, office succession beyond existing workflow
constraints, marriage/children/inheritance, and player-facing disclosure of
private planning state are explicit non-goals here, same as the original
spec's non-goal list. Within this phase's own scope, three things are
deliberately narrower than the full spec text: (1) `wait`/`prepare`/
`travel`/`investigate`/`seek_support`/`spread_belief` intents are scored and
resolved but currently produce no mechanical world effect (recorded as
`executed` with an explicit reason) -- a real effect for these (a belief
actually spread, a character actually relocated) is straightforward to add
later using the same builder pattern; (2) `renegotiate_commitment` is
currently implemented identically to `defer_commitment` (extends the review
step) rather than as a distinct renegotiated-terms flow; (3) office
authority is checked only against whether the promisor/actor currently
holds the named office -- the deeper `Office.authorisedActionIds`
enforcement gap already documented as deferred in `workflows/policy.ts`
(no scenario-office context available in the policy layer) is unchanged by
this phase.
