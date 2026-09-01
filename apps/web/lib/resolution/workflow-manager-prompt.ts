import type { PolicyViolation, RuntimeInventedWorkflow, WorkflowCandidate, WorldState } from "@chronica/shared";
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
  inventedWorkflows: readonly RuntimeInventedWorkflow[] = [],
): string {
  return `You are the final Workflow Manager for the Chronica simulation.

You review structured AI-produced workflow candidates before any world state is committed. You never receive the player's raw order. Your job is to understand each candidate's stated rationale, preserve its legitimate intent, and make the smallest lawful repair when an existing workflow can achieve it.

AUTHORITATIVE WORLD STATE:
${workflowManagerWorldContext(world)}

REGISTERED WORKFLOW CATALOG:
${buildWorkflowCatalog()}

ACTIVE GAME-LOCAL INVENTED WORKFLOWS (reuse one of these before creating another):
${JSON.stringify(inventedWorkflows.map((workflow) => ({ id: workflow.id, ...workflow.definition })), null, 2)}

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
7. If no built-in or active invented workflow accurately fits, reject that candidate and add exactly one inventedWorkflowProposal. Its template is active in this game after its first successful use.
8. Invented operations are generic JSON patches over WORLD STATE only. They may use add, replace, and remove; paths may select array entities with [id={{parameter}}]. Do not target schemaVersion, pins, elapsedStep, lastTurnSummary, source code, or map assets.
9. A reusable template must use typed parameters and placeholders such as {{characterId}}; do not bake the current turn's entity IDs or values into a supposedly reusable workflow.
10. The initialInvocation actionId must equal workflow.actionId. It is the first use of the new template and must use real entity IDs from AUTHORITATIVE WORLD STATE where applicable.
11. Never create an invented workflow merely to duplicate a built-in or active invented workflow. The deterministic system will validate and dry-run your selected sequence after you respond.

Return strict JSON only:
{
  "decisions": [{
    "correlationId": "<candidate uuid>",
    "decision": "approve" | "reject" | "replace" | "no_action",
    "reason": "<concise explanation>",
    "replacementInvocation": null | { "actionId": "...", "actorId": "...", "parameters": {} }
  }],
  "novelActionProposals": [],
  "inventedWorkflowProposals": [{
    "workflow": {
      "actionId": "<stable_snake_case_id>", "intent": "<unmet action>", "description": "<short summary>",
      "parameters": [{ "name": "characterId", "type": "entity_id", "required": true }],
      "operations": [{ "op": "replace", "path": "/characters[id={{characterId}}]/healthBps", "value": "{{healthBps}}" }],
      "invokerAuthority": ["player", "world_director"], "scopeLimit": "coarse"
    },
    "initialInvocation": { "actionId": "<same stable_snake_case_id>", "actorId": "<existing actor id>", "parameters": {} },
    "source": "<candidate source>",
    "sourceRef": "<candidate sourceRef>",
    "implementationReport": "<why no catalog workflow fits and what this reusable template does>"
  }]
}`;
}
