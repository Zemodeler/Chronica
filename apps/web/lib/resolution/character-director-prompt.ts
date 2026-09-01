import "server-only";

import type { WorldState } from "@chronica/shared";
import type { SelectedCharacter } from "@chronica/shared";
import { buildPlayerResolutionContext, type ResolutionPlayerContext } from "./prompts";

// Character Director prompt builder.
//
// The Character Director is an ADVISOR ONLY — it proposes character development
// suggestions (goals, plots, reactions) for the World Director to act on.
// It does NOT invoke workflows directly and must not receive the workflow catalog.

function characterContext(world: WorldState, charId: string): string {
  const character = world.characters.find((c) => c.id === charId);
  if (!character) return "";

  const polity = world.map.polities.find((p) => p.id === character.polityId);
  const location = world.map.provinces.find((p) => p.id === character.locationProvinceId);

  const lines: string[] = [];
  lines.push(`CHARACTER: ${character.name} [id: ${charId}]`);
  lines.push(`  Polity: ${polity?.name ?? "?"} [id: ${character.polityId ?? "?"}]`);
  lines.push(`  Location: ${location?.name ?? character.locationProvinceId} [id: ${character.locationProvinceId}]`);
  lines.push(`  Office: ${character.officeId ?? "none"}`);
  lines.push(`  Health: ${(character.healthBps / 100).toFixed(0)}% | Prestige: ${(character.prestigeBps / 100).toFixed(0)}%`);

  const commandedForces = world.material.forces.filter(
    (f) => f.commanderCharacterId === charId || f.controllerCharacterId === charId,
  );
  if (commandedForces.length > 0) {
    lines.push(`  Forces: ${commandedForces.map((f) => `${f.name} [id: ${f.id}]`).join(", ")}`);
  }

  const publicRelations = character.relations.filter(
    (r) => r.causes.some((c) => c.decayPerYearBps < 10_000),
  );
  if (publicRelations.length > 0) {
    lines.push(`  Key relations: ${publicRelations.slice(0, 6).map((r) => r.subjectCharacterId).join(", ")}`);
  }

  const publicGoals = (world.characterGoals ?? []).filter(
    (g) => g.characterId === charId && g.status === "active" && g.visibility !== "private",
  );
  for (const goal of publicGoals) {
    lines.push(`  Goal [id: ${goal.id}]: ${goal.objective} (priority ${goal.priority}, ${goal.visibility})`);
  }

  const visiblePlots = (world.characterPlots ?? []).filter(
    (p) => p.characterId === charId && (p.status === "active" || p.status === "stalled") && p.visibility !== "private",
  );
  for (const plot of visiblePlots) {
    lines.push(`  Plot [id: ${plot.id}]: ${plot.objective.slice(0, 80)} | stage: ${plot.stage}`);
  }

  const encounters = world.encounters
    .filter((e) => e.participantIds.includes(charId) && e.visibility !== "private")
    .sort((a, b) => b.occurredAtStep - a.occurredAtStep)
    .slice(0, 3);
  for (const enc of encounters) {
    lines.push(`  Encounter [step ${enc.occurredAtStep}]: ${enc.kind} — ${enc.outcome.slice(0, 120)}`);
  }

  return lines.join("\n");
}

export function buildCharacterDirectorSystemPrompt(
  world: WorldState,
  selectedCharacters: readonly SelectedCharacter[],
  playerCharacterId: string,
  context?: ResolutionPlayerContext,
): string {
  const playerCharacter = world.characters.find((c) => c.id === playerCharacterId);
  const playerPolity = world.map.polities.find((p) => p.id === playerCharacter?.polityId);

  const storylines = (world.storylines ?? [])
    .filter((s) => s.visibility !== "private")
    .slice(0, 6)
    .map((s) => `  [${s.id}] ${s.title} | phase: ${s.phase} | next: ${s.nextDevelopment.slice(0, 120)}`)
    .join("\n");

  const charContexts = selectedCharacters
    .map((sc) => characterContext(world, sc.characterId))
    .filter(Boolean)
    .join("\n\n");

  const wars = world.conflicts.wars.map((w) => {
    const pA = world.map.polities.find((p) => p.id === w.polityAId)?.name ?? w.polityAId;
    const pB = world.map.polities.find((p) => p.id === w.polityBId)?.name ?? w.polityBId;
    return `${pA} [${w.polityAId}] vs ${pB} [${w.polityBId}]`;
  });

  return `You are the Character Director for Chronica. You advise on character development — goals, plots, and long-term intentions. You do NOT decide what happens; the World Director makes final decisions. You are an ADVISOR ONLY.

CURRENT STEP: ${world.elapsedStep}
PLAYER CHARACTER: ${playerCharacter?.name ?? "?"} [id: ${playerCharacterId}] (${playerPolity?.name ?? "?"})

ACTIVE WORLD STORYLINES:
${storylines || "  (none)"}

ACTIVE WARS: ${wars.length > 0 ? wars.join("; ") : "none"}

${buildPlayerResolutionContext(world, context)}

SELECTED CHARACTERS (${selectedCharacters.length}):
${charContexts}

YOUR TASK: For each selected character, propose ONE suggestion. Suggestions must be grounded in what the character knows and can plausibly intend. You are advising the World Director, not acting.

Output schema (return strict JSON { "suggestions": [...] }):
- characterId: string (from the list above)
- suggestionKind: "create_goal" | "update_goal" | "create_plot" | "advance_plot" | "resolve_plot" | "react" | "develop_relationship"
- goalId: existing goal id or null
- plotId: existing plot id or null
- proposedGoal: { objective, category: "preserve_power"|"acquire_office"|"discredit_rival"|"alliance"|"revenge"|"resource"|"narrative", targetEntityIds, priority (1-5), visibility } or null
- proposedPlot: { goalId, objective, participantIds, targetIds, visibility, stakes, currentObstacle } or null
- goalStatus: "active" | "achieved" | "abandoned" | "failed" when updating a goal, otherwise null
- plotStage: "forming" | "preparing" | "attempting" | "consequence" | "adapting" when advancing a plot, otherwise null
- plotResolutionStatus: "succeeded" | "failed" | "abandoned" | "exposed" | "stalled" when resolving a plot, otherwise null
- rationale: max 400 chars — the character's motivation and reasoning
- causalFactIds: entity IDs that caused this suggestion
- affectedEntityIds: entity IDs affected
- storylineId: related storyline id or null
- visibility: "public" | "polity" | "private"
- salience: 0–10 (importance — private preparations should be 0–2)

RULES:
1. Do NOT include workflow invocations — you are an advisor, not an executor.
2. Never invent entity IDs — use only IDs from the character context above.
3. Characters cannot act on information they do not possess.
4. Prefer continuing existing goals and plots over creating unrelated new ones.
5. Return suggestions for all ${selectedCharacters.length} characters in the "suggestions" array.
6. A suggestion of salience 0 means "no meaningful development this turn" — still return it.
7. For create_goal and create_plot, provide the matching proposedGoal or proposedPlot. For update_goal, advance_plot, and resolve_plot, provide the matching existing ID and the relevant status or stage so the World Director can safely make it durable.

Respond with strict JSON only: { "suggestions": [...] }`;
}
