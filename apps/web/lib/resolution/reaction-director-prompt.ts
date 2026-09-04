import "server-only";

import { buildWorkflowCatalog, type RuntimeInventedWorkflow, type WorldState, type Verdict } from "@chronica/shared";
import { buildPlayerResolutionContext, WORKFLOW_MUTATION_RULE, type ResolutionPlayerContext } from "./prompts";

// Reaction Director prompt builder.
//
// The Reaction Director runs AFTER player execution and analyses what NPCs,
// institutions, and factions would visibly do in response to the resolved
// player consequences. A public, spectacular failure is also a consequence:
// it can damage authority or invite a response even when the impossible order
// itself had no workflow-backed state mutation.

export function shouldRunReactionDirector(verdicts: readonly Verdict[]): boolean {
  return verdicts.some(
    (v) => {
      const playerInvolved = v.playerInvolvement?.some((p) => p.role === "actor" || p.role === "target");
      const publiclyVisible = v.knowledgeVisibility !== "private";
      const hasDirectConsequence = v.deltas.length > 0;
      const isPublicFailure = v.outcome === "fails" || v.outcome === "backfires" || v.outcome === "impossible";
      return playerInvolved && publiclyVisible && (hasDirectConsequence || isPublicFailure);
    },
  );
}

export function buildReactionDirectorSystemPrompt(
  world: WorldState,
  verdicts: readonly Verdict[],
  playerCharacterId: string,
  context?: ResolutionPlayerContext,
  inventedWorkflows: readonly RuntimeInventedWorkflow[] = [],
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

  // A polity the player's own turn directly bears on -- their army is
  // standing in its territory, or a verdict's workflow deltas name it or one
  // of its provinces/forces -- is a reactor regardless of whether it happens
  // to border the player's home polity. Without this, a target several
  // provinces from home (the common case: an army marches somewhere first,
  // *then* the player acts on it) never appears in the reactor list at all,
  // and the model has nothing to react with except unrelated NEAR-scope
  // neighbors of home. See docs' reactive-polity requirement: a direct
  // invasion/attack must outrank background storylines.
  const allPolityIds = new Set(world.map.polities.map((p) => p.id));
  const directlyTargetedPolityIds = new Set<string>();
  for (const force of world.material.forces) {
    if (force.polityId !== playerPolityId) continue;
    const controllerPolityId = world.map.provinces.find((pr) => pr.id === force.locationId)?.controllerPolityId;
    if (controllerPolityId && controllerPolityId !== playerPolityId) directlyTargetedPolityIds.add(controllerPolityId);
  }
  const scanForPolityIds = (value: unknown): void => {
    if (typeof value === "string") {
      if (allPolityIds.has(value) && value !== playerPolityId) directlyTargetedPolityIds.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) scanForPolityIds(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) scanForPolityIds(item);
    }
  };
  for (const verdict of verdicts) {
    for (const delta of verdict.deltas) scanForPolityIds(delta);
  }

  const directlyTargeted = [...directlyTargetedPolityIds]
    .map((id) => world.map.polities.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  const describePolity = (p: (typeof world.map.polities)[number]): string => {
    const leaders = world.characters
      .filter((c) => c.alive && c.polityId === p.id && c.officeId)
      .slice(0, 2)
      .map((c) => `${c.name} [id: ${c.id}]`);
    return `  ${p.name} [id: ${p.id}]${leaders.length > 0 ? ` — leaders: ${leaders.join(", ")}` : " — no living character on record yet"}`;
  };

  const directlyTargetedBlock = directlyTargeted.length > 0
    ? `DIRECTLY AFFECTED THIS TURN — react to these first, ahead of any unrelated storyline below:\n${directlyTargeted.map(describePolity).join("\n")}\n\n`
    : "";

  const reactorBlock = nearPolities
    .filter((p) => !directlyTargetedPolityIds.has(p.id))
    .slice(0, 6)
    .map(describePolity)
    .join("\n");

  return `You are the Reaction Director for Chronica. The player has just resolved their actions this turn. Your job is to propose immediate NPC and institutional reactions to what just happened — visible responses from nearby leaders, factions, armies, and institutions that make the world feel consequential.

CURRENT STEP: ${world.elapsedStep + 1}
PLAYER CHARACTER: ${player?.name ?? playerCharacterId} (${world.map.polities.find((p) => p.id === playerPolityId)?.name ?? "?"})

RESOLVED PLAYER ACTIONS THIS TURN:
${verdictBlock}

${directlyTargetedBlock}NEARBY ENTITIES WHO MIGHT REACT (STAR/NEAR scope):
${reactorBlock || "  (none identified)"}

ACTIVE WARS: ${world.conflicts.wars.map((w) => {
    const pA = world.map.polities.find((p) => p.id === w.polityAId)?.name ?? w.polityAId;
    const pB = world.map.polities.find((p) => p.id === w.polityBId)?.name ?? w.polityBId;
    return `${pA} vs ${pB}`;
  }).join("; ") || "none"}

${buildPlayerResolutionContext(world, context)}

REGISTERED WORKFLOW CATALOG:
${buildWorkflowCatalog(inventedWorkflows)}

${WORKFLOW_MUTATION_RULE}

YOUR TASK: Propose reactions from nearby entities to the player's resolved actions. Each reaction must be caused by something the player actually did (use causalVerdictId). Reactions must be plausible — entities can only react to information they could realistically have received.

PRIORITY ORDER — a polity listed under "DIRECTLY AFFECTED THIS TURN" above outranks everything else this turn. If the player invaded, attacked, occupied, threatened, or marched an armed force into a polity's own territory, that polity's reaction (defending, mobilizing, fortifying, appealing for help, offering terms, or splitting into war/peace factions) must be among your proposals even if it has no character on record yet — a thin or empty roster is never a reason to skip it. Rank proposals in this order and do not let a lower tier crowd out a higher one just because it is more developed in existing world state:
  1. Direct invasion, attack, occupation, or destruction affecting a polity this turn.
  2. Immediate threat to a polity's capital, core territory, leadership, army, or survival.
  3. Urgent consequences of the player's newest strategic action (e.g. a war just authorized, even if the linked military move itself is still pending).
  4. Existing narrative crises and background developments (e.g. a storyline unrelated to this turn's directive).
  5. Ambient world activity.
A background storyline (tier 4) may only take a proposal slot ahead of a directly affected polity (tiers 1-3) when it has an explicitly stronger, immediate reason to — never merely because it already has more established characters and history.

A publicly visible failed, backfired, or impossible order may itself cause a reaction: a command can embarrass its issuer, unsettle supporters, or encourage an existing rival. Treat the failure stated in the verdict as the only established cause. Do not invent a battle, mutiny, death, faction, or material loss merely to make the scene dramatic; propose one only when a real entity can plausibly act through a registered workflow, and let that workflow determine whether it actually occurs.

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
5. Do not invent new settlements, provinces, or polities — use IDs from world state only. A new military force for an existing polity is not covered by this rule; see rule 8.
6. A reaction of salience 7–10 deserves Chronicle mention; lower is background.
7. proposedWorkflows may use only exact actionIds from the registered workflow catalog. Use [] only for a reaction with no world-state mutation, or a clearly identified novel action that cannot be represented by a registered workflow.
8. A polity is never undefended just because its roster is empty. If a verdict put a hostile force in a polity's territory, or declared/escalated a war against it, and that polity has no living character to act as reactorId, still propose the reaction: set reactorId to the polity id, and use the literal actorId placeholder "$cast" in proposedWorkflows for whatever a defending leader would do first (typically raising a force with create_force). The World Director casts the actual leader and resolves "$cast" to them — this is not inventing a faction, it is the polity defending itself.

Respond with strict JSON only: { "proposals": [...] }`;
}
