import type { Character } from "../characters/character";
import type { CharacterDrives } from "../characters/mind";
import type { WorldState } from "../world/world-state";
import type { CandidateAction } from "./candidates";
import type { CharacterIntentActionType } from "./intents";
import { resolveTraits } from "../characters/traits";
import { deriveRelationDimension } from "../characters/relationship-dimensions";
import { stableHash } from "../determinism";

// Deterministic candidate scoring (character-sim phase 3).
//
// One documented, bounded formula. Given the same world state, the same
// character, and the same candidate list, this always produces the same
// ranking -- no AI call, no runtime randomness. Ties are broken by
// `stableHash`, never by iteration order or `Math.random()`.

export interface ScoreBreakdown {
  readonly driveAlignment: number;
  readonly traitModifier: number;
  readonly riskAdjustment: number;
  readonly pressureUrgency: number;
  readonly relationshipFit: number;
  readonly priorProgress: number;
  readonly costOfInaction: number;
  readonly total: number;
}

const ACTION_DRIVES: Record<CharacterIntentActionType, readonly (keyof CharacterDrives)[]> = {
  fulfill_commitment: ["duty", "family"],
  defer_commitment: ["security"],
  renegotiate_commitment: ["duty"],
  break_commitment: ["revenge", "security"],
  seek_support: ["security"],
  offer_favour: ["family", "status"],
  request_assistance: ["security"],
  travel: ["duty"],
  prepare: ["duty"],
  wait: ["security"],
  reconcile: ["family", "duty"],
  threaten: ["revenge", "security"],
  negotiate: ["status"],
  publicly_oppose: ["revenge", "status"],
  investigate: ["status"],
  spread_belief: ["status"],
  advance_plot: ["duty", "status"],
  seek_office: ["status", "wealth"],
  military_action: ["security", "revenge"],
  economic_action: ["wealth"],
  sponsor_procedure: ["status", "duty"],
  pledge_support: ["status", "duty"],
};

/** Trait decision-modifier key each action type is most sensitive to (`traits.ts`'s `decisionModifiers`). */
const ACTION_MODIFIER_KEYS: Record<CharacterIntentActionType, readonly string[]> = {
  fulfill_commitment: ["obligation"],
  defer_commitment: ["caution"],
  renegotiate_commitment: ["negotiation"],
  break_commitment: ["betrayal"],
  seek_support: ["sociability"],
  offer_favour: ["sociability"],
  request_assistance: ["sociability"],
  travel: ["caution"],
  prepare: ["caution"],
  wait: ["caution"],
  reconcile: ["negotiation"],
  threaten: ["risk", "revenge"],
  negotiate: ["negotiation"],
  publicly_oppose: ["risk", "revenge"],
  investigate: ["discipline"],
  spread_belief: ["honesty"],
  advance_plot: ["discipline"],
  seek_office: ["status"],
  military_action: ["risk"],
  economic_action: ["status"],
  sponsor_procedure: ["discipline"],
  pledge_support: ["sociability"],
};

/** Cooperative actions read existing affection/trust as a bonus; aggressive ones read it as a discount (less to lose). */
const COOPERATIVE_ACTIONS = new Set<CharacterIntentActionType>([
  "fulfill_commitment", "offer_favour", "reconcile", "negotiate", "seek_support", "request_assistance",
]);
const AGGRESSIVE_ACTIONS = new Set<CharacterIntentActionType>([
  "break_commitment", "threaten", "publicly_oppose", "military_action",
]);

function driveAlignment(character: Character, actionType: CharacterIntentActionType): number {
  const keys = ACTION_DRIVES[actionType];
  if (keys.length === 0) return 0;
  const average = keys.reduce((sum, key) => sum + character.mind.drives[key], 0) / keys.length;
  // Scale 0-100 drive average to a ±30 contribution centered on a neutral 50.
  return Math.round(((average - 50) / 50) * 30);
}

function traitModifier(character: Character, actionType: CharacterIntentActionType): number {
  const keys = ACTION_MODIFIER_KEYS[actionType];
  const traits = resolveTraits(character.traits);
  let total = 0;
  for (const trait of traits) {
    for (const key of keys) {
      total += trait.decisionModifiers[key] ?? 0;
    }
  }
  return Math.max(-40, Math.min(40, total));
}

function riskAdjustment(character: Character, candidate: CandidateAction): number {
  const tolerance = character.mind.riskTolerance;
  const boldness = character.mind.temperament.boldness;
  const effectiveTolerance = (tolerance + boldness) / 2;
  // A cautious/low-tolerance character discounts a risky candidate heavily;
  // a bold/high-tolerance one barely discounts it at all.
  const penalty = (candidate.expectedRisk * (100 - effectiveTolerance)) / 100;
  return -Math.round(penalty * 0.4);
}

function pressureUrgency(character: Character, world: WorldState, candidate: CandidateAction): number {
  if (candidate.sourceCommitmentId === null && candidate.actionType !== "wait") return 0;
  const activePressures = world.characterPressures.filter((p) => p.characterId === character.id && p.status === "active");
  if (activePressures.length === 0) return 0;
  const maxIntensity = Math.max(...activePressures.map((p) => p.intensity));
  if (candidate.actionType === "wait" || candidate.actionType === "prepare") {
    // Waiting under real pressure costs more the more urgent the pressure is.
    return -Math.round(maxIntensity * 0.3);
  }
  return Math.round(maxIntensity * 0.2);
}

function relationshipFit(character: Character, candidate: CandidateAction): number {
  if (candidate.targetIds.length === 0) return 0;
  const targetId = candidate.targetIds[0]!;
  const affection = deriveRelationDimension(character, targetId, "affection");
  const trust = deriveRelationDimension(character, targetId, "trust");
  const bond = (affection + trust) / 2;
  if (COOPERATIVE_ACTIONS.has(candidate.actionType)) return Math.round(bond * 0.15);
  if (AGGRESSIVE_ACTIONS.has(candidate.actionType)) return Math.round(-bond * 0.15);
  return 0;
}

function priorProgress(world: WorldState, candidate: CandidateAction): number {
  if (candidate.sourcePlotId === null) return 0;
  const plot = (world.characterPlots ?? []).find((p) => p.id === candidate.sourcePlotId);
  if (plot === undefined) return 0;
  return Math.round((plot.momentum - 50) / 5);
}

function costOfInaction(candidate: CandidateAction): number {
  if (candidate.actionType !== "wait") return 0;
  // Wait always carries a small flat opportunity cost so an otherwise-tied
  // field of real options is preferred over doing nothing.
  return -5;
}

/** Scores one candidate for one character against current world state. Pure. */
export function scoreCandidate(world: WorldState, character: Character, candidate: CandidateAction): ScoreBreakdown {
  const breakdown = {
    driveAlignment: driveAlignment(character, candidate.actionType),
    traitModifier: traitModifier(character, candidate.actionType),
    riskAdjustment: riskAdjustment(character, candidate),
    pressureUrgency: pressureUrgency(character, world, candidate),
    relationshipFit: relationshipFit(character, candidate),
    priorProgress: priorProgress(world, candidate),
    costOfInaction: costOfInaction(candidate),
  };
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { ...breakdown, total };
}

export interface RankedCandidate {
  readonly candidate: CandidateAction;
  readonly score: ScoreBreakdown;
}

/**
 * Ranks every candidate for one character, highest score first. Exact ties
 * are broken by a stable hash of (characterId, atStep, actionType, first
 * target) -- deterministic and reproducible, never by array order or by
 * `Math.random()`.
 */
export function rankCandidates(
  world: WorldState,
  character: Character,
  candidates: readonly CandidateAction[],
  atStep: number,
): readonly RankedCandidate[] {
  const ranked = candidates.map((candidate) => ({ candidate, score: scoreCandidate(world, character, candidate) }));
  return ranked.sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    const hashA = stableHash([character.id, atStep, a.candidate.actionType, a.candidate.targetIds[0] ?? ""]);
    const hashB = stableHash([character.id, atStep, b.candidate.actionType, b.candidate.targetIds[0] ?? ""]);
    return hashA - hashB;
  });
}

/** The single highest-ranked candidate, or `undefined` if none were generated (should not happen -- `wait` is always present). */
export function chooseTopCandidate(
  world: WorldState,
  character: Character,
  candidates: readonly CandidateAction[],
  atStep: number,
): RankedCandidate | undefined {
  return rankCandidates(world, character, candidates, atStep)[0];
}
