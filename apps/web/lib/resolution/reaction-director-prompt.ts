import "server-only";

import { buildWorkflowCatalog, type WorldState, type Verdict } from "@chronica/shared";
import { buildPlayerResolutionContext, type ResolutionPlayerContext } from "./prompts";

// Reaction Director prompt builder.
//
// The Reaction Director runs AFTER player execution and analyses what NPCs,
// institutions, and factions would visibly do in response to the resolved
// player consequences. It must not fire when no direct-involvement,
// non-private verdict outcome exists.

export function shouldRunReactionDirector(verdicts: readonly Verdict[]): boolean {
  return verdicts.some(
    (v) =>
      v.playerInvolvement?.some((p) => p.role === "actor" || p.role === "target") &&
      v.knowledgeVisibility !== "private" &&
      v.deltas.length > 0,
  );
}

export function buildReactionDirectorSystemPrompt(
  world: WorldState,
  verdicts: readonly Verdict[],
  playerCharacterId: string,
  context?: ResolutionPlayerContext,
): string {
  const player = world.characters.find((c) => c.id === playerCharacterId);

  // Build a summary of visible resolved verdicts
  const visibleVerdicts = verdicts
    .filter((v) => v.knowledgeVisibility !== "private")
    .slice(0, 6);

  const verdictBlock = visibleVerdicts.length > 0
    ? visibleVerdicts
        .map((v) => {
          const deltas = v.deltas.filter((d) => d.kind !== "knowledge_grant").length;
          return `  [${v.directiveId}] ${v.rationale.slice(0, 200)} | outcome: ${v.outcome} | material deltas: ${deltas}`;
        })
        .join("\n")
    : "  (none visible)";

  // NEAR scope entities: polities adjacent to player
  const playerPolityId = player?.polityId;
  const nearPolities = world.map.polities.filter((p) => {
    if (p.id === playerPolityId) return false;
    // Check for shared border
    return world.map.edges.some((e) => {
      const fromProv = world.map.provinces.find((pr) => pr.id === e.from);
      const toProv = world.map.provinces.find((pr) => pr.id === e.to);
      const fromPolity = fromProv?.controllerPolityId;
      const toPolity = toProv?.controllerPolityId;
      return (fromPolity === playerPolityId && toPolity === p.id) || (toPolity === playerPolityId && fromPolity === p.id);
    });
  });

  const reactorBlock = nearPolities.slice(0, 6)
    .map((p) => {
      const leaders = world.characters
        .filter((c) => c.alive && c.polityId === p.id && c.officeId)
        .slice(0, 2)
        .map((c) => `${c.name} [id: ${c.id}]`);
      return `  ${p.name} [id: ${p.id}]${leaders.length > 0 ? ` — leaders: ${leaders.join(", ")}` : ""}`;
    })
    .join("\n");

  return `You are the Reaction Director for Chronica. The player has just resolved their actions this turn. Your job is to propose immediate NPC and institutional reactions to what just happened — visible responses from nearby leaders, factions, armies, and institutions that make the world feel consequential.

CURRENT STEP: ${world.elapsedStep + 1}
PLAYER CHARACTER: ${player?.name ?? playerCharacterId} (${world.map.polities.find((p) => p.id === playerPolityId)?.name ?? "?"})

RESOLVED PLAYER ACTIONS THIS TURN:
${verdictBlock}

NEARBY ENTITIES WHO MIGHT REACT (STAR/NEAR scope):
${reactorBlock || "  (none identified)"}

ACTIVE WARS: ${world.conflicts.wars.map((w) => {
    const pA = world.map.polities.find((p) => p.id === w.polityAId)?.name ?? w.polityAId;
    const pB = world.map.polities.find((p) => p.id === w.polityBId)?.name ?? w.polityBId;
    return `${pA} vs ${pB}`;
  }).join("; ") || "none"}

${buildPlayerResolutionContext(world, context)}

REGISTERED WORKFLOW CATALOG:
${buildWorkflowCatalog()}

YOUR TASK: Propose reactions from nearby entities to the player's resolved actions. Each reaction must be caused by something the player actually did (use causalVerdictId). Reactions must be plausible — entities can only react to information they could realistically have received.

Output schema (return strict JSON { "proposals": [...] }):
- reactorId: the entity (character or polity id) reacting
- reactionKind: "military" | "political" | "economic" | "diplomatic" | "social"
- proposedWorkflows: up to 3 workflow invocations: { "actionId", "actorId", "parameters" }
- rationale: max 400 chars — why this entity reacts this way
- visibility: "public" | "polity" | "private"
- salience: 0–10
- causalVerdictId: the directiveId of the verdict that caused this reaction

RULES:
1. Only react to things that are publicly or polity-visible.
2. Limit to STAR and NEAR scope entities only.
3. Propose at most 6 total reactions per turn.
4. Each reaction must have at least a brief rationale grounded in the verdict above.
5. Do not invent new factions, armies, or settlements — use IDs from world state only.
6. A reaction of salience 7–10 deserves Chronicle mention; lower is background.
7. proposedWorkflows may use only exact actionIds from the registered workflow catalog. Use [] when no registered workflow fits.

Respond with strict JSON only: { "proposals": [...] }`;
}
