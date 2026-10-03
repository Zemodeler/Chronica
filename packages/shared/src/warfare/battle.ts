import { z } from "zod";
import {
  BasisPointsSchema,
  ElapsedStepSchema,
  EntityIdSchema,
  VisibilitySchema,
} from "../material-state";
import { BattlePhaseSchema, TacticalModifierProposalSchema } from "./tactical-modifier";
import { PlayerInvolvementSchema, SalienceSchema } from "../world/scope";

// Warfare (docs/19, ADR-0031).
//
// Warfare is a deterministic simulation system, not an AI verdict. Players
// describe strategic intent and may invent tactics, but forces, movement,
// supply, battle and siege resolve from authoritative world state.
//
// The shapes here are deliberately narrow in one direction: there is no field
// through which a model could write a casualty, a retreat, a capture or a
// winner. It may propose a bounded modifier; the engine alone decides outcomes.

/**
 * A troop category the scenario declares.
 *
 * A period may model hoplites, cavalry and rowers while another models pike,
 * shot and artillery. The engine consumes shared capabilities rather than
 * assuming one timeless unit list, so a scenario can invent a category without
 * touching game code.
 */
export const TroopCategoryDefinitionSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    /** Combat contribution per head, against the scenario's baseline of 10000. */
    combatWeightBps: BasisPointsSchema,
    /** How well it holds ground; feeds cohesion loss under pressure. */
    steadinessBps: BasisPointsSchema,
    /** Mobility, used for pursuit and withdrawal. */
    mobilityBps: BasisPointsSchema,
    /**
     * Whether this category fights and travels on water.
     *
     * Scenario data rather than a hardcoded unit list, for the same reason the
     * rest of this file is: a period with triremes and one with galleons should
     * not need different game code, and a period with neither should not carry
     * a naval system it never uses. Optional, so every scenario written before
     * ships existed still parses -- and its armies stay armies.
     */
    naval: z.boolean().default(false),
    /**
     * Men this category can carry across water, per head of its own. An army
     * crossing a strait needs hulls to do it in, and this is how many.
     */
    transportPerHead: z.number().int().min(0).max(1_000).default(0),
  })
  .strict();
export type TroopCategoryDefinition = z.infer<typeof TroopCategoryDefinitionSchema>;

/**
 * A routine tactic: enumerated scenario data with deterministic effects.
 *
 * Choosing one makes no model call. This is the cheap path that keeps ordinary
 * warfare free -- holding prepared ground, forcing a crossing, screening a
 * retreat -- where those concepts exist in the period.
 */
export const RoutineTacticSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    factor: z.enum(["deployment", "surprise", "effective_strength", "cohesion", "morale", "withdrawal"]),
    phases: z.array(BattlePhaseSchema).min(1),
    /** Signed, in basis points. Bounded by the same cap as a novel proposal. */
    modifierBps: z.number().int().min(-2_000).max(2_000),
  })
  .strict();
export type RoutineTactic = z.infer<typeof RoutineTacticSchema>;

export const ScenarioWarfareRulesSchema = z
  .object({
    troopCategories: z.array(TroopCategoryDefinitionSchema).min(1),
    routineTactics: z.array(RoutineTacticSchema),
    /**
     * Phases this scenario resolves, in order.
     *
     * A scenario may omit an inapplicable phase but may not reorder them during
     * a match, so the order is pinned with the rest of its rules.
     */
    phases: z.array(BattlePhaseSchema).min(1),
    /** Below this cohesion, a formation breaks. */
    routCohesionBps: BasisPointsSchema,
    /** Arrears periods before morale suffers, and before desertion begins. */
    arrearsMoralePeriods: z.number().int().positive(),
    arrearsDesertionPeriods: z.number().int().positive(),
  })
  .strict();
export type ScenarioWarfareRules = z.infer<typeof ScenarioWarfareRulesSchema>;

export const BattleSideSchema = z.enum(["attacker", "defender"]);
export type BattleSide = z.infer<typeof BattleSideSchema>;

export const BattleParticipantSchema = z
  .object({
    forceId: EntityIdSchema,
    side: BattleSideSchema,
    /** Which phase it can first contribute. Reinforcements arrive later. */
    arrivesAtPhase: BattlePhaseSchema,
  })
  .strict();
export type BattleParticipant = z.infer<typeof BattleParticipantSchema>;

/**
 * One battle, with its participants fixed before engagement.
 *
 * docs/19: later iteration or map order cannot add a participant
 * retroactively. Freezing the roster at creation is what makes that structural
 * rather than a rule someone has to remember.
 */
export const BattleSchema = z
  .object({
    battleId: EntityIdSchema,
    provinceId: EntityIdSchema,
    startedAtStep: ElapsedStepSchema,
    participants: z.array(BattleParticipantSchema).min(2),
  })
  .strict()
  .superRefine((battle, context) => {
    const sides = new Set(battle.participants.map((participant) => participant.side));
    if (sides.size < 2) {
      context.addIssue({
        code: "custom",
        path: ["participants"],
        message: "A battle needs both an attacker and a defender.",
      });
    }
  });
export type Battle = z.infer<typeof BattleSchema>;

/**
 * A random draw, recorded so a replay can be checked rather than trusted.
 *
 * The stream is scoped to (turnId, "combat", battleId, phase), so adding a
 * battle elsewhere cannot shift this battle's draws.
 */
export const RecordedRandomDrawSchema = z
  .object({
    phase: BattlePhaseSchema,
    label: z.string().trim().min(1).max(80),
    value: z.number().int().nonnegative(),
  })
  .strict();
export type RecordedRandomDraw = z.infer<typeof RecordedRandomDrawSchema>;

export const CasualtyResultSchema = z
  .object({
    forceId: EntityIdSchema,
    categoryId: EntityIdSchema,
    /**
     * The formation that bore it, where the army is drawn up in formations:
     * the hastati of Legio II, not "infantry". Absent, the loss is shared
     * among the army's rows of that kind of troops by strength, as before.
     */
    formationId: EntityIdSchema.optional(),
    /** Permanent. Never recovered. */
    dead: z.number().int().nonnegative(),
    /** Permanent. The people are gone, not resting. */
    deserted: z.number().int().nonnegative(),
    /** Temporary, and step-gated: recovery is eligible, not automatic. */
    wounded: z.number().int().nonnegative(),
    recoveryEligibleAtStep: ElapsedStepSchema,
  })
  .strict();
export type CasualtyResult = z.infer<typeof CasualtyResultSchema>;

/**
 * How a battle's wounded mend.
 *
 * Every wounded man was back in the ranks eight days after the fight, all on
 * the same morning: a legion that lost two thousand to wounds at Messana stood
 * at full strength again a week later. Wounds from sword and spear took weeks,
 * when they healed at all. A quarter never stand in the line again -- dead of
 * their wounds in the days after, or sent home unfit -- and the rest come back
 * over three to six weeks, a share each week.
 */
export const WOUNDS_NEVER_RETURN_BPS = 2_500;
/** The days after the battle on which the mended come back, in equal shares. */
export const WOUND_RETURN_DAYS = [21, 28, 35, 42] as const;

/** The wounded of one battle split into the lost and the returning, by day. Deterministic. */
export function woundsMend(wounded: number, woundedAtStep: number): { lost: number; back: { count: number; atStep: number }[] } {
  if (wounded <= 0) return { lost: 0, back: [] };
  const lost = Math.floor((wounded * WOUNDS_NEVER_RETURN_BPS) / 10_000);
  const returning = wounded - lost;
  const share = Math.floor(returning / WOUND_RETURN_DAYS.length);
  const back = WOUND_RETURN_DAYS.map((days, index) => ({
    // The remainder with the last: the slowest to heal.
    count: index === WOUND_RETURN_DAYS.length - 1 ? returning - share * index : share,
    atStep: woundedAtStep + days,
  })).filter((cohort) => cohort.count > 0);
  return { lost, back };
}

export const CaptureResultSchema = z
  .object({
    forceId: EntityIdSchema,
    categoryId: EntityIdSchema,
    count: z.number().int().positive(),
    capturedByForceId: EntityIdSchema,
  })
  .strict();
export type CaptureResult = z.infer<typeof CaptureResultSchema>;

export const ForceStateChangeSchema = z
  .object({
    forceId: EntityIdSchema,
    moraleBps: BasisPointsSchema,
    cohesionBps: BasisPointsSchema,
    fatigueBps: BasisPointsSchema,
    explanation: z.string().trim().min(1).max(240),
  })
  .strict();
export type ForceStateChange = z.infer<typeof ForceStateChangeSchema>;

export const CommanderStateChangeSchema = z
  .object({
    forceId: EntityIdSchema,
    characterId: EntityIdSchema,
    outcome: z.enum(["unharmed", "wounded", "captured", "killed"]),
  })
  .strict();
export type CommanderStateChange = z.infer<typeof CommanderStateChangeSchema>;

export const RetreatResultSchema = z
  .object({
    forceId: EntityIdSchema,
    toProvinceId: EntityIdSchema.nullable(),
    orderly: z.boolean(),
  })
  .strict();
export type RetreatResult = z.infer<typeof RetreatResultSchema>;

export const SiegeOrControlChangeSchema = z
  .object({
    provinceId: EntityIdSchema,
    newControllerPolityId: EntityIdSchema.nullable(),
    controlFirmnessBps: BasisPointsSchema,
    explanation: z.string().trim().min(1).max(240),
  })
  .strict();
export type SiegeOrControlChange = z.infer<typeof SiegeOrControlChangeSchema>;

/** A structured event the chronicle is derived from. Never prose. */
export const WorldFactSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.string().trim().min(1).max(80),
    atStep: ElapsedStepSchema,
    subjectIds: z.array(EntityIdSchema),
    visibility: VisibilitySchema,
    salience: SalienceSchema,
    /** Values a template renders. Labels and amounts stay outside model prose. */
    detail: z.record(z.string(), z.union([z.string(), z.number()])),
    playerInvolvement: z.array(PlayerInvolvementSchema),
  })
  .strict();
export type WorldFact = z.infer<typeof WorldFactSchema>;

export const BattlePhaseResultSchema = z
  .object({
    phase: BattlePhaseSchema,
    attackerEffectiveStrength: z.number().int().nonnegative(),
    defenderEffectiveStrength: z.number().int().nonnegative(),
    summary: z.string().trim().min(1).max(240),
  })
  .strict();
export type BattlePhaseResult = z.infer<typeof BattlePhaseResultSchema>;

/**
 * Structured data, not chronicle prose.
 *
 * The chronicle is derived later from audience-eligible resolved facts;
 * narration cannot change the result or grant character knowledge.
 */
export const BattleResultSchema = z
  .object({
    battleId: EntityIdSchema,
    participantIds: z.array(EntityIdSchema).min(2),
    /**
     * Which of the participants attacked.
     *
     * Without it the result recorded who won *by role* -- "attacker_victory" --
     * and nothing anywhere said which army held which role, so the summary
     * could only report that "the defender prevails". A historian reading that
     * has to guess, and guessed wrong: an entry announced that the Boii host
     * prevailed in a battle it lost two to one, broke, and had its chief taken.
     */
    attackerForceIds: z.array(EntityIdSchema).min(1),
    outcome: z.enum(["attacker_victory", "defender_victory", "inconclusive"]),
    phases: z.array(BattlePhaseResultSchema).min(1),
    acceptedTactics: z.array(TacticalModifierProposalSchema),
    /** Tactics the engine refused, with why. A rejection is a fact too. */
    rejectedTactics: z.array(
      z.object({ actorId: EntityIdSchema, reason: z.string().trim().min(1).max(240) }).strict(),
    ),
    draws: z.array(RecordedRandomDrawSchema),
    casualties: z.array(CasualtyResultSchema),
    captures: z.array(CaptureResultSchema),
    forceChanges: z.array(ForceStateChangeSchema),
    commanderChanges: z.array(CommanderStateChangeSchema),
    retreats: z.array(RetreatResultSchema),
    siegeAndControlChanges: z.array(SiegeOrControlChangeSchema),
    facts: z.array(WorldFactSchema),
  })
  .strict();
export type BattleResult = z.infer<typeof BattleResultSchema>;
