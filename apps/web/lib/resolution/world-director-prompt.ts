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
      return `  [${i}] id=${p.id} | sources=${p.sources.join("+")} | kind=${p.kind} | salience=${p.salience} | scope=${p.scopeTag}\n      rationale: ${p.mergedRationale.slice(0, 120)}\n      workflows: ${workflowDesc}`;
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

Respond with strict JSON only: { "decisions": [...] }`;
}
