import type { PolicyViolation, WorkflowCandidate, WorldState } from "@chronica/shared";
import { buildWorkflowCatalog } from "@chronica/shared";

function workflowManagerWorldContext(world: WorldState): string {
  // IDs are included with the material state the manager needs to repair an
  // invocation without relying on narrative guesswork.
  const context = {
    elapsedStep: world.elapsedStep,
    characters: world.characters.map((c) => ({ id: c.id, name: c.name, alive: c.alive, polityId: c.polityId, locationProvinceId: c.locationProvinceId, officeId: c.officeId })),
    polities: world.map.polities.map((p) => ({ id: p.id, name: p.name })),
    provinces: world.map.provinces.map((p) => ({ id: p.id, name: p.name, controllerPolityId: p.controllerPolityId, firmnessBps: p.controlFirmnessBps })),
    forces: world.material.forces.map((f) => ({ id: f.id, name: f.name, polityId: f.polityId, locationId: f.locationId, commanderCharacterId: f.commanderCharacterId, controllerCharacterId: f.controllerCharacterId, moraleBps: f.moraleBps })),
    accounts: world.material.accounts.map((a) => ({ id: a.id, owner: a.owner, balance: a.balance, status: a.status })),
    accountAccess: world.material.accountAccess.map((a) => ({ characterId: a.characterId, accountId: a.accountId, permissions: a.permissions })),
    conflicts: world.conflicts,
    storylines: (world.storylines ?? []).map((s) => ({ id: s.id, title: s.title, phase: s.phase })),
  };
  return JSON.stringify(context, null, 2);
}

export function buildWorkflowManagerSystemPrompt(
  world: WorldState,
  candidates: readonly WorkflowCandidate[],
  diagnostics: readonly { correlationId: string; violation: PolicyViolation | null }[],
): string {
  return `You are the final Workflow Manager for the Chronica simulation.

You review structured AI-produced workflow candidates before any world state is committed. You never receive the player's raw order. Your job is to understand each candidate's stated rationale, preserve its legitimate intent, and make the smallest lawful repair when an existing workflow can achieve it.

AUTHORITATIVE WORLD STATE:
${workflowManagerWorldContext(world)}

REGISTERED WORKFLOW CATALOG:
${buildWorkflowCatalog()}

PROPOSED WORKFLOW CANDIDATES (in required execution order):
${JSON.stringify(candidates, null, 2)}

DETERMINISTIC DIAGNOSTICS FOR THE ORIGINAL REQUESTS:
${JSON.stringify(diagnostics, null, 2)}

DECISION RULES:
1. Return exactly one decision for every candidate correlationId, in the supplied order.
2. "approve" means the original invocation is already valid and appropriate.
3. "replace" means use one existing catalog workflow with valid parameters to accomplish the same stated intent. Do not add a new action or broaden the intended effect.
4. "reject" means the intended effect is not lawful, grounded, or achievable by an existing workflow. "no_action" means no state mutation is warranted.
5. A known diagnostic is a cue to repair when possible, not a reason to blindly reject. Never approve a request with an unresolved diagnostic.
6. Replacements must use real entity IDs from the authoritative world state. Do not guess IDs, entities, balances, or military forces.
7. If no registered workflow accurately fits, reject that candidate and add exactly one novelActionProposal with a bounded temporaryPatch. The patch runs only for this turn; its generated TypeScript is downloaded for developer review and is never executed as code.
8. A temporaryPatch may use ONLY these four operation kinds: account_delta, province_control, character_state, create_storyline. No other kind values exist. Use existing entity IDs and the smallest necessary effect.
9. Include an implementationReport explaining the unmet need, the temporary patch that was applied, and what a permanent workflow must implement.
10. The deterministic system will validate and dry-run your selected sequence after you respond.

Return strict JSON only:
{
  "decisions": [{
    "correlationId": "<candidate uuid>",
    "decision": "approve" | "reject" | "replace" | "no_action",
    "reason": "<concise explanation>",
    "replacementInvocation": null | { "actionId": "...", "actorId": "...", "parameters": {} }
  }],
  "novelActionProposals": [{
    "intent": "<unmet action>",
    "targetEntityIds": ["<existing ids>"],
    "estimatedMutationDescription": "<state change>",
    "source": "<candidate source>",
    "sourceRef": "<candidate sourceRef>",
    "temporaryPatch": {
      "id": "<uuid>", "title": "<title>", "rationale": "<why>", "actorId": "<existing actor id>",
      "operations": [
        { "kind": "account_delta", "accountId": "<id>", "amount": -100, "reason": "<why>" },
        { "kind": "province_control", "provinceId": "<id>", "controllerPolityId": "<id>", "firmnessBps": 5000 },
        { "kind": "character_state", "characterId": "<id>", "healthBps": 8000, "locationProvinceId": "<id>", "polityId": "<id>" },
        { "kind": "create_storyline", "storylineId": "<new-uuid>", "title": "<title>", "participantIds": ["<id>"], "provinceId": "<id or null>", "phase": "<phase>", "stakes": "<stakes>", "nextDevelopment": "<next>", "visibility": "public" }
      ]
    },
    "implementationReport": "<what was needed, temporarily implemented, and required permanently>"
  }]
}`;
}
