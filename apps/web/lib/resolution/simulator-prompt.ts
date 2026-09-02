import "server-only";

import { buildWorkflowCatalog, type RuntimeInventedWorkflow, type WorldState, type ScopeAssignment } from "@chronica/shared";
import { buildPlayerResolutionContext, WORKFLOW_MUTATION_RULE, type ResolutionPlayerContext } from "./prompts";

// Simulator prompt builder.
//
// Replaces the three static near/far/coarse prompt functions with a single
// call that receives dynamic scope assignments and active storylines.
// The Simulator maintains persistent multi-turn storylines and generates
// new world events; it does NOT react to player actions (that is the Reaction Director).

function scopeSummary(scope: ScopeAssignment, world: WorldState): string {
  const polities = world.map.polities;
  const label = (ids: Set<string>, tier: string) => {
    const names = [...ids]
      .map((id) => polities.find((p) => p.id === id)?.name ?? id)
      .filter(Boolean)
      .slice(0, 6);
    return names.length > 0 ? `  ${tier}: ${names.join(", ")}` : null;
  };
  return [
    label(scope.star, "STAR"),
    label(scope.near, "NEAR"),
    label(scope.far, "FAR"),
    label(scope.coarse, "COARSE"),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSimulatorSystemPrompt(
  world: WorldState,
  scope: ScopeAssignment,
  playerCharacterId: string,
  context?: ResolutionPlayerContext,
  inventedWorkflows: readonly RuntimeInventedWorkflow[] = [],
): string {
  const activeStorylines = (world.storylines ?? [])
    .filter((s) => s.visibility !== "private")
    .slice(0, 8);

  const storylineBlock = activeStorylines.length > 0
    ? activeStorylines
        .map((s) => {
          const typeVal = (s as Record<string, unknown>)["type"];
          const type = typeof typeVal === "string" ? typeVal : "simulator";
          return `  [${s.id}] ${s.title} | type: ${type} | phase: ${s.phase} | next: ${s.nextDevelopment.slice(0, 120)}`;
        })
        .join("\n")
    : "  (none)";

  const wars = world.conflicts.wars.map((w) => {
    const pA = world.map.polities.find((p) => p.id === w.polityAId)?.name ?? w.polityAId;
    const pB = world.map.polities.find((p) => p.id === w.polityBId)?.name ?? w.polityBId;
    return `${pA} vs ${pB} [polityAId: ${w.polityAId}, polityBId: ${w.polityBId}]`;
  });

  // Open pressures from chronicle chains
  const openChains = (world.chronicleChains ?? []).filter((c) => !c.resolved && c.openPressure);
  const openPressureBlock = openChains.length > 0
    ? openChains.map((c) => `  - ${c.rootCause}: ${c.openPressure}`).join("\n")
    : "  (none)";

  return `You are the Simulator for Chronica. You generate independent world events and advance persistent storylines that are NOT driven by the player's most recent action. Your job is to make the world feel alive: politics shift, wars develop, famines spread, successions happen, plots mature — all independent of what the player just did.

CURRENT STEP: ${world.elapsedStep + 1}
PLAYER CHARACTER: ${world.characters.find((c) => c.id === playerCharacterId)?.name ?? playerCharacterId} [id: ${playerCharacterId}]

LIVING CHARACTERS (use one of these exact IDs as actorId whenever a workflow is proposed):
${world.characters.filter((character) => character.alive).map((character) => `  ${character.name} [id: ${character.id}]`).join("\n") || "  (none)"}

THEATRE SCOPE (polities by tier):
${scopeSummary(scope, world)}

ACTIVE WORLD STORYLINES:
${storylineBlock}

OPEN PRESSURES FROM PRIOR TURNS:
${openPressureBlock}

ACTIVE WARS: ${wars.length > 0 ? wars.join("; ") : "none"}

PREVIOUS TURN (COMMITTED OUTCOME):
${world.lastTurnSummary ?? "  No previous turn has been resolved yet."}

${buildPlayerResolutionContext(world, context)}

REGISTERED WORKFLOW CATALOG:
${buildWorkflowCatalog(inventedWorkflows)}

${WORKFLOW_MUTATION_RULE}

YOUR TASK: Propose world events and storyline developments that are plausible given the world state. Each proposal must include the concrete workflow invocations that make the event materially real.

Output schema (return strict JSON { "proposals": [...] }):
- kind: "new_event" | "advance_storyline" | "create_storyline" | "resolve_storyline"
- storylineId: id of an existing storyline to advance/resolve, or null for new events
- proposedStorylineTitle: title for new storylines, null otherwise
- proposedWorkflows: array of up to 4 workflow invocations: { "actionId", "actorId", "parameters" }. Every actorId must be one of the exact living-character IDs above; it must never be null. Use [] if the event is narrative only or no registered action fits.
- scopeTag: "star" | "near" | "far" | "coarse" (must match the theatre scope above)
- summary: max 480 chars — the event in plain prose, third-person factual
- visibility: "public" | "polity" | "private"
- salience: 0–10

RULES:
1. Do NOT react to the raw player order — that is the Reaction Director's role. The committed previous-turn outcome above is historical context, not a current player order. Pending dialogue commitments are durable world pressures and may be advanced only when their stated conditions make that plausible.
2. Every active storyline should receive at least a brief continuation or status note.
3. Far and coarse events should be brief (2–3 per scope tier max).
4. Prefer advancing existing storylines over creating new ones unless a genuine new thread emerges.
5. All entity IDs must be real IDs from the world state above.
6. Salience 7–10 = major development worth its own Chronicle entry. Salience 0–3 = background.
7. Do not resolve a storyline unless the narrative clearly calls for it.
8. Propose at most 12 total events.
9. proposedWorkflows may use only exact actionIds from the registered workflow catalog. Do not invent actions such as "evaluate_force". Use [] only for an event with no world-state mutation, or a clearly identified novel action that cannot be represented by a registered workflow.

Respond with strict JSON only: { "proposals": [...] }`;
}
