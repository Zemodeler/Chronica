# NPC action selection: from deterministic execution to AI choice

The migration doc's delivery sequence item 5 is "move NPC action selection
from deterministic ranking to AI choice constrained by their state." Before
this document, the Game Master could already originate any NPC's action
freely — a real test proved it
([game-master.test.ts](../apps/web/lib/resolution/game-master.test.ts), the
GM calling `create_force` for the NPC `hanno` with zero pre-formed
proposals) — but a deterministic pipeline step still generated, ranked, and
for two of its five outcome branches, *executed* an NPC's action before the
Game Master ever ran, with no AI involvement at all:

| Branch | Before | After |
|---|---|---|
| Blocked by conflict (`resolveIntentConflicts`) | Deterministic priority pre-pass; never reached a command | Retired — a genuine conflict is refused by the command's own precondition check when attempted |
| Commitment action (`fulfill_commitment`/`defer_commitment`/`break_commitment`) | Executed directly by plain functions in [commitments.ts](../packages/shared/src/character-agency/commitments.ts); no GM tool existed | Registered `agent_action` commands ([npc-agency.ts](../packages/shared/src/workflows/definitions/npc-agency.ts)); the GM chooses whether/how to resolve them |
| Legal-workflow proposal (`advance_plot`/`seek_office`/`economic_action`) | Offered to the GM as a proposal it could act on or ignore | Unchanged — this was already the target shape |
| Social event (`threaten`/`reconcile`/`offer_favour`/`negotiate`/`publicly_oppose`) | Applied immediately via `applySocialEvents`, deterministic effect table, no GM tool | Registered `record_character_social_action` command; target, kind, and stated reason are the GM's choice |
| No mechanical effect | Inert no-op | Unchanged |

## What's AI-chosen now, and what stays deterministic

**AI-chosen**: whether an NPC fulfills, defers, or breaks a due commitment;
whether and how an NPC takes a social action, at whom, and why. Both reach
the Game Master the same way `advance_plot`/`seek_office`/`economic_action`
already did — one proposal per character in `npcFormedIntentions`, plus the
Game Master's own free-`actorId` capability to originate an action for any
NPC regardless of any proposal.

**Stays deterministic** (mechanics, not strategy, per the migration doc's own
principle):
- `fulfillCommitment`/`deferCommitment`/`breakCommitment`
  ([commitments.ts](../packages/shared/src/character-agency/commitments.ts)) —
  unchanged. Fulfilling a commitment spends exactly the promised resource;
  breaking one raises exactly the same pressure it always did. The *decision*
  moved to the AI; the *mechanics of keeping or breaking a promise* did not.
- `SOCIAL_ACTION_EFFECT`'s kind→dimension/magnitude table
  ([npc-agency.ts](../packages/shared/src/workflows/definitions/npc-agency.ts)) —
  a threat always moves fear by the same fixed amount. The AI chooses the
  target, the kind, and the stated reason; it does not set the magnitude.
- `generateCandidateActions`/`scoreCandidate`/`rankCandidates`
  ([candidates.ts](../packages/shared/src/character-agency/candidates.ts),
  [scoring.ts](../packages/shared/src/character-agency/scoring.ts)) — kept
  exactly as they were, but repurposed: no longer a decision, now advisory
  context. `game-master-prompt.ts`'s `npcContext()` shows each selected
  character's top candidates with score and rationale, the same way Step 4
  turned `evaluateSupport` into a suggested lean rather than a computed vote.

## `actionAllowance`, actually enforced

`GameMasterSession`'s relevance-derived per-character `actionAllowance` was
computed and threaded all the way into the session
([session.ts](../packages/shared/src/gm/session.ts)) but `actionLimitRefusal`
only checked *membership* in the turn's active cast, never a count against
the allowance — `actionsByActor` was incremented every action but never
read. "AI choice constrained by their state" needs a real constraint to be
meaningful, so `actionLimitRefusal` now refuses once a character's count
reaches its allowance. This is the one behavior change with a real chance of
affecting existing turns; `apps/web`'s existing Game Master tests (which use
an empty `selectedCharacters`, and so an empty allowance map) were
unaffected, and a colocated test
([action-allowance.test.ts](../packages/shared/src/gm/action-allowance.test.ts))
covers the enforcement directly.

## The commitment safety net

Before this document, a due commitment was *always* resolved every turn it
came due — deterministically, whether or not anyone was paying attention.
Making resolution the Game Master's own choice means an ignored commitment
would otherwise sit `pending` forever. `commitment-safety-net.ts` closes that
gap the same way `military-emergency-fallback.ts` closes the equivalent gap
for an unanswered invasion: narrow, documented, and honest about being a
temporary exception to the command contract (docs/27) rather than a permanent
fixture.

It only ever auto-*defers* — never auto-fulfills (that would spend a
resource on the promisor's behalf) and never auto-breaks (a real reputational
penalty) — and only once a commitment has sat unresolved for
`GRACE_WINDOW_STEPS` (3) past its own review step, giving the Game Master
real turns to act first. **Removal criterion**: remove it once shadow-turn or
production evidence shows the Game Master reliably resolves every due
commitment without this backstop ever firing — the same standard
`military-emergency-fallback.ts` is held to, not a code-reading audit alone.
**The bar itself (docs/31):** a firing rate of 0% sampled across at least 20
turns of active play, cross-game, the same threshold and sample size as the
military-emergency fallback's own criterion. Every firing is tagged
`sourceRef: "commitment_safety_net"` in `workflow_audit.candidates`
(`pipeline.ts`'s Step 6c) and aggregated by
[`getCommitmentSafetyNetFiringRate`](../packages/db/src/queries/commitment-safety-net-metrics.ts),
exposed at the same `developer()`-gated admin routes pattern as the military
fallback's own metric.

## Retired: `resolveIntentConflicts`

[conflicts.ts](../packages/shared/src/character-agency/conflicts.ts)'s
deterministic priority pass (shared-account, exclusive-office, and
exclusive-target contention) is no longer called from the pipeline. Once
nothing pre-executes, a genuinely conflicting second attempt — two NPCs both
claiming an office, two claims exceeding one account's balance — is refused
by that command's own precondition check when the Game Master actually
tries it (`appoint_to_office` already refuses a seat already held by someone
else; `remove_gold` already caps at the account's real balance). The function
was kept as a pure, tested utility for one further step, then deleted in
docs/31 once confirmed to have zero remaining callers.

## Domain-migration deliverables (per the wider migration doc)

- **Inventory**: the table above, and the fact that 10 of the 21
  `CharacterIntentActionType` values (`renegotiate_commitment`, `seek_support`,
  `request_assistance`, `travel`, `prepare`, `wait`, `investigate`,
  `spread_belief`, `military_action`, `sponsor_procedure`) are never
  generated by `generateCandidateActions` at all today — schema-only, dead
  in practice, and out of scope for this step.
- **Command-level tests**: [npc-agency.test.ts](../packages/shared/src/workflows/definitions/npc-agency.test.ts).
- **One AI-tool-loop integration test**:
  [game-master.test.ts](../apps/web/lib/resolution/game-master.test.ts)'s
  "resolves an NPC's due commitment and records a social action with no
  pre-formed proposal" test.
- **Replay fixture**: `npc-agency.test.ts`'s byte-identical-twice tests for
  `fulfill_commitment` and `record_character_social_action`.
