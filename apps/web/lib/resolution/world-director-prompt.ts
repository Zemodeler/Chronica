import "server-only";

import { buildWorkflowCatalog, type WorldState, type ConsolidatedProposalPackage } from "@chronica/shared";
import { buildPlayerResolutionContext, type ResolutionPlayerContext } from "./prompts";

// World Director prompt builder.
//
// The World Director receives the consolidated proposal package and makes final
// decisions: approve, modify, defer, or reject. It also has authority to order
// entity creation and manage storyline lifecycle.
//
// The World Director selects proposed outcomes. The final Workflow Manager
// then independently repairs, validates, and dry-runs the selected workflow
// sequence before any state is committed.

export function buildWorldDirectorSystemPrompt(
  world: WorldState,
  pkg: ConsolidatedProposalPackage,
  playerCharacterId: string,
  context?: ResolutionPlayerContext,
): string {
  const player = world.characters.find((c) => c.id === playerCharacterId);

  const proposalBlock = pkg.proposals.slice(0, 16)
    .map((p, i) => {
      const workflowDesc = p.proposedWorkflows.length > 0
        ? p.proposedWorkflows.map((w) => `${w.actionId}(${w.actorId})`).join(", ")
        : "no workflow invocations";
      return `  [${i}] id=${p.id} | sources=${p.sources.join("+")} | kind=${p.kind} | salience=${p.salience} | scope=${p.scopeTag}${p.characterId ? ` | characterId=${p.characterId}` : ""}\n      rationale: ${p.mergedRationale.slice(0, 120)}\n      workflows: ${workflowDesc}`;
    })
    .join("\n");

  const conflictBlock = pkg.conflicts.length > 0
    ? pkg.conflicts.map((c) => `  - ${c.description} (proposals: ${c.proposalIds.join(", ")})`).join("\n")
    : "  (none)";

  const openChains = (world.chronicleChains ?? []).filter((c) => !c.resolved);
  const chainBlock = openChains.length > 0
    ? openChains.map((c) => `  [${c.id}] ${c.rootCause}${c.openPressure ? ` → OPEN: ${c.openPressure}` : ""}`).join("\n")
    : "  (none)";

  const storylineBlock = (world.storylines ?? [])
    .filter((s) => s.visibility !== "private")
    .slice(0, 6)
    .map((s) => `  [${s.id}] ${s.title} | phase: ${s.phase}`)
    .join("\n");

  // A Chronicle event needs a real person to carry political conflict. The
  // roster gives the Director a bounded set of valid IDs rather than inviting
  // it to invent an untracked senator or spokesperson in prose.
  const castRoster = world.characters
    .filter((character) => character.alive && character.id !== playerCharacterId)
    .slice(0, 32)
    .map((character) => {
      const characterPolity = world.map.polities.find((polity) => polity.id === character.polityId);
      const characterProvince = world.map.provinces.find((province) => province.id === character.locationProvinceId);
      return `  ${character.name} [id: ${character.id}] | ${characterPolity?.name ?? "no polity"} | ${characterProvince?.name ?? character.locationProvinceId}${character.officeId ? ` | office: ${character.officeId}` : ""}`;
    })
    .join("\n");

  return `You are the World Director for Chronica. You receive proposals from the Reaction Director, Simulator, and Character Director, and make the final decisions about what actually happens in the world.

CURRENT STEP: ${world.elapsedStep + 1}
PLAYER CHARACTER: ${player?.name ?? playerCharacterId}

CONSOLIDATED PROPOSALS (${pkg.proposals.length} total, showing top 16 by salience):
${proposalBlock || "  (none)"}

DETECTED CONFLICTS:
${conflictBlock}

OPEN CHRONICLE CHAINS (unresolved pressures from prior turns):
${chainBlock}

ACTIVE STORYLINES:
${storylineBlock || "  (none)"}

AVAILABLE CHRONICLE CAST (living NPCs):
${castRoster || "  (none — introduce a grounded new NPC when an approved political event needs one)"}

ACTIVE WARS: ${world.conflicts.wars.map((w) => {
    const pA = world.map.polities.find((p) => p.id === w.polityAId)?.name ?? w.polityAId;
    const pB = world.map.polities.find((p) => p.id === w.polityBId)?.name ?? w.polityBId;
    return `${pA} vs ${pB}`;
  }).join("; ") || "none"}

${buildPlayerResolutionContext(world, context)}

REGISTERED WORKFLOW CATALOG:
${buildWorkflowCatalog()}

YOUR TASK: For each proposal decide approve/modify/defer/reject. For approved proposals, select the exact registered workflow invocations already proposed for that proposal. You may omit proposed invocations, but must not create, rename, or alter one.

Output schema (return strict JSON { "decisions": [...] }):
- proposalId: the id from the proposals list above
- decision: "approve" | "modify" | "defer" | "reject"
- rationale: max 400 chars — your reasoning
- finalWorkflows: array of workflow invocations to actually execute: { "actionId", "actorId", "parameters" }. Use [] to execute nothing for this proposal.
- chronicleCast: null for non-political proposals; otherwise { "role", "characterId" } for an existing NPC, OR { "role", "newCharacter": { "name", "polityId", "locationProvinceId", "officeId" } } when no existing NPC fits.

RULES:
1. Aim for at most 12 total Chronicle-worthy outcomes (high-salience approved proposals) per turn.
2. Do NOT assign a Nemesis because the slot appears empty. Nemesis must emerge organically from conflict.
3. At least one approved proposal should leave an open pressure for the next turn.
4. Prefer modifying over rejecting when a proposal has merit but wrong parameters.
5. Defer proposals that are plausible but would create too much simultaneous change.
6. All actor IDs in finalWorkflows must exist in world state.
7. In conflicts between proposals, prefer the higher-salience one unless the lower-salience is more narratively grounded.
8. Do not approve both sides of a conflict without explicitly resolving it in the rationale.
9. finalWorkflows must be a subset of that proposal's listed workflows, with exactly the same actionId, actorId, and parameters. Never invent an actionId; use [] when no listed workflow fits.
10. An approved Character Director proposal is recorded as a Chronicle character event even when its finalWorkflows array is empty. Approve it when the character development itself is grounded and meaningful.
11. Every approved political, deliberative, diplomatic, or institutional proposal needs a chronicleCast. Select a living NPC from AVAILABLE CHRONICLE CAST whenever one plausibly fits. A senate debate should have a named supporter, opponent, spokesperson, or presiding official — never an anonymous institution.
12. If no existing NPC plausibly fits, provide newCharacter with a proper period-appropriate name and a real polity and province ID. The pipeline will automatically invoke the guarded create_world_character workflow; do not put that creation in finalWorkflows. Introduce at most one NPC per proposal and only where the event genuinely needs a human voice.
13. For a newCharacter, officeId must be null unless a real office ID is known. Never fabricate an office ID.

Respond with strict JSON only: { "decisions": [...] }`;
}
