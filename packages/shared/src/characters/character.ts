import { z } from "zod";
import {
  AccountPermissionSchema,
  BasisPointsSchema,
  ElapsedStepSchema,
  EntityIdSchema,
  ReservedPowerCategorySchema,
  SignedScoreSchema,
} from "../material-state";

// Characters (docs/08).
//
// You play a person, not a nation. That decision propagates into what you can
// reach, what you can know, what you want and how long you live -- and it is
// why a match reads like a history rather than a scoreboard.
//
// Two guardrails are expressed in these shapes rather than left to convention:
// every number carries the reason it changed, and confirmed death is final.

/** A reason a relation is what it is. "-30: you executed his brother." */
export const RelationCauseSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(200),
    score: SignedScoreSchema,
    occurredAtStep: ElapsedStepSchema,
    /**
     * How much of the score fades per year, in basis points.
     *
     * Causes decay at different rates: an insult fades, a killed kinsman does
     * not. Zero means permanent, which is the point of making it a field.
     */
    decayPerYearBps: BasisPointsSchema,
    /** The encounter this came from, once continuity exists. */
    encounterMemoryId: EntityIdSchema.nullable(),
  })
  .strict();
export type RelationCause = z.infer<typeof RelationCauseSchema>;

/**
 * A directed opinion. A's view of B is not B's view of A.
 *
 * There is deliberately no bare score field: the score is derived from causes,
 * so the game can always say what produced it.
 */
export const DirectedRelationSchema = z
  .object({
    subjectCharacterId: EntityIdSchema,
    causes: z.array(RelationCauseSchema),
  })
  .strict();
export type DirectedRelation = z.infer<typeof DirectedRelationSchema>;

export const AmbitionSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(200),
    kind: z.enum(["office", "wealth", "revenge", "peace", "dynasty", "restoration", "other"]),
    targetId: EntityIdSchema.nullable(),
    status: z.enum(["active", "fulfilled", "abandoned", "inherited"]),
  })
  .strict();
export type Ambition = z.infer<typeof AmbitionSchema>;

export const CharacterSkillsSchema = z
  .object({
    administration: z.number().int().min(0).max(100),
    diplomacy: z.number().int().min(0).max(100),
    war: z.number().int().min(0).max(100),
    intrigue: z.number().int().min(0).max(100),
    learning: z.number().int().min(0).max(100),
    stewardship: z.number().int().min(0).max(100),
  })
  .strict();
export type CharacterSkills = z.infer<typeof CharacterSkillsSchema>;

export const CharacterSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    cultureId: EntityIdSchema,
    faithId: EntityIdSchema.nullable(),
    dynastyId: EntityIdSchema.nullable(),
    locationProvinceId: EntityIdSchema,
    polityId: EntityIdSchema.nullable(),

    /**
     * Age at the scenario's step zero. Current age is derived from elapsedStep
     * and the scenario's steps-per-year, so nothing has to be recomputed into
     * the snapshot every step -- and no character needs a negative birth step.
     */
    ageYearsAtStart: z.number().int().min(0).max(120),

    /** The office held, if any. A character's reach is their office. */
    officeId: EntityIdSchema.nullable(),
    personalAccountId: EntityIdSchema,

    skills: CharacterSkillsSchema,
    traits: z.array(EntityIdSchema),
    healthBps: BasisPointsSchema,
    prestigeBps: BasisPointsSchema,

    relations: z.array(DirectedRelationSchema),
    ambitions: z.array(AmbitionSchema),

    /** Named heir, where the succession law uses one. */
    heirCharacterId: EntityIdSchema.nullable(),

    alive: z.boolean(),
    /** Set once, never cleared. Confirmed death is final (docs/08). */
    diedAtStep: ElapsedStepSchema.nullable(),
  })
  .strict()
  .superRefine((character, context) => {
    if (character.alive && character.diedAtStep !== null) {
      context.addIssue({
        code: "custom",
        path: ["diedAtStep"],
        message: "A living character cannot have died. Confirmed death is final.",
      });
    }
    if (!character.alive && character.diedAtStep === null) {
      context.addIssue({
        code: "custom",
        path: ["diedAtStep"],
        message: "A dead character must record when they died.",
      });
    }
  });
export type Character = z.infer<typeof CharacterSchema>;

/**
 * An office: a seat through which power is exercised.
 *
 * Scenario data, not code. docs/07 is explicit that a hardcoded government type
 * is a bug -- a scenario author must be able to define a form nobody
 * anticipated without touching the engine.
 */
export const OfficeSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(120),
    polityId: EntityIdSchema,
    /** Which workflows its holder may lawfully invoke. */
    authorisedActionIds: z.array(EntityIdSchema),
    /** Reserved powers it may sponsor a motion for. */
    sponsorableCategories: z.array(ReservedPowerCategorySchema),
    /** Treasury access, which is reach and never ownership. */
    treasuryAccountId: EntityIdSchema.nullable(),
    treasuryPermissions: z.array(AccountPermissionSchema),
    /** Pay, which stops with the office. */
    incomeSourceId: EntityIdSchema.nullable(),
    /** The estate that expects to fill it; appointing against it costs. */
    expectedBlocId: EntityIdSchema.nullable(),
    successionRuleId: EntityIdSchema,
  })
  .strict();
export type Office = z.infer<typeof OfficeSchema>;

export const SuccessionRuleSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(120),
    kind: z.enum(["primogeniture", "elective", "appointment", "seniority"]),
    /** Elective rules name the institution that chooses. */
    institutionId: EntityIdSchema.nullable(),
  })
  .strict();
export type SuccessionRule = z.infer<typeof SuccessionRuleSchema>;

export const ScenarioGovernmentRulesSchema = z
  .object({
    offices: z.array(OfficeSchema),
    successionRules: z.array(SuccessionRuleSchema).min(1),
    /**
     * Authority a decree costs its sponsor, and the prestige floor below which
     * one fails outright. Scenario data so a strong crown and a weak one are
     * the same code.
     */
    decreeAuthorityCostBps: BasisPointsSchema,
    decreeMinimumPrestigeBps: BasisPointsSchema,
  })
  .strict();
export type ScenarioGovernmentRules = z.infer<typeof ScenarioGovernmentRulesSchema>;
