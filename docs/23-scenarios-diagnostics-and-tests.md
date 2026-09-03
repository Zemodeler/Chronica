# Scenarios, diagnostics, and the test matrix (docs/14 Phase 6)

## Scenarios and migration

No scenario-schema extension was required to make the redesign work against
the First Punic War scenario: `Province.positions` and `Force.positionId`
are optional (Phase 3), `MaterialWorldState.provinceMaterial` is
`.default([])` and backfilled at read time by `ensureProvinceMaterial`
(Phase 2), and `WorldState.actions`/`operations` are likewise defaulted
(Phase 1). A scenario author *may* author positions or initial province
material to override the deterministic defaults, but the built-in scenario
does not need to for every mechanism to function -- recruitment, taxation,
battle resolution, and position assignment all already work against it
out of the box, exercised directly in `packages/shared/src/vertical-slice.test.ts`.

No new database migration was needed at any phase: every addition lives
inside the existing versioned jsonb snapshot (`packages/db/src/schema/game.ts`),
defaulted so an old snapshot parses unchanged. `built-in-scenarios.test.ts`,
`punic-wars-scenario.test.ts`, and every other pre-existing scenario test
still pass unmodified (see the final regression results below).

## Diagnostics

`apps/web/app/api/admin/order-operation-inspector/[gameId]/route.ts`, in the
same developer/admin-only pattern the existing `chronicle-inspector` and
`life-inspector` routes already use (session-gated to `role === "developer"
| "admin"`, never linked from player UI), exposes: every `OngoingAction` and
`PersistentOperation` in the current snapshot (Phase 1's order/operation
lifecycle), the full `provinceMaterial` table (Phase 2), and every force's
resolved intra-province position (Phase 3), derived live from
`resolveForcePosition` rather than duplicated state. A battle-by-battle
audit log (the Workflow Manager's `workflowAudit`, already persisted per
turn) was not added to this endpoint this phase -- a real, small follow-on,
not attempted here to keep this endpoint's scope to state this phase's work
actually introduced.

## Bounded growth (a real gap, fixed here)

Reviewing Phase 1 against the "long-running simulation remains bounded"
requirement surfaced an actual bug: `projectOrdersAndOperations` appended
every turn's `OngoingAction`s onto `world.actions` with no bound at all,
while `PersistentOperation`s were already correctly bounded (only
non-terminal ones carry forward). Fixed here: every active/waiting action
is still always kept -- dropping one would silently lose in-progress work --
but a terminal action is history, and only the most recent
`MAX_TERMINAL_ACTION_HISTORY` (200, the same bound `world.characterIntents`
already uses for its own resolved-history tail) survive. Tested directly:
running 250 turns of trivial completed actions leaves exactly 200; a single
still-active action injected before that same run survives all 250 turns
untouched.

## The test matrix

Mapped against the redesign brief's 28 acceptance tests. "Covered" means a
real, passing automated test exists and is cited; "Partial" names the real
gap; "Deferred" means genuinely not attempted this session, stated plainly
rather than implied covered.

1. Simple orders get sensible defaults -- **Covered**: `order-projection.test.ts`.
2. Unauthorised orders become grounded refusals -- **Covered**: `order-projection.test.ts`, `pipeline.ts`'s `orderRefusalChronicle`.
3. NPCs use the same order model -- **Covered**: `order-projection.test.ts`.
4. Persistent operations continue across event beats -- **Covered**: `order-projection.test.ts`.
5. Settlement capture changes the very next event's state -- **Covered**: `vertical-slice.test.ts` executes a capture (`end_siege`) immediately followed by a second event (`collect_emergency_taxation`) that only succeeds because it already sees the province under its new controller.
6. Simultaneous/conflicting actions resolve deterministically -- **Covered**: `order-projection.test.ts`'s duplicate-candidate case; `workflows/policy.ts`'s pre-existing duplicate detection.
7. Interrupt returns to the map at a safe boundary, preserving history -- **Covered** (docs/22), not unit-tested: this codebase has no component-level (`.tsx`) test infrastructure at all, and introducing one for a single control was judged disproportionate; verified by typecheck/lint and manual reasoning about the dismiss-only state change.
8. Resume preserves operations; revision/cancellation changes them explicitly -- **Covered**: carry-forward, plus explicit cancellation (`applyCancellationDirectives`) now cascades a cancelled `OngoingAction` to its linked `PersistentOperation`, tested in `order-projection.test.ts`. A `"revise"` directive is still only handled at the AI-interpretation level (as a correction to the player's own wording, its pre-existing behavior), not as a structural edit to an already-committed `OngoingAction` -- a smaller, named remainder.
9. Chronicles button below Orders, showing history without resuming -- **Covered** (docs/22): `.chronicle-panel-toggle` CSS, always-rendered button, `/api/games/[gameId]/chronicle` is a pure read.
10. Recruitment affects manpower/capacity, requires authority/funds/stability/capacity -- **Covered**: manpower, territorial authority, treasury funds, and spending access are all enforced and tested (`material.test.ts`, `vertical-slice.test.ts`).
11. Taxation/requisition yields treasury gain plus material/political consequences -- **Covered**: treasury gain, a stability cost, and (when the unrest inflicted is meaningful, not a token draw) a legitimacy cost to the collecting polity are all enforced and tested (`material.test.ts`). No political-*procedure*-level consequence (e.g. a censure motion actually opening) is triggered from a taxation event -- that would need a new procedure type, a larger, separate feature from a material/legitimacy effect.
12. Supply, attrition, occupation, siege, and food shortage affect forces/provinces -- **Covered**: `Force.provisionStatus` and `foodSecurityBps` both feed the battle resolver (`battle-resolver.test.ts`); occupation/siege apply coarse province war damage (`province-material.test.ts`); a province below the food-shortage threshold now keeps eroding stability and displacing population every idle turn until fed, independent of any fresh attack (`applyCoarseRecoveryTick`'s shortage-pressure addition, tested in `province-material.test.ts`).
13. Command, position, terrain, posture, supply, readiness affect battle -- **Covered**: commander skill/health, position, terrain, supply, and posture (`offer_battle | avoid_battle | defend | hold`, forwarded from `start_battle`'s optional params) are all real inputs, tested in `battle-resolver.test.ts`.
14. Multiple forces in one province have stable, non-overlapping positions and don't auto-fight -- **Covered**: `position.test.ts`, `map-dynamic-geometry.test.ts`.
15. Valid contact triggers battle; grouped engagements render cleanly -- **Covered**: `battle-resolution.test.ts` (contact via the pre-existing battle-proximity/`start_battle` path), `map-dynamic-geometry.test.ts` (grouping).
16. Battle results create durable military, material, political, and character effects -- **Covered**: military (casualties/morale/cohesion/fatigue), material (province war damage), character (commander wound/capture/death), and political (both polities' `PolityLegitimacy` moves on a decisive victory) effects are all real and tested (`battle-resolution.test.ts`). Fixing this surfaced a genuine bug: the "decisive victory" casualty-rate threshold (0.25) was mathematically unreachable given the exchange formula's own 0.20 cap, so this effect (and the pre-existing control-firmness weakening it shares a condition with) could never fire; lowered to 0.15 and locked in with a regression test in `battle-resolver.test.ts`.
17. No AI prose creates material facts -- **Covered**: `resolve_battle`'s `invokerAuthority: ["system"]` with no `WorkflowCandidateSource` mapping to it (`workflows/policy.ts`) makes this structurally true, not just a convention; `battle-resolver.test.ts`'s determinism tests back it.
18. Peace requires valid institutional procedure -- **Covered**: `end_war` is now `invokerAuthority: ["system"]`, so no `WorkflowCandidateSource` (`workflows/policy.ts`'s `SOURCE_TO_INVOKER`) can ever get it approved as a direct player/AI proposal -- it only executes as a resolved political procedure's own authorized invocation (a `treaty_ratification`, using the pre-existing generic `linkedWorkflowId`/`linkedWorkflowParams` mechanism `resolveDueProcedures` already resolves through, which bypasses `validateCandidate` by construction, the same precedent `resolve_battle` set in Phase 3). Tested in `political.test.ts`.
19. Existing saves/scenarios migrate safely -- **Covered**: every new field is optional/defaulted; the full pre-existing scenario/migration test suite passes unmodified.
20. Mechanical replay remains deterministic -- **Covered where this work added computation**: the battle resolver (`battle-resolver.test.ts`'s same-seed-same-result case) and order-projection ids (fixed after an initial `crypto.randomUUID()` determinism bug was caught and corrected -- see docs/19). Whole-pipeline replay was already not fully deterministic before this work (`WorkflowCandidate.correlationId` uses `crypto.randomUUID()`); unchanged, not newly introduced.
21. Long-running simulation stays bounded -- **Covered**: see "Bounded growth" above.
22. Every Chronicle entry has a non-generic title -- **Partial**: `"The Refusal of <name>"` and `"Battle of <province>"` are real, specific, non-generic titles; several pre-existing streams (political procedure, command change, family event) already had reasonable per-entry titles before this work and are unchanged; none of this work's changes made any title more generic.
23. Major events receive richer scenes than minor dispatches -- **Covered**: docs/21's depth tiers, `depth.test.ts`.
24. Battle prose only uses structured deterministic battle facts -- **Covered**: docs/21's `battleBrief`, enforced by prompt instruction (not a hard runtime constraint on the LLM's output, which is a real limit of any prompt-based instruction -- see docs/21).
25. Political speeches require grounded speaker/procedure/motive/outcome -- **Deferred**: not touched this session; pre-existing behavior unchanged.
26. Speech prose cannot mutate authoritative state -- **Covered by pre-existing architecture**, unchanged: no narration path in this codebase ever calls a workflow.
27. Multi-event operations retain Chronicle continuity -- **Partial**: `PersistentOperation`/`chronicleChainId` fields exist to support this; no test exercises a multi-turn operation's Chronicle chain end-to-end.
28. Existing relevant tests, typecheck, lint, migration checks pass -- **Covered**: see the final regression results in the completion summary.

## What is still deferred, and why

Everything below was deliberately not attempted, not silently dropped.
Reasons fall into three groups:

**Would need real design work, not a quick wire-up:**
- Tactical-modifier proposals into the battle engine (`TacticalModifierProposalSchema`
  exists; `resolveBattle` never receives one). Accepting a player/NPC's novel
  tactic safely means validating preconditions and bounding its effect --
  a feature in its own right, not a parameter to add.
- Multi-force battles (`resolve_battle` requires exactly two participants,
  matching what `start_battle` always creates). Real multi-side engagements
  need side-grouping and phase-arrival rules the current shape doesn't have.
- Merging the three directors' internal level-of-detail schemes (Simulator
  scope tiers, Reaction Director geographic adjacency, Character Director
  continuity tiers) into one. Only their *Chronicle-facing* output depth
  is unified (docs/21); each still separately decides whether an event is
  generated at all. Changing that risks each director's already-tuned
  event-generation behavior for a purely internal consistency win.

**A named, smaller remainder of something already fixed:**
- A `"revise"` directive still only corrects the player's own wording at
  the AI-interpretation step (its original behavior) rather than editing
  an already-committed `OngoingAction`. Cancellation (`"cancel"`) is fully
  wired; revision is not, because "revise this order" and "structurally
  amend this in-progress operation" turned out to be different features
  once cancellation forced the distinction into view.
- A taxation event can cost legitimacy but never opens a real political
  *procedure* (e.g. an opposition motion) -- that needs a new procedure
  type, a separate feature from a material/legitimacy effect.
- Multi-turn operations carry a `chronicleChainId` field to support
  continuity across events, but no test exercises that chain end-to-end
  across two turns.
- The admin diagnostics endpoint doesn't surface the per-battle
  `workflowAudit` log (already persisted per turn) -- a small addition,
  not attempted to keep that endpoint scoped to what this phase introduced.

**Genuinely out of this redesign's scope:**
- Political speeches (grounded speaker/procedure/motive/outcome) are a
  pre-existing feature this session never touched, unrelated to
  orders/operations/material/warfare/Chronicle-depth.
