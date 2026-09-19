import { z } from "zod";
import type {
  Battle,
  BattleResult,
  BattleSide,
  CasualtyResult,
  CommanderStateChange,
  ForceStateChange,
  RecordedRandomDraw,
  RetreatResult,
  ScenarioWarfareRules,
  SiegeOrControlChange,
  TroopCategoryDefinition,
  WorldFact,
} from "./battle";
import type { Character } from "../characters/character";
import type { Force, ProvinceMaterial } from "../material-state";
import type { Province } from "../world/map";
import { resolveForcePosition } from "./position";
import type { TacticalModifierProposal } from "./tactical-modifier";
import type { Structure } from "../world/structure";

// Deterministic battle resolution (docs/19 Phase 3, ADR-0031).
//
// This closes the gap docs/14 §1 identified: `BattleResultSchema` was fully
// designed but nothing computed one, so a battle's real outcome went through
// the AI verdict/workflow path instead. Every input here is authoritative
// world state (troop counts, commander skill/health, terrain, position,
// supply, morale/cohesion/fatigue); every random draw is seeded and
// recorded, so a replay with the same seed produces the same result.
//
// Scope, deliberately: this resolves one engagement in five phases, with a
// simple, auditable exchange model. A caller may now pass
// `TacticalModifierProposal`s (docs/19 Phase 3 follow-on): each is checked
// against its own declared preconditions, then folded into its side's
// strength the same way a scenario's routine tactics are, bounded by the
// same ±2000 bps cap. `phases` is recorded on the accepted/rejected result
// but does not gate application -- the engine computes one effective
// strength per side up front (Phase 1: contact) rather than a distinct
// value per phase, so there is nowhere else for a later-phase proposal to
// mechanically hook in yet; that finer-grained phase modeling remains a
// real follow-on, not a shortcut taken here.

function hashSeed(seed: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and deterministic for a given 32-bit seed. */
function createRng(seed: string) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DEFAULT_CATEGORY: TroopCategoryDefinition = {
  id: "__default__",
  label: "levy",
  combatWeightBps: 10_000,
  steadinessBps: 7_000,
  mobilityBps: 5_000,
  naval: false,
  transportPerHead: 0,
};

function categoryDefinition(rules: ScenarioWarfareRules | undefined, categoryId: string): TroopCategoryDefinition {
  return rules?.troopCategories.find((category) => category.id === categoryId) ?? DEFAULT_CATEGORY;
}

/** Coarse, scenario-independent terrain defense bonus, pending scenario-authored terrain rules. */
const TERRAIN_DEFENSE_BPS: Record<string, number> = {
  hills: 500,
  mountains: 1_000,
  forest: 400,
};

function clampBps(value: number, min = 0, max = 10_000): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function commanderModifierBps(commander: Character | null): number {
  if (!commander) return -500; // a force with no living commander fights at a real disadvantage.
  const healthFactor = commander.healthBps / 10_000;
  return Math.round((commander.skills.martial - 50) * 10 * healthFactor);
}

/**
 * Whether a depot/fortress actually reaches this force with real supply
 * (docs/32 corrective pass, requirement 5) -- standing in the same province
 * always reaches it; a `supplyRadius` of at least 1 also reaches an
 * immediately adjacent province. Never the attacker's/an unrelated polity's
 * structure, same ownership rule as `structureDefenseBps`.
 */
function reachedBySupplyStructure(force: Force, provinceId: string, adjacentProvinceIds: readonly string[], structures: readonly Structure[]): boolean {
  return structures.some((structure) => {
    if (structure.ownerPolityId !== null && structure.ownerPolityId !== force.polityId) return false;
    if (structure.provinceId === provinceId) return true;
    return structure.supplyRadius >= 1 && adjacentProvinceIds.includes(structure.provinceId);
  });
}

function supplyModifierBps(force: Force, material: ProvinceMaterial | null, provinceId: string, adjacentProvinceIds: readonly string[], structures: readonly Structure[]): number {
  const relieved = reachedBySupplyStructure(force, provinceId, adjacentProvinceIds, structures);
  const statusPenalty = relieved ? 0 : force.provisionStatus === "critical" ? -1_500 : force.provisionStatus === "shortage" ? -700 : 0;
  const foodPenalty = material ? Math.round(((material.foodSecurityBps - 8_000) / 8_000) * 500) : 0;
  return statusPenalty + Math.min(0, foodPenalty);
}

/**
 * The high-level posture a player/NPC order gave this side (docs/14 Phase
 * 1's `OngoingAction.posture` free text, narrowed here to the bounded set
 * the engine actually understands). `undefined` means no posture was
 * ordered and carries no modifier, matching every existing test's behavior.
 */
export const BattlePostureSchema = z.enum(["offer_battle", "avoid_battle", "defend", "hold"]);
export type BattlePosture = z.infer<typeof BattlePostureSchema>;

/** A side ordered to avoid battle fights half-heartedly if forced into one anyway; one ordered to defend or hold fights with real resolve. */
const POSTURE_MODIFIER_BPS: Record<BattlePosture, number> = {
  offer_battle: 0,
  avoid_battle: -1_500,
  defend: 800,
  hold: 500,
};

export interface ResolveBattleParticipant {
  readonly forceId: string;
  readonly side: BattleSide;
  readonly force: Force;
  readonly commander: Character | null;
  readonly posture?: BattlePosture;
}

export interface ResolveBattleInput {
  readonly battle: Battle;
  readonly participants: readonly ResolveBattleParticipant[];
  readonly province: Province;
  readonly provinceMaterial: ProvinceMaterial | null;
  /** Candidate retreat destinations, in a stable order (the caller decides adjacency/order). */
  readonly adjacentProvinceIds: readonly string[];
  readonly warfareRules?: ScenarioWarfareRules;
  /** Novel tactics a player/NPC proposed for this battle (docs/19 Phase 3). */
  readonly tacticalProposals?: readonly TacticalModifierProposal[] | undefined;
  /**
   * Standing structures in this battle's province (docs/32 corrective pass,
   * requirement 5) -- a fortress/wall's `defensiveEffectsBps` adds directly
   * to the defender's modifier, the same way terrain and position already
   * do. Optional so a caller with no structures in scope (or a test fixture
   * that predates this) simply contributes nothing.
   */
  readonly structures?: readonly Structure[];
}

const MAGNITUDE_BPS: Record<TacticalModifierProposal["magnitude"], number> = {
  minor: 500,
  meaningful: 2_000, // same cap as RoutineTacticSchema.modifierBps -- a novel proposal can do no more than a scenario-authored tactic.
};

/**
 * A proposal's `subjectId` (when set) must name something real in this
 * battle -- a participating force or its commander -- or the proposal is
 * meaningless and is rejected rather than silently accepted.
 */
function knownBattleSubjectIds(participants: readonly ResolveBattleParticipant[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const participant of participants) {
    ids.add(participant.forceId);
    if (participant.commander) ids.add(participant.commander.id);
  }
  return ids;
}

interface ForceContribution {
  readonly participant: ResolveBattleParticipant;
  readonly baseStrength: number;
  readonly modifierBps: number;
  readonly effectiveStrength: number;
}

/**
 * The sum of every standing structure's `defensiveEffectsBps` in this
 * battle's province that stands for the defending force's own polity (or
 * for no polity at all -- an unclaimed watchtower still shelters whoever
 * holds the ground) -- never the attacker's. A structure the attacker's own
 * polity owns in this province contributes nothing here; it is not the
 * thing being defended.
 */
function structureDefenseBps(participant: ResolveBattleParticipant, province: Province, structures: readonly Structure[]): number {
  if (participant.side !== "defender") return 0;
  return structures
    .filter((structure) => structure.provinceId === province.id && (structure.ownerPolityId === null || structure.ownerPolityId === participant.force.polityId))
    .reduce((sum, structure) => sum + structure.defensiveEffectsBps, 0);
}

/**
 * A defending garrison packed well past what the local structures can
 * actually shelter (`Structure.garrisonCapacity`) fights at a real
 * disadvantage -- crowded, poorly billeted, and harder to command -- capped
 * at the same order of magnitude as the other modifiers here so it can
 * matter without dominating the outcome by itself. A province with no
 * capacity-bearing structure at all imposes no such penalty (unbounded, as
 * every existing battle without a `Structure` already behaves).
 */
function garrisonOvercrowdingBps(participant: ResolveBattleParticipant, province: Province, structures: readonly Structure[]): number {
  if (participant.side !== "defender") return 0;
  const relevant = structures.filter((structure) =>
    structure.provinceId === province.id && structure.garrisonCapacity > 0
    && (structure.ownerPolityId === null || structure.ownerPolityId === participant.force.polityId),
  );
  if (relevant.length === 0) return 0;
  const capacity = relevant.reduce((sum, structure) => sum + structure.garrisonCapacity, 0);
  const personnel = totalPersonnel(participant.force);
  if (personnel <= capacity) return 0;
  const overRatio = (personnel - capacity) / capacity;
  return -Math.min(2_000, Math.round(overRatio * 2_000));
}

function computeForceContribution(
  participant: ResolveBattleParticipant,
  province: Province,
  provinceMaterial: ProvinceMaterial | null,
  rules: ScenarioWarfareRules | undefined,
  varianceBps: number,
  tacticBps: number,
  structures: readonly Structure[],
  adjacentProvinceIds: readonly string[],
): ForceContribution {
  const { force } = participant;
  const baseStrength = force.personnel.reduce((sum, category) => {
    const definition = categoryDefinition(rules, category.categoryId);
    return sum + category.fit * (definition.combatWeightBps / 10_000);
  }, 0);
  const moraleFactor = force.moraleBps / 10_000;
  const cohesionFactor = force.cohesionBps / 10_000;
  const fatiguePenalty = 1 - (force.fatigueBps / 10_000) * 0.5;
  const position = resolveForcePosition(province, force.positionId);
  // Terrain and position favor the defender; an attacker is, by definition, on the move.
  const positionBps = participant.side === "defender" ? position.combatModifierBps : 0;
  const terrainBps = participant.side === "defender" ? (TERRAIN_DEFENSE_BPS[province.terrainId] ?? 0) : 0;
  const postureBps = participant.posture ? POSTURE_MODIFIER_BPS[participant.posture] : 0;
  const modifierBps = positionBps + terrainBps
    + structureDefenseBps(participant, province, structures)
    + garrisonOvercrowdingBps(participant, province, structures)
    + supplyModifierBps(force, provinceMaterial, province.id, adjacentProvinceIds, structures)
    + commanderModifierBps(participant.commander)
    + postureBps
    + varianceBps
    + tacticBps;
  const modifierFactor = Math.max(0.2, 1 + modifierBps / 10_000);
  const effectiveStrength = Math.max(0, baseStrength * moraleFactor * cohesionFactor * fatiguePenalty * modifierFactor);
  return { participant, baseStrength, modifierBps, effectiveStrength };
}

function totalPersonnel(force: Force): number {
  return force.personnel.reduce((sum, category) => sum + category.fit, 0);
}

/**
 * Resolve one battle deterministically. `seed` should uniquely identify this
 * resolution (e.g. `${turnId}:combat:${battle.battleId}`) so a replay of the
 * same turn draws the same sequence.
 */
/** A deterministic, chronicle-ready paragraph describing a resolved battle from its own structured result. */
export function summarizeBattleResult(result: BattleResult, forceNameById: ReadonlyMap<string, string>, provinceName: string): string {
  const nameFor = (forceId: string) => forceNameById.get(forceId) ?? forceId;
  const attackerIds = result.participantIds.filter((forceId) => result.attackerForceIds.includes(forceId));
  const defenderIds = result.participantIds.filter((forceId) => !result.attackerForceIds.includes(forceId));
  const sideName = (ids: readonly string[]) => (ids.length === 0 ? "the field" : ids.map(nameFor).join(" and "));
  const casualtyTotal = (forceId: string) =>
    result.casualties.filter((c) => c.forceId === forceId).reduce((sum, c) => sum + c.dead + c.deserted + c.wounded, 0);
  const casualtyLine = result.participantIds
    .map((forceId) => `${nameFor(forceId)} suffers ${casualtyTotal(forceId)} casualties`)
    .join("; ");
  // Named, never by role. "The defender prevails" made the reader work out who
  // that was, and a Chronicle got it exactly backwards.
  const victors = result.outcome === "attacker_victory" ? attackerIds : defenderIds;
  const beaten = result.outcome === "attacker_victory" ? defenderIds : attackerIds;
  const outcomeLine = result.outcome === "inconclusive"
    ? `The battle at ${provinceName} ends inconclusively, neither side holding the field.`
    : `${sideName(victors)} holds the field at ${provinceName}; ${sideName(beaten)} is beaten.`;
  const retreatLine = result.retreats.length > 0
    ? ` ${result.retreats.map((r) => `${nameFor(r.forceId)} ${r.orderly ? "withdraws in good order" : "breaks and flees"}${r.toProvinceId ? "" : ", with nowhere left to retreat"}`).join("; ")}.`
    : "";
  const commanderLine = result.commanderChanges
    .filter((change) => change.outcome !== "unharmed")
    .map((change) => `${nameFor(change.forceId)}'s commander is ${change.outcome}`)
    .join("; ");
  return [
    `${sideName(attackerIds)} attacks ${sideName(defenderIds)} at ${provinceName}. ${outcomeLine}`,
    `${casualtyLine}.${retreatLine}`,
    commanderLine.length > 0 ? `${commanderLine}.` : "",
  ].filter((line) => line.trim().length > 0).join(" ");
}

export function resolveBattle(input: ResolveBattleInput, seed: string): BattleResult {
  const { battle, participants, province, provinceMaterial, adjacentProvinceIds, warfareRules, structures = [] } = input;
  const rng = createRng(seed);
  const draws: RecordedRandomDraw[] = [];

  const attackers = participants.filter((p) => p.side === "attacker");
  const defenders = participants.filter((p) => p.side === "defender");

  // ── Tactical modifier proposals (docs/19 Phase 3) ───────────────────────
  const knownSubjectIds = knownBattleSubjectIds(participants);
  const acceptedTactics: TacticalModifierProposal[] = [];
  const rejectedTactics: { actorId: string; reason: string }[] = [];
  const tacticBpsByForceId = new Map<string, number>();
  for (const proposal of input.tacticalProposals ?? []) {
    const proposer = participants.find(
      (p) => p.commander?.id === proposal.actorId || p.forceId === proposal.actorId || p.force.controllerCharacterId === proposal.actorId,
    );
    if (!proposer) {
      rejectedTactics.push({ actorId: proposal.actorId, reason: "Proposing actor is not a participant in this battle." });
      continue;
    }
    const failedPrecondition = proposal.preconditions.find((p) => p.subjectId !== null && !knownSubjectIds.has(p.subjectId));
    if (failedPrecondition) {
      rejectedTactics.push({ actorId: proposal.actorId, reason: `Precondition unmet: ${failedPrecondition.label}` });
      continue;
    }
    acceptedTactics.push(proposal);
    const bps = MAGNITUDE_BPS[proposal.magnitude];
    tacticBpsByForceId.set(proposer.forceId, (tacticBpsByForceId.get(proposer.forceId) ?? 0) + bps);
  }

  // ── Phase 1: contact ────────────────────────────────────────────────────
  const drawVariance = (side: BattleSide): number => {
    const roll = rng();
    draws.push({ phase: "contact", label: `variance:${side}`, value: Math.round(roll * 2_000) });
    return Math.round((roll - 0.5) * 2_000); // ±1000 bps of friction/fortune
  };
  const attackerVarianceBps = drawVariance("attacker");
  const defenderVarianceBps = drawVariance("defender");

  const attackerContributions = attackers.map((p) => computeForceContribution(p, province, provinceMaterial, warfareRules, attackerVarianceBps, tacticBpsByForceId.get(p.forceId) ?? 0, structures, adjacentProvinceIds));
  const defenderContributions = defenders.map((p) => computeForceContribution(p, province, provinceMaterial, warfareRules, defenderVarianceBps, tacticBpsByForceId.get(p.forceId) ?? 0, structures, adjacentProvinceIds));
  const attackerEffectiveStrength = Math.round(attackerContributions.reduce((sum, c) => sum + c.effectiveStrength, 0));
  const defenderEffectiveStrength = Math.round(defenderContributions.reduce((sum, c) => sum + c.effectiveStrength, 0));

  const avoidingSide = attackers.some((p) => p.posture === "avoid_battle") ? "attacker"
    : defenders.some((p) => p.posture === "avoid_battle") ? "defender" : null;
  const contactSummary = attackerEffectiveStrength === defenderEffectiveStrength
    ? "Both sides make contact evenly matched."
    : `${attackerEffectiveStrength > defenderEffectiveStrength ? "The attacker" : "The defender"} holds the stronger position at contact.`;
  const phases: BattleResult["phases"] = [{
    phase: "contact",
    attackerEffectiveStrength,
    defenderEffectiveStrength,
    summary: avoidingSide ? `${contactSummary} The ${avoidingSide} is forced into battle despite orders to avoid one.` : contactSummary,
  }];

  // ── Phase 2: engagement ─────────────────────────────────────────────────
  //
  // A committed battle is meant to be decisive, not a skirmish: an evenly
  // matched fight (each side's opposing-strength share ~0.5) costs each side
  // roughly a fifth of its committed fit, and a genuinely lopsided one (the
  // outmatched side's own strength approaching zero) can cost the losing
  // side close to half. MAX_EXCHANGE_RATE is the rate at share == 1 (the
  // opposing side contributed effectively all the total strength); the rate
  // scales linearly with share below that, so it already reflects every
  // input `computeForceContribution` folds in -- headcount, terrain,
  // commander quality, morale, cohesion, supply, and posture -- without a
  // second, separate "mismatch" term.
  const totalStrength = Math.max(1, attackerEffectiveStrength + defenderEffectiveStrength);
  const MAX_EXCHANGE_RATE = 0.45;
  const attackerCasualtyRate = clampBps(MAX_EXCHANGE_RATE * (defenderEffectiveStrength / totalStrength) * 10_000, 0, 4_500) / 10_000;
  const defenderCasualtyRate = clampBps(MAX_EXCHANGE_RATE * (attackerEffectiveStrength / totalStrength) * 10_000, 0, 4_500) / 10_000;

  const casualties: CasualtyResult[] = [];
  const casualtyCountByForce = new Map<string, number>();
  const applyCasualties = (contributions: readonly ForceContribution[], rate: number) => {
    for (const contribution of contributions) {
      const { force } = contribution.participant;
      const desertionShare = clampBps(0.10 * (10_000 - force.cohesionBps) / 10_000 * 10_000, 0, 4_000) / 10_000;
      let forceCasualtyTotal = 0;
      for (const category of force.personnel) {
        const categoryCasualties = Math.floor(category.fit * rate);
        if (categoryCasualties <= 0) continue;
        const deserted = Math.floor(categoryCasualties * desertionShare);
        const dead = Math.floor((categoryCasualties - deserted) * 0.35);
        const wounded = categoryCasualties - deserted - dead;
        forceCasualtyTotal += categoryCasualties;
        casualties.push({
          forceId: force.id,
          categoryId: category.categoryId,
          dead,
          deserted,
          wounded,
          recoveryEligibleAtStep: battle.startedAtStep + 8,
        });
      }
      casualtyCountByForce.set(force.id, forceCasualtyTotal);
    }
  };
  applyCasualties(attackerContributions, attackerCasualtyRate);
  applyCasualties(defenderContributions, defenderCasualtyRate);

  phases.push({
    phase: "engagement",
    attackerEffectiveStrength,
    defenderEffectiveStrength,
    summary: `The lines clash: the ${attackerCasualtyRate >= defenderCasualtyRate ? "attacker" : "defender"} bears the heavier loss.`,
  });

  // ── Phase 3: cohesion ───────────────────────────────────────────────────
  const routCohesionBps = warfareRules?.routCohesionBps ?? 2_000;
  const forceChanges: ForceStateChange[] = [];
  const cohesionAfterByForce = new Map<string, number>();
  for (const contribution of [...attackerContributions, ...defenderContributions]) {
    const { force } = contribution.participant;
    const casualtyCount = casualtyCountByForce.get(force.id) ?? 0;
    const authorized = Math.max(1, totalPersonnel(force));
    const cohesionLoss = clampBps((casualtyCount / authorized) * 10_000 * 1.5, 0, 10_000);
    const nextCohesion = clampBps(force.cohesionBps - cohesionLoss);
    const nextMorale = clampBps(force.moraleBps - Math.round(cohesionLoss * 0.6));
    const nextFatigue = clampBps(force.fatigueBps + 1_500);
    cohesionAfterByForce.set(force.id, nextCohesion);
    forceChanges.push({
      forceId: force.id,
      moraleBps: nextMorale,
      cohesionBps: nextCohesion,
      fatigueBps: nextFatigue,
      explanation: `${force.name} absorbs ${casualtyCount} casualties at ${province.name}.`,
    });
  }

  const sideBroken = (contributions: readonly ForceContribution[]): boolean => {
    if (contributions.length === 0) return false;
    const totalBefore = contributions.reduce((sum, c) => sum + totalPersonnel(c.participant.force), 0) || 1;
    const weightedCohesion = contributions.reduce(
      (sum, c) => sum + (cohesionAfterByForce.get(c.participant.force.id) ?? c.participant.force.cohesionBps) * totalPersonnel(c.participant.force),
      0,
    ) / totalBefore;
    return weightedCohesion < routCohesionBps;
  };
  const attackerBroken = sideBroken(attackerContributions);
  const defenderBroken = sideBroken(defenderContributions);

  phases.push({
    phase: "cohesion",
    attackerEffectiveStrength,
    defenderEffectiveStrength,
    summary: attackerBroken
      ? "The attacker's formation breaks under the strain."
      : defenderBroken
        ? "The defender's line gives way."
        : "Both sides hold their formation.",
  });

  // ── Phase 4: withdrawal ─────────────────────────────────────────────────
  const retreatDestination = [...adjacentProvinceIds].sort()[0] ?? null;
  const retreats: RetreatResult[] = [];
  // The floor scales with MAX_EXCHANGE_RATE the same way DECISIVE_CASUALTY_RATE
  // does above: 0.30 of a 0.45 ceiling is the same "took the clear majority
  // of the exchange" bar the old 0.15-of-0.20 floor meant.
  const orderlyWithdrawal = !attackerBroken && !defenderBroken
    && attackerCasualtyRate > 0 && defenderCasualtyRate > 0
    && Math.max(attackerCasualtyRate, defenderCasualtyRate) > 1.5 * Math.min(attackerCasualtyRate, defenderCasualtyRate)
    && Math.max(attackerCasualtyRate, defenderCasualtyRate) > 0.30;
  const attackerWithdraws = attackerBroken || (orderlyWithdrawal && attackerCasualtyRate > defenderCasualtyRate);
  const defenderWithdraws = defenderBroken || (orderlyWithdrawal && defenderCasualtyRate > attackerCasualtyRate);
  if (attackerWithdraws) {
    for (const contribution of attackerContributions) {
      retreats.push({ forceId: contribution.participant.force.id, toProvinceId: retreatDestination, orderly: !attackerBroken });
    }
  }
  if (defenderWithdraws) {
    for (const contribution of defenderContributions) {
      retreats.push({ forceId: contribution.participant.force.id, toProvinceId: retreatDestination, orderly: !defenderBroken });
    }
  }

  phases.push({
    phase: "withdrawal",
    attackerEffectiveStrength,
    defenderEffectiveStrength,
    summary: retreats.length === 0
      ? "Neither side withdraws; the engagement ends where it stood."
      : `${attackerWithdraws ? "The attacker" : "The defender"} withdraws from the field.`,
  });

  // ── Phase 5: aftermath ──────────────────────────────────────────────────
  let outcome: BattleResult["outcome"];
  if (attackerWithdraws && !defenderWithdraws) outcome = "defender_victory";
  else if (defenderWithdraws && !attackerWithdraws) outcome = "attacker_victory";
  else if (attackerWithdraws && defenderWithdraws) outcome = "inconclusive";
  else outcome = attackerCasualtyRate === defenderCasualtyRate ? "inconclusive" : attackerCasualtyRate < defenderCasualtyRate ? "attacker_victory" : "defender_victory";

  const commanderChanges: CommanderStateChange[] = [];
  const rollCommanderOutcome = (contribution: ForceContribution, losingSide: boolean): CommanderStateChange | null => {
    const { commander, force } = contribution.participant;
    if (!commander) return null;
    const roll = rng();
    draws.push({ phase: "aftermath", label: `commander:${commander.id}`, value: Math.round(roll * 10_000) });
    // Cumulative bands, checked worst-first: killed, then (losing side only)
    // captured, then wounded, else unharmed. A losing commander faces a real
    // chance of capture that a winning one never does.
    const killedBand = losingSide ? 0.02 : 0.005;
    const capturedBand = losingSide ? killedBand + 0.06 : killedBand;
    const woundedBand = capturedBand + (losingSide ? 0.10 : 0.03);
    let commanderOutcome: CommanderStateChange["outcome"];
    if (roll < killedBand) commanderOutcome = "killed";
    else if (roll < capturedBand) commanderOutcome = "captured";
    else if (roll < woundedBand) commanderOutcome = "wounded";
    else commanderOutcome = "unharmed";
    return { forceId: force.id, characterId: commander.id, outcome: commanderOutcome };
  };
  for (const contribution of attackerContributions) {
    const change = rollCommanderOutcome(contribution, attackerWithdraws);
    if (change) commanderChanges.push(change);
  }
  for (const contribution of defenderContributions) {
    const change = rollCommanderOutcome(contribution, defenderWithdraws);
    if (change) commanderChanges.push(change);
  }

  // "Heavy losses" relative to the exchange formula's own reachable range:
  // attackerCasualtyRate/defenderCasualtyRate are MAX_EXCHANGE_RATE(0.45) *
  // share, so a threshold of 0.30 requires the losing side's opposing-
  // strength share to have exceeded about two-thirds -- the clear majority
  // of the exchange, not merely more than half.
  const DECISIVE_CASUALTY_RATE = 0.30;
  const siegeAndControlChanges: SiegeOrControlChange[] = [];
  if (outcome === "attacker_victory" && defenderCasualtyRate > DECISIVE_CASUALTY_RATE && province.controllerPolityId) {
    siegeAndControlChanges.push({
      provinceId: province.id,
      newControllerPolityId: province.controllerPolityId,
      controlFirmnessBps: clampBps(province.controlFirmnessBps - 1_500),
      explanation: `Defeat at ${province.name} weakens its defenders' grip without yet costing them the province.`,
    });
  }

  phases.push({
    phase: "aftermath",
    attackerEffectiveStrength,
    defenderEffectiveStrength,
    summary: outcome === "inconclusive"
      ? `The battle at ${province.name} ends inconclusively.`
      : `${(outcome === "attacker_victory" ? attackerContributions : defenderContributions).map((contribution) => contribution.participant.force.name).join(" and ")} holds the field at ${province.name}.`,
  });

  const facts: WorldFact[] = [{
    id: `${battle.battleId}-result`,
    kind: "battle_resolved",
    atStep: battle.startedAtStep,
    subjectIds: participants.map((p) => p.forceId),
    visibility: "public",
    salience: outcome === "inconclusive" ? 5 : 8,
    detail: {
      provinceName: province.name,
      outcome,
      attackerCasualties: String(attackerContributions.reduce((sum, c) => sum + (casualtyCountByForce.get(c.participant.force.id) ?? 0), 0)),
      defenderCasualties: String(defenderContributions.reduce((sum, c) => sum + (casualtyCountByForce.get(c.participant.force.id) ?? 0), 0)),
    },
    playerInvolvement: [],
  }];

  return {
    battleId: battle.battleId,
    participantIds: participants.map((p) => p.forceId),
    attackerForceIds: attackerContributions.map((contribution) => contribution.participant.force.id),
    outcome,
    phases,
    acceptedTactics,
    rejectedTactics,
    draws,
    casualties,
    captures: [],
    forceChanges,
    commanderChanges,
    retreats,
    siegeAndControlChanges,
    facts,
  };
}
