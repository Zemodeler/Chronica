import "server-only";

import type { WorldState } from "@chronica/shared";
import { buildWorkflowCatalog } from "@chronica/shared";

// Prompt builders for the three-step resolution chain.
//
// Each prompt receives a snapshot of the game world and the player's character
// so the AI has enough context to make grounded decisions. Prompts are
// intentionally concise: the AI should read them in full before answering.

function worldContext(world: WorldState, actorId: string): string {
  const actor = world.characters.find((c) => c.id === actorId);
  const location = actor
    ? world.map.provinces.find((p) => p.id === actor.locationProvinceId)
    : null;
  const polity = actor
    ? world.map.polities.find((p) => p.id === actor.polityId)
    : null;
  const forces = world.material.forces.filter((f) => f.controllerCharacterId === actorId || f.commanderCharacterId === actorId);
  const wars = world.conflicts.wars;
  const battles = world.conflicts.battles;
  const sieges = world.conflicts.sieges;

  const lines: string[] = [];
  if (actor) {
    lines.push(`ACTOR: ${actor.name} (${polity?.name ?? "unknown polity"}), located in ${location?.name ?? actor.locationProvinceId}`);
    lines.push(`Health: ${(actor.healthBps / 100).toFixed(0)}% | Prestige: ${(actor.prestigeBps / 100).toFixed(0)}%`);
  }
  lines.push(`\nPOLITIES: ${world.map.polities.map((p) => p.name).join(", ")}`);
  lines.push(`PROVINCES HELD:`);
  for (const polityEntry of world.map.polities) {
    const held = world.map.provinces.filter((p) => p.controllerPolityId === polityEntry.id);
    if (held.length > 0) {
      lines.push(`  ${polityEntry.name}: ${held.map((p) => p.name).join(", ")}`);
    }
  }
  if (forces.length > 0) {
    lines.push(`\nFORCES UNDER COMMAND:`);
    for (const f of forces) {
      const fitTotal = f.personnel.reduce((n, p) => n + p.fit, 0);
      const loc = world.map.provinces.find((p) => p.id === f.locationId);
      lines.push(`  ${f.name}: ${fitTotal} troops in ${loc?.name ?? f.locationId} | Morale ${(f.moraleBps / 100).toFixed(0)}%`);
    }
  }
  if (wars.length > 0) {
    lines.push(`\nACTIVE WARS: ${wars.map((w) => `${w.polityAId} vs ${w.polityBId}`).join("; ")}`);
  }
  if (battles.length > 0) {
    lines.push(`ACTIVE BATTLES: ${battles.map((b) => `${b.participantForceIds.join(" vs ")}`).join("; ")}`);
  }
  if (sieges.length > 0) {
    lines.push(`ACTIVE SIEGES: ${sieges.map((s) => s.settlementId).join(", ")}`);
  }
  lines.push(`\nCURRENT STEP: ${world.elapsedStep}`);
  return lines.join("\n");
}

export function buildInterpretSystemPrompt(world: WorldState, actorId: string): string {
  return `You are a historian and game master for Chronica, a strategy game set in the ancient world. Your task is to interpret a player's free-text order into structured intent.

${worldContext(world, actorId)}

Parse the order into:
- intent: a clear one-sentence summary of what the player wants to achieve (max 600 chars)
- targetIds: entity IDs that are the object of the action (provinces, characters, forces, polities)
- priorities: what the player values most about this action (up to 8, max 180 chars each)
- conditions: preconditions that must be true for the action to succeed (up to 8, max 240 chars each)
- proposedSteps: the concrete steps required to carry this out (1-12, max 240 chars each)
- risks: potential negative outcomes (up to 12, max 240 chars each)
- duration: estimated min/max number of game seasons this will take

Be grounded: use actual province names, character names, and force names from the world context above. If the player references something that does not exist, note it as a risk.

Respond as a JSON object with exactly these fields.`;
}

export function buildAssessSystemPrompt(world: WorldState, actorId: string): string {
  return `You are an arbiter for Chronica, a strategy game set in the ancient world. Your task is to assess whether a player's order is feasible given their current situation.

${worldContext(world, actorId)}

${buildWorkflowCatalog()}

For each interpreted order, assess:
- interpretation: restate the intent concisely (max 600 chars)
- feasibility: one of "feasible" | "conditional" | "unlawful" | "impossible" | "uncertain"
  * feasible: straightforwardly achievable
  * conditional: possible but requires specific conditions to be met
  * unlawful: violates a law, treaty, or institutional constraint
  * impossible: physically or logically impossible given current world state
  * uncertain: insufficient information to assess
- obstacleIds: entity IDs of things that oppose or complicate the action
- dependencyActionIds: IDs of other ongoing actions this depends on
- estimatedSteps: min/max seasons this will take to complete
- workflow: if this maps to a registered workflow action, name it as { actionId, parameters }. Use null if genuinely novel or unmappable.
- needsAdjudication: true if the outcome is uncertain and requires the full adjudication step

IMPORTANT: feasibility is informational. Even an "impossible" assessment goes to adjudication — you are not blocking the player, you are informing the consequences step.

Respond as a JSON object with exactly these fields.`;
}

export function buildAdjudicateSystemPrompt(world: WorldState, actorId: string): string {
  return `You are a consequence engine for Chronica, a strategy game set in the ancient world. Given an interpreted and assessed player order, decide its outcome.

${worldContext(world, actorId)}

${buildWorkflowCatalog()}

For the order, produce a verdict:
- outcome: "succeeds" | "partially_succeeds" | "fails" | "backfires" | "impossible"
- obstacles: array of { source, weight: "trivial"|"real"|"decisive", reason } — MUST be non-empty
- deltas: array of state changes. Each delta is one of:
  * { kind: "material_effect", effect: { sourceEntityId, recipientEntityId?, magnitude: "minor"|"meaningful", rationale } }
  * { kind: "relationship_cause", holderCharacterId, subjectCharacterId, label, score: -100..100 }
  * { kind: "knowledge_grant", characterId, factId }
  * { kind: "workflow", invocation: { actionId, actorId, parameters } } — use workflow IDs from the catalog above
- tacticalModifiers: array of tactical modifier proposals (empty if not a battle)
- timeCost: { min, max } in seasons
- rationale: explain the decisive factor (max 1200 chars)
- knowledgeVisibility: "public" | "polity" | "private"
- playerInvolvement: [{ playerId, characterId, role: "actor"|"target"|"materially_affected" }]

The AI's role is to determine consequences, not to grant wishes. Always name at least one real obstacle. A success can still have costs.

Respond as a JSON object with exactly these fields.`;
}

export function buildNearEventsSystemPrompt(world: WorldState, polityId: string): string {
  const polity = world.map.polities.find((p) => p.id === polityId);
  const provinces = world.map.provinces.filter((p) => p.controllerPolityId === polityId);
  const forces = world.material.forces.filter((f) => f.polityId === polityId);
  const characters = world.characters.filter((c) => c.polityId === polityId && c.alive);

  return `You are a world simulation engine for Chronica. Generate plausible world events happening within the player's own polity (${polity?.name ?? polityId}) this season.

POLITY TERRITORY: ${provinces.map((p) => p.name).join(", ")}
POLITY FORCES: ${forces.map((f) => `${f.name} (${f.personnel.reduce((n, p) => n + p.fit, 0)} troops)`).join(", ")}
POLITY CHARACTERS: ${characters.map((c) => c.name).join(", ")}
ONGOING CONFLICTS: ${world.conflicts.wars.length} wars, ${world.conflicts.battles.length} battles, ${world.conflicts.sieges.length} sieges

Generate 2-4 events. Each event is an EventProposal:
- triggerId: a short unique id (e.g. "near-revolt-1")
- causeFactIds: IDs of causal entities (province IDs, character IDs, force IDs)
- affectedScopeIds: IDs affected (province IDs, character IDs)
- visibility: "public" | "polity" | "private"
- salience: 0-1000 (importance)
- actions: 1-2 ProposedInvocations from the workflow registry, e.g. { actionId: "move_force", actorId: "...", parameters: {...} }

${buildWorkflowCatalog()}

Focus on internal politics, local unrest, economic developments, and military logistics within the polity. World events must use real entity IDs from above.

Respond as JSON: { "events": [...] }`;
}

export function buildFarEventsSystemPrompt(world: WorldState, polityId: string): string {
  const polity = world.map.polities.find((p) => p.id === polityId);
  const provinces = world.map.provinces.filter((p) => p.controllerPolityId === polityId);
  const forces = world.material.forces.filter((f) => f.polityId === polityId);

  return `You are a world simulation engine for Chronica. Generate plausible events in the neighboring polity ${polity?.name ?? polityId}.

TERRITORY: ${provinces.map((p) => p.name).join(", ")}
FORCES: ${forces.map((f) => f.name).join(", ")}
CURRENT STEP: ${world.elapsedStep}

Generate 1-2 events (fewer than Near events — this polity is less detailed). Each event:
- triggerId: short unique id (e.g. "far-${polityId}-1")
- causeFactIds: entity IDs
- affectedScopeIds: entity IDs
- visibility: "polity" or "public"
- salience: 0-600 (lower than Near events)
- actions: 1 ProposedInvocation from the workflow registry

${buildWorkflowCatalog()}

Focus on major developments: wars, political changes, military movements. Skip minor details.

Respond as JSON: { "events": [...] }`;
}

export function buildCoarseEventsSystemPrompt(world: WorldState, distantPolityIds: string[]): string {
  const polities = world.map.polities.filter((p) => distantPolityIds.includes(p.id));

  return `You are a world simulation engine for Chronica. Generate distant background events for these far-off polities: ${polities.map((p) => p.name).join(", ")}.

These are very distant — generate 1-3 events total across all of them, coarse and imprecise.

Each event:
- triggerId: short unique id (e.g. "coarse-event-1")
- causeFactIds: polity IDs as strings
- affectedScopeIds: polity IDs
- visibility: "public"
- salience: 0-300 (very low — background noise)
- actions: 1 ProposedInvocation (typically start_war, end_war, give_territory, or kill_character)

${buildWorkflowCatalog()}

Focus on large-scale geopolitical shifts. These events should feel distant and incomplete — the player's character only hears rumours.

Respond as JSON: { "events": [...] }`;
}

export function buildChronicleNarratorPrompt(
  entries: readonly { body: string; isPlayerAction: boolean }[],
  world: WorldState,
): string {
  return `You are the chronicler of Chronica. Review the raw event summaries below and rewrite them as vivid, historically-flavoured prose for the chronicle (a newspaper-like narrative of what happened this season).

EVENTS (${entries.length} total):
${entries.map((e, i) => `${i + 1}. [${e.isPlayerAction ? "PLAYER ACTION" : "WORLD EVENT"}] ${e.body}`).join("\n")}

Rewrite each event as one paragraph of chronicle prose. World events must outnumber player-action paragraphs — they should feel like the world is larger than any one player.

Rules:
- Write in third person, past tense, historical style
- Each entry max 300 words
- Do not invent details beyond what is given
- Preserve the order (player actions and world events can be interleaved chronologically)

Respond as JSON: { "entries": [{ "body": "...", "isPlayerAction": true/false }] }`;
}
