# Military reaction and political choice

The migration doc's delivery sequence item 4 is "move military reaction and
political choice from pipeline logic into AI reasoning." The two halves
needed different treatment, decided after asking how far political vote
agency should go: **full AI choice**, the most literal reading of the
principle.

## Political choice: `pledge_support` now takes the AI's actual position

Before this document, every character's vote/support position on a political
procedure was entirely deterministic.
[`pledge_support`](../packages/shared/src/workflows/definitions/political-procedures.ts)
always called `evaluateSupport`/`positionFromScore`
([political-resolver.ts](../packages/shared/src/character-agency/political-resolver.ts)),
which folds relationship opinion, group loyalty, commitment history, and
institutional legitimacy into a score and discretizes it into `support`/
`oppose`/`abstain`/`undecided`. The AI could only *trigger* that computation
for a character; it could never state a position of its own.

`pledge_support` now takes `position` (`support`/`oppose`/`abstain`) and a
stated `reasonKind`/`reasonLabel` directly as parameters. `evaluateSupport`
is no longer called from inside it — the position recorded is exactly what
the caller asked for, whatever the relationship/legitimacy inputs would have
suggested. Every existing eligibility/validation check (procedure must be
open, supporter must be alive/eligible, group must be active) is unchanged:
per the migration doc's principle, *eligibility* stays deterministic; only
the *position* itself becomes the AI's choice. `withdraw_support` was already
this way (it force-sets `undecided`/weight 0 without consulting
`evaluateSupport`) and needed no change.

`evaluateSupport` didn't stop existing — it stopped deciding. It's now
advisory context only, surfaced through a new read tool:

### `inspect_political_procedure`

A new GM read tool ([gm/read-tools.ts](../packages/shared/src/gm/read-tools.ts)),
built by reusing `buildPoliticalInspectorView`
([characters/political-inspector.ts](../packages/shared/src/characters/political-inspector.ts)) —
the same function that already backs the developer-only admin political
inspector route. It returns, for one open procedure: the eligible
participants, each participant's currently recorded position (redacted for
private visibility the same way every other read tool respects
`PrivateInformationPolicy`), and — for anyone without a recorded position
yet — `evaluateSupport`'s computed lean, labelled explicitly as a suggestion
("context only, not a decision") rather than a position. A new constitution
rule (8e) tells the Game Master to use it before calling `pledge_support`,
in the same voice as the existing military/diplomatic-reaction rules.

**Why not touch NPC candidate generation**: `character-agency/scoring.ts` and
`intents.ts` already only use `"pledge_support"` as one of many generically
trait-scored `CharacterIntentActionType` labels — deciding *whether* an NPC
might want to weigh in, the same way every other intent type is scored — and
`apps/web/lib/resolution/character-agency.ts`'s `buildIntentInvocation`
switch has no case for it at all, so a `pledge_support` NPC intent has never
produced a concrete invocation. This change only affects the Game Master's
own direct tool calls, which is exactly where the doc wants the choice to
live.

## Military reaction: evidence, not removal

[military-emergency-fallback.ts](../apps/web/lib/resolution/military-emergency-fallback.ts)'s
own removal criterion (added in Step 3, [docs/28](28-diplomacy-and-map-control-audit.md))
asks for "shadow-turn or production evidence [that] the Game Master reliably
answers every `military_emergency` pressure without this backstop ever
firing." No telemetry aggregated that signal, and no test exercised real GM
behavior against it (all four existing unit tests call
`applyMilitaryEmergencyFallback` directly with a hand-built
`respondedThisTurn` list). Removing or restricting the fallback now would be
a gameplay-safety change with no supporting data — the same reason Step 3
declined to touch it.

**What this step adds is the evidence-gathering, not the removal.** Every
fallback firing was already durably recorded: `pipeline.ts` tags each one
`sourceRef: "military_emergency_fallback"` in the `finalWorkflowAudit` it
writes to `turns.workflow_audit` every turn (see the correction to
[docs/27](27-command-contract-and-taxonomy.md) below) — the missing piece
was aggregation, not instrumentation. A new query,
[`getMilitaryFallbackFiringRate`](../packages/db/src/queries/military-fallback-metrics.ts),
scans `workflow_audit.candidates` for executed fallback entries and reports
`{ totalTurns, turnsWithFallbackFiring, firingRate }`, scoped to one game or
as a cross-game rollup. Exposed at two new developer-only admin routes
(`/api/admin/military-fallback-metrics/[gameId]` and the bare
`/api/admin/military-fallback-metrics` for the rollup), following the same
`developer()`-gated pattern every other admin diagnostics route already
uses. No behavior change to the fallback itself — this is read-only,
additive instrumentation so a future removal decision has real numbers
instead of code-reading speculation.

**The bar itself (docs/31):** "shadow-turn or production evidence" is not
falsifiable on its own. The concrete threshold is a firing rate of 0% sampled
across at least 20 turns of active play, cross-game (`getMilitaryFallbackFiringRate`
with no `gameId`). Below that sample size, a run of zero firings is not yet
evidence of reliability, just an absence of data.

## Correction to docs/27

[docs/27](27-command-contract-and-taxonomy.md) previously stated "nothing in
the current pipeline populates" `turns.workflow_audit`. That's not quite
right: `pipeline.ts`'s `finalWorkflowAudit.candidates` *is* populated every
turn (seeded from the Game Master's own audit entries, then extended with
the military-fallback's and political-procedure-resolution's invocations) —
only `novelActionProposals`, the older Workflow-Manager blob's other field,
is hardcoded empty. Docs/27 has been corrected in place; this is the reason
the firing-rate query above is a read against existing data, not new
write-side plumbing.
