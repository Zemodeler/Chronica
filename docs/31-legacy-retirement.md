# Legacy retirement: closing out the migration's final step

The migration doc's last delivery-sequence item is "retire legacy
selectors/fallbacks after replay/shadow-turn acceptance." Steps 1-5 each
intentionally kept something rather than deleting it — a safety net, a
repurposed deterministic function, a schema remnant. This step is an
inventory of all of it: what was safe to delete outright, what still needs
real evidence before it can go, and what is permanent infrastructure that
was never actually a "legacy fallback" to begin with.

## Deleted this step

**`resolveIntentConflicts`** ([conflicts.ts](../packages/shared/src/character-agency/conflicts.ts),
deleted). Docs/30 already called it retired from the pipeline; nothing but
its own test imported it. There was no removal criterion to satisfy — it was
never a fallback awaiting evidence, just orphaned code from before Step 5's
rewrite. Deleted along with `conflicts.test.ts`.

**The old `buildIntentSocialEvent`/local `SOCIAL_ACTION_EFFECT`**
([character-agency.ts](../apps/web/lib/resolution/character-agency.ts)).
Superseded by the real workflow's own copy in
[npc-agency.ts](../packages/shared/src/workflows/definitions/npc-agency.ts)
since Step 5; had zero callers outside its own test. Deleted along with its
test cases; every other export in that file (`buildIntentInvocation`,
`resolveFormedNpcIntentOutcome`, etc.) is untouched and still live.

## Still in place, on purpose — now with a real bar to clear

Two deterministic safety nets remain active, each with its own stated
removal criterion that genuinely has not been met — no game has produced
the volume of turns either criterion asks for. Both criteria are now a
concrete, checkable number instead of aspirational language:

- **[military-emergency-fallback.ts](../apps/web/lib/resolution/military-emergency-fallback.ts)**:
  remove once [`getMilitaryFallbackFiringRate`](../packages/db/src/queries/military-fallback-metrics.ts)
  reports a 0% firing rate across at least 20 turns of active play,
  cross-game. See docs/29.
- **[commitment-safety-net.ts](../apps/web/lib/resolution/commitment-safety-net.ts)**:
  same bar, now checkable the same way — its firings are tagged
  `sourceRef: "commitment_safety_net"` in `workflow_audit.candidates`
  (`pipeline.ts`'s Step 6c, added this step) and aggregated by the new
  [`getCommitmentSafetyNetFiringRate`](../packages/db/src/queries/commitment-safety-net-metrics.ts),
  exposed at `/api/admin/commitment-safety-net-metrics` (cross-game) and
  `/api/admin/commitment-safety-net-metrics/[gameId]` (per-game), the same
  `developer()`-gated, `Cache-Control: private, no-store` pattern as every
  other admin diagnostics route. See docs/30.

Neither is removed by this step. Making the bar checkable is the point —
retiring either one is a future step's job, once the number actually clears
the bar.

## The invented-action escape hatch: same treatment, one gap closed

`allowInventedActions`/`DEFINE_ACTION_TOOL`/`INVOKE_DEFINED_ACTION_TOOL`
([tools.ts](../packages/shared/src/gm/tools.ts),
[session.ts](../packages/shared/src/gm/session.ts)) defaults off and has no
env var set anywhere in this repo — it has likely never fired outside its
own tests. Docs/27's removal criterion is "no active campaign has unreviewed
defined actions." The `invented_workflows` table
([schema/game.ts](../packages/db/src/schema/game.ts)) has no separate
"reviewed" flag — a developer's review is recorded only as
`setInventedWorkflowStatus` disabling a row — so a still-`active` row is
exactly an unreviewed one. The new
[`getUnreviewedDefinedActionCount`](../packages/db/src/queries/invented-workflows.ts)
counts them, per-game or cross-game, alongside the package's other
diagnostics queries. Like every other query in that file, it has no
dedicated test: this repo has no DB-round-trip test harness for query
functions anywhere (the fallback-metrics queries' own tests cover only
their pure parsing logic, `fallbackFired`/`commitmentSafetyNetFired`, not a
real database read), so this follows the existing, already-established
convention rather than introducing new test infrastructure to reach one
function.

## `temporary-patch.ts` / `manager-types.ts` schema remnants: confirmed still needed

`TemporaryWorkflowPatchSchema` ([temporary-patch.ts](../packages/shared/src/workflows/temporary-patch.ts))
is embedded in `NovelActionProposalSchema`
([manager-types.ts](../packages/shared/src/workflows/manager-types.ts)),
which in turn types `insertNovelActionProposals`
([workflow-proposals.ts](../packages/db/src/queries/workflow-proposals.ts)) —
a real, still-present write path against the real `novel_action_proposals`
table, even though `pipeline.ts` hardcodes `novelActionProposals: []` on
every turn today. This is not dead code the way `resolveIntentConflicts`
was: it is the type a historical row still needs to round-trip through, and
the write path it feeds is still wired into `resolution.ts`. Left in place;
nothing to retire here without a separate decision about the
`novel_action_proposals` table itself, which is out of scope for this step.

`invented-workflow.ts`'s `applyInventedWorkflow`/`InventedWorkflowDefinitionSchema`
are not a remnant at all — they are the live implementation the invented-action
escape hatch above actually calls (`session.ts`'s `invokeDefinedAction`) when
`allowInventedActions` is on. They retire together with the escape hatch
itself, not separately.

## Permanent advisory infrastructure — not fallbacks, nothing to do

`evaluateSupport`/`positionFromScore`
([political-resolver.ts](../packages/shared/src/character-agency/political-resolver.ts))
and `generateCandidateActions`/`scoreCandidate`/`rankCandidates`
([candidates.ts](../packages/shared/src/character-agency/candidates.ts),
[scoring.ts](../packages/shared/src/character-agency/scoring.ts)) are the
advisory-context data path itself now (docs/29, docs/30), not a temporary
stand-in for anything. They stay indefinitely.
