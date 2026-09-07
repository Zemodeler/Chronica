# The remaining NPC intent types: from schema-only to AI choice

Step 5 (docs/30) rewrote NPC action selection so the Game Master chooses
whether an NPC fulfills a commitment or takes a social action, but
`CharacterIntentActionType` has 21 values and `generateCandidateActions`
only ever produced 11 of them. `scoring.ts` already had drive/trait weights
for every one of the 21 -- the gap was candidate generation and
`buildIntentInvocation` (`apps/web/lib/resolution/character-agency.ts`)
never producing or translating the other 10, so even the one that was
already generated (`request_assistance`, with no real target and an empty
`legalWorkflowIds`) always fell through to the inert "no mechanical effect"
branch.

`wait` and `prepare` stay permanent, deliberate no-ops -- the "nothing to do
yet" baseline docs/30 already established, not something to wire up. This
step wires up the other 9.

## What each one reuses

| Action type | What it reuses | New code |
|---|---|---|
| `travel` | The existing `move_character` command | A candidate branch in `candidates.ts`'s active-plot loop |
| `sponsor_procedure` | The existing `sponsor_procedure` command -- and `appoint_to_office`'s own stated precondition ("requires an already-resolved, passed appointment procedure") shows this is the *missing prerequisite step* `seek_office` skipped before this step | Two candidate branches (`opportunityCandidates`, `socialPressureCandidates`'s rival branch) |
| `seek_support`, `request_assistance` | The existing `record_character_social_action` command and its `SOCIAL_ACTION_EFFECT` table (`npc-agency.ts`) -- two more fixed-magnitude entries, no new workflow | A new goal-driven branch (`seek_support`); a real target added to the already-generated `request_assistance` candidate |
| `spread_belief` | `CharacterSocialEvent.proposedBeliefs` (`characters/social-events.ts`) -- already real, tested machinery `applySocialEvents` grants beliefs from, previously only reached by dialogue | A new `spread_belief` workflow (`npc-agency.ts`) and a candidate branch reading the actor's own damaging beliefs about a rival |
| `investigate` | `characterBeliefs` -- a self-targeted confidence raise, the mirror of the existing `reduceConfidence` | A new `investigateBelief` function (`characters/beliefs.ts`) and workflow, and a candidate branch |
| `renegotiate_commitment` | `checkCommitmentAuthority`, the same validation `fulfillCommitment`/`deferCommitment`/`breakCommitment` already use | A new `renegotiateCommitment` function (`character-agency/commitments.ts`) and workflow, and a candidate branch |
| `military_action` | The existing `start_battle` command, scoped to same-province engagement only (no pathfinding/adjacency modeling) | A candidate branch reading `world.material.forces` and `world.conflicts.wars` |

Nothing here required a new `WorldState` field. Every new command reads
state that already existed; `sponsor_procedure`'s candidate leaves
institution, eligibility requirements, and participants null/empty rather
than guessing at data only the Game Master's own read tools can see live --
the candidate is advisory context, never auto-invoked, so the Game Master
constructs its own complete call if it decides to act.

## A genuine tuning finding: `investigate`'s trigger had to be narrow

The first version proposed `investigate` for any suspicion below 70%
confidence. In the opening-turn Punic Wars scenario, this made "investigate
a routine, low-stakes suspicion about Rome watching the strait" outscore
Hanno's own authored, narratively central plot -- not a bug in the wiring,
but a real design lesson: a bar wide enough to sweep in the kind of
background uncertainty nearly every character starts the game holding
crowds out the state a scenario actually authored to matter. The trigger is
now confidence <40 -- genuinely weak, not merely "not yet certain."

## What stays out of scope

- `wait`/`prepare` remain permanent no-ops (docs/30).
- `evaluateSupport`/`generateCandidateActions`/`rankCandidates` remain
  advisory context, unchanged in role (docs/31).
- Nothing here touches the two active safety nets or the invented-action
  escape hatch (docs/31) -- their own removal criteria are a separate,
  evidence-gated decision.

## Tests

- `candidates.test.ts` -- one test per new/extended branch, including the
  narrowed `investigate` threshold.
- `npc-agency.test.ts` -- authority checks and a same-snapshot-twice replay
  test for the 3 new workflows (`renegotiate_commitment`, `investigate`,
  `spread_belief`), plus the two new `record_character_social_action` kinds.
- `beliefs.test.ts` -- `investigateBelief`'s confidence math.
- `character-agency.test.ts` -- a `buildIntentInvocation` case for each of
  the 7 wired-up types.
- `game-master.test.ts` -- one GM-tool-loop integration test showing the
  Game Master can originate `renegotiate_commitment` and `spread_belief` for
  an NPC directly, with no pre-formed proposal, the same unrestricted way
  `create_force` already could.
