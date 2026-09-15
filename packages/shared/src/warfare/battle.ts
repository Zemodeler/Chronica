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
