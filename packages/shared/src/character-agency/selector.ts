import type { WorldState } from "../world/world-state";
import type { SelectedCharacter } from "./schemas";
import { CharacterSelectionTierSchema } from "./schemas";

// Deterministic character relevance selector.
//
// Given the same world state and player character ID, always produces the same
// ordered list. No AI call, no randomness. The Character Director receives only
// the characters this function returns, which bounds both cost and scope.
//
// Selection reasons go to diagnostics. They must never appear in player-visible
// output, because some reasons reference private information (active plots, Nemesis
// status, private goals).

export const MAX_CHARACTERS_PER_TURN = 8;

interface ScoredCharacter {
  characterId: string;
  score: number;
  tier: (typeof CharacterSelectionTierSchema.options)[number];
  reasons: string[];
}

/**
 * Select and rank the characters the Character Director should consider this turn.
 *
 * Returns at most `maxCharacters` entries, ordered by descending score.
 * Dead characters are always excluded. The player's own character is excluded.
 */
export function selectRelevantCharacters(
  world: WorldState,
  playerCharacterId: string,
  maxCharacters = MAX_CHARACTERS_PER_TURN,
): SelectedCharacter[] {
  const scored: ScoredCharacter[] = [];
  const nemesisId = world.nemesis?.active ? world.nemesis.characterId : null;
  const currentStep = world.elapsedStep;

  // Build a set of encounter participant IDs for the player (recent interactions).
  const recentEncounterPartnerIds = new Set<string>();
  const RECENT_ENCOUNTER_STEPS = 3;
  for (const enc of world.encounters) {
    if (
      enc.participantIds.includes(playerCharacterId) &&
      currentStep - enc.occurredAtStep <= RECENT_ENCOUNTER_STEPS
    ) {
      for (const pid of enc.participantIds) {
        if (pid !== playerCharacterId) recentEncounterPartnerIds.add(pid);
      }
    }
  }

  // Build sets for fast lookups.
  const activeGoalCharIds = new Set<string>(
    (world.characterGoals ?? [])
      .filter((g) => g.status === "active")
      .map((g) => g.characterId),
  );

  const activePlotCharIds = new Set<string>(
    (world.characterPlots ?? [])
      .filter((p) => p.status === "active" || p.status === "stalled")
      .map((p) => p.characterId),
  );

  const storylineParticipantIds = new Set<string>(
    (world.storylines ?? []).flatMap((s) => s.participantIds),
  );

  // Characters involved in wars (commanders / polity members at war).
  const polityIdsAtWar = new Set<string>();
  for (const war of world.conflicts.wars) {
    polityIdsAtWar.add(war.polityAId);
    polityIdsAtWar.add(war.polityBId);
  }

  for (const character of world.characters) {
    // Always exclude dead and player's own character.
    if (!character.alive || character.id === playerCharacterId) continue;

    let score = 0;
    const tier: ScoredCharacter["tier"] = "background";
    const reasons: string[] = [];

    // Rule 1: Nemesis — always included, top priority.
    const isNemesis = nemesisId === character.id;
    if (isNemesis) {
      score += 1000;
      reasons.push("nemesis");
    }

    // Rule 2: Recently interacted with player.
    if (recentEncounterPartnerIds.has(character.id)) {
      score += 400;
      reasons.push("recent-encounter");
    }

    // Rule 3: Has an active goal or plot.
    if (activeGoalCharIds.has(character.id)) {
      score += 300;
      reasons.push("active-goal");
    }
    if (activePlotCharIds.has(character.id)) {
      score += 350;
      reasons.push("active-plot");
    }

    // Rule 4: Participates in an active storyline.
    if (storylineParticipantIds.has(character.id)) {
      score += 200;
      reasons.push("storyline-participant");
    }

    // Rule 5: Holds an important office.
    if (character.officeId) {
      score += 150;
      reasons.push(`office:${character.officeId}`);
    }

    // Rule 6: Commands a force.
    const commandsForce = world.material.forces.some(
      (f) => f.commanderCharacterId === character.id || f.controllerCharacterId === character.id,
    );
    if (commandsForce) {
      score += 120;
      reasons.push("commands-force");
    }

    // Rule 7: Polity is at war.
    if (character.polityId && polityIdsAtWar.has(character.polityId)) {
      score += 100;
      reasons.push("polity-at-war");
    }

    // Rule 8: Active siege involvement.
    const forceIds = world.material.forces
      .filter((f) => f.commanderCharacterId === character.id || f.controllerCharacterId === character.id)
      .map((f) => f.id);
    const inSiege = world.conflicts.sieges.some(
      (s) =>
        forceIds.some(
          (fid) => s.invadingForceIds.includes(fid) || s.defendingForceIds.includes(fid),
        ),
    );
    if (inSiege) {
      score += 80;
      reasons.push("in-siege");
    }

    // Rule 9: Has continuity entry at "principal" tier.
    const continuity = world.continuity.find((c) => c.characterId === character.id);
    if (continuity?.tier === "principal") {
      score += 80;
      reasons.push("principal-continuity");
    }
    if (continuity?.tier === "remembered") {
      score += 40;
      reasons.push("remembered-continuity");
    }

    if (score > 0) {
      scored.push({ characterId: character.id, score, tier, reasons });
    }
  }

  // Sort descending by score, stable by characterId for determinism.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.characterId.localeCompare(b.characterId);
  });

  // Assign tiers based on final score.
  return scored.slice(0, maxCharacters).map((s) => {
    let finalTier: SelectedCharacter["tier"] = "background";
    if (s.reasons.includes("nemesis") || s.reasons.includes("recent-encounter")) {
      finalTier = "persistent";
    } else if (s.score >= 200) {
      finalTier = "important";
    }
    return {
      characterId: s.characterId,
      tier: finalTier,
      reasons: s.reasons,
    };
  });
}
