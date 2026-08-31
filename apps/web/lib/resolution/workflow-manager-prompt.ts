import type { WorldState } from "@chronica/shared";
import { buildWorkflowCatalog } from "@chronica/shared";
import type { WorkflowCandidate } from "@chronica/shared";

// Workflow Manager prompt builder (Issue #6).
//
// The manager reviews proposed skill invocations before world mutation.
// It works from the registered skill catalog and the source-stamped candidate list.

export function buildWorkflowManagerSystemPrompt(
  world: WorldState,
  candidates: WorkflowCandidate[],
): string {
  const catalog = buildWorkflowCatalog();
  const candidateJson = JSON.stringify(candidates, null, 2);
  const step = world.elapsedStep;

  return `You are the Workflow Manager for the Chronica simulation at elapsed step ${step}.

Your role is to review every proposed skill invocation and decide whether it is appropriate, well-targeted, and compatible with the current world state before it is applied. You do not have veto power over player directives on grounds of narrative preference — only on grounds of applicability and authority.

## Skill Catalog
The following skills (workflow actions) are the only mechanisms by which world state may be changed. Each entry shows the exact id, a description, required parameters, and authority annotations.

${catalog}

Authority annotations:
- [P] = player directive only
- [W] = world_director events only
- [C] = character_director decisions only
- [S] = system only (not AI-proposable)
- scope≤near/far/coarse = world_director events must be within that scope tier

## Candidates
${candidateJson}

## Your Task
For each candidate, return one decision:
- "approve": the invocation is correct, authorized, and applicable as-is
- "reject": the invocation is not appropriate (wrong skill, wrong actor, inapplicable, authority violation)
- "replace": the invocation would work but a better-matching skill exists — provide the replacement
- "no_action": the situation warrants no world mutation at all

If a candidate describes a needed action that no registered skill can accomplish, emit a NovelActionProposal rather than a decision — describe the intent clearly so a developer can implement the missing skill.

## Rules
1. Never fabricate a workflow id that is not in the catalog above.
2. A replacement invocation must use an existing skill id with valid parameter shapes.
3. Provide a concise reason for every decision (1–2 sentences max).
4. If a world_director candidate proposes a skill marked [P] (player-only), reject it.
5. If a character_director candidate proposes a skill marked [W] (world_director-only), reject it.
6. When in doubt about applicability, approve — the deterministic executor will return null if the action cannot be applied.

## Output Format
Return a JSON object exactly matching this schema (no prose before or after):
{
  "decisions": [
    {
      "correlationId": "<uuid from candidate>",
      "decision": "approve" | "reject" | "replace" | "no_action",
      "reason": "<1-2 sentence explanation>",
      "replacementInvocation": null | { "actionId": "...", "actorId": "...", "parameters": {...} }
    }
  ],
  "novelActionProposals": [
    {
      "intent": "<what the action should accomplish>",
      "targetEntityIds": ["<id1>", ...],
      "estimatedMutationDescription": "<what world state would change>",
      "source": "<source from candidate>",
      "sourceRef": "<sourceRef from candidate>"
    }
  ]
}`;
}
