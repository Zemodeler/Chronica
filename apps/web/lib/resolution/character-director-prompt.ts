import "server-only";

import type { WorldState } from "@chronica/shared";
import { buildWorkflowCatalog } from "@chronica/shared";
import type { SelectedCharacter } from "@chronica/shared";

// Character Director prompt builder.
//
// Builds a bounded, visibility-filtered system prompt so the Character Director
// AI can propose decisions for selected characters. The prompt never reveals
// private goals, private plot rationales, or information a character could not
// plausibly possess. Only public and polity-visible information is mixed in.

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
  lines.push(`  Alive: ${character.alive}`);

  // Forces commanded.
  const commandedForces = world.material.forces.filter(
    (f) => f.commanderCharacterId === charId || f.controllerCharacterId === charId,
  );
  if (commandedForces.length > 0) {
    lines.push(`  Forces: ${commandedForces.map((f) => `${f.name} [id: ${f.id}] (${f.personnel.reduce((n, p) => n + p.fit, 0)} fit)`).join(", ")}`);
  }

  // Relations (non-private only — private relations would leak hidden grudges).
  const publicRelations = character.relations.filter(
    (r) => r.causes.some((c) => c.decayPerYearBps < 10_000),
  );
  if (publicRelations.length > 0) {
    lines.push(`  Key relations (subject ids): ${publicRelations.slice(0, 6).map((r) => r.subjectCharacterId).join(", ")}`);
  }

  // Active goals (public and polity-visible only — private goals must not be revealed here).
  const publicGoals = (world.characterGoals ?? []).filter(
    (g) => g.characterId === charId && g.status === "active" && g.visibility !== "private",
  );
  for (const goal of publicGoals) {
    lines.push(`  Goal [id: ${goal.id}]: ${goal.objective} (priority ${goal.priority}, ${goal.visibility})`);
  }

  // Active plots (non-private stages only — private plots are excluded entirely from the visible output).
  const visiblePlots = (world.characterPlots ?? []).filter(
    (p) => p.characterId === charId && (p.status === "active" || p.status === "stalled") && p.visibility !== "private",
  );
  for (const plot of visiblePlots) {
    lines.push(`  Plot [id: ${plot.id}]: ${plot.objective.slice(0, 80)} | stage: ${plot.stage} | obstacle: ${plot.currentObstacle ?? "none"}`);
  }

  // Encounters with the player character (recent, non-private).
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
): string {
  const playerCharacter = world.characters.find((c) => c.id === playerCharacterId);
  const playerPolity = world.map.polities.find((p) => p.id === playerCharacter?.polityId);

  // Active storylines (public and polity-visible).
  const storylines = (world.storylines ?? [])
    .filter((s) => s.visibility !== "private")
    .slice(0, 6)
    .map((s) => `  [${s.id}] ${s.title} | phase: ${s.phase} | next: ${s.nextDevelopment.slice(0, 120)}`)
    .join("\n");

  // All character contexts for selected characters.
  const charContexts = selectedCharacters
    .map((sc) => characterContext(world, sc.characterId))
    .filter(Boolean)
    .join("\n\n");

  // Public world pressure summary.
  const wars = world.conflicts.wars.map((w) => {
    const pA = world.map.polities.find((p) => p.id === w.polityAId)?.name ?? w.polityAId;
    const pB = world.map.polities.find((p) => p.id === w.polityBId)?.name ?? w.polityBId;
    return `${pA} [${w.polityAId}] vs ${pB} [${w.polityBId}]`;
  });

  return `You are the Character Director for Chronica, a historical strategy game. You propose decisions for important characters — goals, plots, and actions. You do NOT grant wishes or write facts: the shared resolver decides what actually happens.

CURRENT STEP: ${world.elapsedStep}
PLAYER CHARACTER: ${playerCharacter?.name ?? "?"} [id: ${playerCharacterId}] (${playerPolity?.name ?? "?"})

ACTIVE WORLD STORYLINES:
${storylines || "  (none)"}

ACTIVE WARS: ${wars.length > 0 ? wars.join("; ") : "none"}

SELECTED CHARACTERS (${selectedCharacters.length}):
${charContexts}

${buildWorkflowCatalog()}

YOUR TASK: For each selected character, propose ONE decision. Decisions must be grounded in what the character actually knows, possesses, and can plausibly do.

Decision schema (return strict JSON { "decisions": [...] }):
- characterId: string (from the list above)
- kind: "wait" | "prepare" | "create_goal" | "update_goal" | "create_plot" | "advance_plot" | "act" | "react" | "adapt" | "abandon" | "resolve"
- goalId: existing goal id or null
- proposedGoal: { objective, category: one of "preserve_power"|"acquire_office"|"discredit_rival"|"alliance"|"revenge"|"resource"|"narrative", targetEntityIds, priority (1-5), visibility } or null
- plotId: existing plot id or null
- proposedPlot: { goalId, objective, participantIds, targetIds, visibility, stakes, currentObstacle } or null
- causalFactIds: entity IDs that caused this decision (encounters, events, storylines)
- affectedEntityIds: entity IDs affected (provinces, characters, forces)
- storylineId: related storyline id or null
- privateRationale: the character's private reasoning — NEVER shown to the player
- visibility: "public" | "polity" | "private"
- salience: 0-10 (importance for Chronicle — private preparations should be 0)
- workflowInvocations: [] or 1-2 workflow invocations. Each must be: { "actionId": "<string from catalog>", "actorId": "<character-id>", "parameters": { ... } }. Use actionId as a plain string exactly as listed in the catalog. Use [] when no concrete material action occurs.

RULES:
1. "wait" and "prepare" are valid and often correct. A character must not act without motive, opportunity, and means.
2. Never invent entity IDs — use only IDs from character context above.
3. Characters cannot act on information they do not possess (no omniscience).
4. A character may not create a force, gain gold, or hold an office they do not possess.
5. Private plots (visibility: "private") must have salience 0 unless they produce an observable public consequence.
6. Prefer continuing existing goals and plots over creating unrelated new ones.
7. Do not propose a workflow invocation unless the character genuinely has the authority, resources, and location to execute it.
8. Return decisions for all ${selectedCharacters.length} characters in the "decisions" array.
9. For large-scale preparations (raising an army, funding a coup), require at least one real named obstacle.

Respond with strict JSON only: { "decisions": [...] }`;
}
