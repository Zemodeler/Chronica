import type { WorldState } from "../world/world-state";
import type { SelectedCharacter } from "./schemas";
import { CharacterSelectionTierSchema } from "./schemas";
import type { AuthorityIndex } from "../authority/authority-grant";
import { scoreStarContext, selectStarContext, type StarContext } from "../star-context";
import type { OrderPartyRef } from "../actions/orders";

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

/**
 * The score boost a `priorityCharacterIds` entry receives (docs/plans/
 * ai-world-matters-runtime.md, "Selection budgets": "genuinely due
 * responsibilities compete fairly with general relevance"). Below `nemesis`
 * (1000) and the top of the chronicle-score band (capped at 600) so a due
 * matter never automatically outranks the character the story is actually
 * centered on -- but above every other single rule here (recent-encounter,
 * active-goal/plot, storyline, office, command, war, siege, continuity), so
 * a genuine standing responsibility is not quietly outcompeted by background
 * relevance either. A documented constant rather than an inline number,
 * because two unrelated callers rely on this exact boost: a pending-dialogue
 * commitment (pre-existing) and, now, a matter-driven priority actor.
 */
export const PRIORITY_CHARACTER_SCORE_BOOST = 500;

/**
 * Relevance is not merely a sorting hint: it determines how much agency an
 * NPC receives this turn. A distant background actor gets one meaningful
 * move; a nemesis, head of state, or person at the centre of a crisis may
 * pursue a whole sequence. There is deliberately no shared action pool.
 */
function actionAllowanceFor(score: number): number {
  if (score >= 1_000) return 6;
  if (score >= 600) return 5;
  if (score >= 400) return 4;
  if (score >= 250) return 3;
  if (score >= 100) return 2;
  return 1;
}

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
  priorityCharacterIds: readonly string[] = [],
  priorityReasons?: ReadonlyMap<string, readonly string[]>,
): SelectedCharacter[] {
  const scored: ScoredCharacter[] = [];
  // Multi-slot nemeses: all active ones score highly
  const activeNemesisIds = new Set<string>(
    [
      ...(world.nemeses ?? []).filter((n) => n.active).map((n) => n.characterId),
      // Legacy single-slot fallback
      ...(world.nemesis?.active && world.nemesis.characterId ? [world.nemesis.characterId] : []),
    ].filter(Boolean),
  );
  const currentStep = world.elapsedStep;
  const priorityCharacterIdSet = new Set(priorityCharacterIds);

  // Chronicle-weighted relevance scoring (recency decay)
  const roleWeight: Record<string, number> = { protagonist: 100, antagonist: 90, participant: 50, mentioned: 20 };
  function chronicleScore(characterId: string): number {
    const entry = (world.characterRelevance ?? []).find((r) => r.characterId === characterId);
    if (!entry) return 0;
    let total = 0;
    const RECENT_TURNS = 5;
    for (const appearance of entry.chronicleAppearances) {
      const turnsAgo = Math.max(0, currentStep - appearance.atStep);
      if (turnsAgo > RECENT_TURNS) continue;
      const recencyWeight = Math.pow(0.8, turnsAgo);
      total += (roleWeight[appearance.role] ?? 20) * recencyWeight;
    }
    return total;
  }

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

    // A pending conversation promise is a direct, durable reason to consider
    // this character during the same turn's advice phase.
    if (priorityCharacterIdSet.has(character.id)) {
      score += PRIORITY_CHARACTER_SCORE_BOOST;
      const specificReasons = priorityReasons?.get(character.id);
      if (specificReasons !== undefined && specificReasons.length > 0) {
        reasons.push(...specificReasons);
      } else {
        reasons.push("pending-dialogue-commitment");
      }
    }

    // Rule 1: Nemesis — always included, top priority.
    const isNemesis = activeNemesisIds.has(character.id);
    if (isNemesis) {
      score += 1000;
      reasons.push("nemesis");
    }

    // Rule 1b: Chronicle-weighted relevance score.
    const cScore = chronicleScore(character.id);
    if (cScore > 0) {
      score += Math.min(cScore * 2, 600); // cap at 600 so it doesn't dominate nemesis
      reasons.push(`chronicle-score:${Math.round(cScore)}`);
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
      relevanceScore: s.score,
      actionAllowance: actionAllowanceFor(s.score),
      reasons: s.reasons,
    };
  });
}

/**
 * docs/32 Phase 7: the combined NPC+star-context 8-agent-per-decision-point
 * budget. Renamed from `MAX_CHARACTERS_PER_TURN` now that the cap covers
 * both -- the old name stays as a deprecated alias below for callers not
 * yet migrated.
 */
export const MAX_RICH_AGENTS_PER_DECISION_POINT = MAX_CHARACTERS_PER_TURN;
/** At most two star contexts may be selected in one decision point (docs/32 default). */
export const MAX_STAR_CONTEXTS_PER_DECISION_POINT = 2;

export interface SelectedNpcActor extends SelectedCharacter {
  readonly kind: "npc";
}
export interface SelectedStarContextActor {
  readonly kind: "star_context";
  readonly context: StarContext;
  readonly relevanceScore: number;
}
export type SelectedActor = SelectedNpcActor | SelectedStarContextActor;

/**
 * Turn-level candidate star-context refs: every polity currently at war
 * (both belligerents) and every settlement currently under active siege --
 * the contexts a decision point most plausibly needs institutional coverage
 * for, absent a specific triggering event to derive a native scope from
 * (that finer, event-triggered selection is `AffectedAgentSelector`'s job,
 * called per resolved event inside the event queue loop -- this function
 * covers the coarser per-turn case `selectRelevantCharacters` already
 * covers for NPCs).
 */
function starContextCandidateRefs(world: WorldState): OrderPartyRef[] {
  const refs: OrderPartyRef[] = [];
  const seen = new Set<string>();
  const addPolity = (polityId: string) => {
    const key = `polity:${polityId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ kind: "polity", id: polityId });
  };
  for (const war of world.conflicts.wars) {
    addPolity(war.polityAId);
    addPolity(war.polityBId);
  }
  for (const siege of world.conflicts.sieges) {
    const key = `settlement:${siege.settlementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind: "settlement", id: siege.settlementId });
  }
  return refs;
}

/**
 * The merged NPC+star-context selection for one decision point (docs/32,
 * Phase 7, "Agent budget"). Runs the existing, untouched
 * `selectRelevantCharacters` scoring internally (unbounded, so nothing is
 * truncated before the merge), separately scores star-context candidates
 * via `scoreStarContext`, merges both ranked lists by score, and truncates
 * to `maxTotal` with a **post-truncation cap of `maxStarContexts`** on how
 * many of the taken slots may be star contexts -- an excess star context's
 * slot is skipped (not counted against the total) so the next-highest NPC
 * backfills it instead of the budget going unused.
 */
export function selectRelevantActors(
  world: WorldState,
  playerCharacterId: string,
  authorityIndex: AuthorityIndex,
  atStep: number,
  maxTotal = MAX_RICH_AGENTS_PER_DECISION_POINT,
  maxStarContexts = MAX_STAR_CONTEXTS_PER_DECISION_POINT,
  priorityCharacterIds: readonly string[] = [],
  priorityReasons?: ReadonlyMap<string, readonly string[]>,
): SelectedActor[] {
  const npcCandidates: SelectedActor[] = selectRelevantCharacters(world, playerCharacterId, world.characters.length, priorityCharacterIds, priorityReasons).map((c) => ({
    kind: "npc",
    ...c,
  }));
  const starCandidates: SelectedActor[] = starContextCandidateRefs(world).map((ref) => {
    const context = selectStarContext(world, ref, authorityIndex, atStep);
    return { kind: "star_context", context, relevanceScore: scoreStarContext(world, context, atStep) };
  });

  const merged = [...npcCandidates, ...starCandidates].sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    const aId = a.kind === "npc" ? a.characterId : a.context.id;
    const bId = b.kind === "npc" ? b.characterId : b.context.id;
    return aId.localeCompare(bId);
  });

  const result: SelectedActor[] = [];
  let starContextsTaken = 0;
  for (const candidate of merged) {
    if (result.length >= maxTotal) break;
    if (candidate.kind === "star_context") {
      if (starContextsTaken >= maxStarContexts) continue;
      starContextsTaken += 1;
    }
    result.push(candidate);
  }
  return result;
}
