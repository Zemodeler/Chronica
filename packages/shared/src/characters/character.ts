import { z } from "zod";
import {
  AccountPermissionSchema,
  BasisPointsSchema,
  ElapsedStepSchema,
  EntityIdSchema,
  ReservedPowerCategorySchema,
  SignedScoreSchema,
} from "../material-state";
import { CharacterMindSchema, NEUTRAL_MIND } from "./mind";
import { LessonSchema, MAX_LESSONS } from "./mind-drift";
import { WatchPredicateSchema } from "../world/watch";

// Characters (docs/08).
//
// You play a person, not a nation. That decision propagates into what you can
// reach, what you can know, what you want and how long you live -- and it is
// why a match reads like a history rather than a scoreboard.
//
// Two guardrails are expressed in these shapes rather than left to convention:
// every number carries the reason it changed, and confirmed death is final.

/**
 * A dimension a relation cause can move, beyond the flat legacy score
 * (character-sim phase 2). Directed like the relation itself: A's trust in B
 * is independent of B's trust in A.
 */
export const RelationDimensionSchema = z.enum(["trust", "affection", "fear", "respect", "obligation", "reputation"]);
export type RelationDimension = z.infer<typeof RelationDimensionSchema>;

export const RelationDimensionScoresSchema = z
  .object({
    trust: SignedScoreSchema,
    affection: SignedScoreSchema,
    fear: SignedScoreSchema,
    respect: SignedScoreSchema,
    obligation: SignedScoreSchema,
    reputation: SignedScoreSchema,
  })
  .partial()
  .strict();

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
    /**
     * Which dimensions this cause moves and by how much (character-sim phase 2).
     * Optional so every pre-phase-2 cause stays valid: a cause with no
     * `dimensions` is read as contributing its bare `score` to `affection`
     * only, and nothing to any other dimension -- the documented legacy
     * default (packages/shared/src/characters/relationship-dimensions.ts).
     */
    dimensions: RelationDimensionScoresSchema.optional(),
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

export const AmbitionKindSchema = z.enum(["office", "wealth", "revenge", "peace", "dynasty", "restoration", "other"]);

/**
 * One step of a plan: something the person means to have done by a day.
 *
 * An ambition used to be a label and nothing else, so whether a man made
 * progress on it over two years depended on whether the rotation kept asking
 * him and he kept remembering. A step is what the engine can hold him to. It
 * decides *when* -- the day comes near, or the thing it waits on happens --
 * and wakes him; he decides what the step becomes when he takes it.
 *
 * A step is only ever in one of three states. "missed" is not the end of the
 * plan: it is news for its owner, who is woken to carry on late, lay it again,
 * or give it up.
 */
export const PlanStepSchema = z
  .object({
    id: EntityIdSchema,
    /** What he means to do, as he would say it. Shown back, never parsed. */
    act: z.string().trim().min(1).max(200),
    /** The world day by which it should have happened (`world.instant.day`). */
    dueDay: z.number().int().nonnegative(),
    /** The day it was laid. A step is not asked about before half its time has run. */
    laidOnDay: z.number().int().nonnegative().default(0),
    /** What it waits on, if anything. The same language a watch is written in. */
    waitsOn: WatchPredicateSchema.nullable().default(null),
    /**
     * What `waitsOn` read when the step was laid. Two predicates -- who holds a
     * province, who holds a city -- are changes rather than states, and a
     * change can only be seen against what it changed from.
     */
    armedReading: z.string().max(120).nullable().default(null),
    status: z.enum(["pending", "done", "missed"]).default("pending"),
    /** The day its owner was last woken for it; a step wakes him once for being due and once for being missed. */
    wokenOnDay: z.number().int().nonnegative().nullable().default(null),
    settledOnDay: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const AmbitionSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(200),
    kind: AmbitionKindSchema,
    targetId: EntityIdSchema.nullable(),
    status: z.enum(["active", "fulfilled", "abandoned", "inherited"]),
    /** The plan, in order. Empty for a want nobody has worked out how to get. */
    steps: z.array(PlanStepSchema).max(8).default([]),
  })
  .strict();
export type Ambition = z.infer<typeof AmbitionSchema>;

/**
 * Sub-skills are invisible to the player at all times.
 * AI assigns only the sub-skills relevant to the character's knowledgebase;
 * .partial() allows omitting irrelevant ones.
 */
export const CharacterSubSkillsSchema = z
  .object({
    // Martial
    strategist: z.number().int().min(0).max(100),
    authority: z.number().int().min(0).max(100),
    // Intrigue
    espionage: z.number().int().min(0).max(100),
    manipulation: z.number().int().min(0).max(100),
    // Diplomacy
    rhetoric: z.number().int().min(0).max(100),
    arbitration: z.number().int().min(0).max(100),
    // Stewardship
    logistics: z.number().int().min(0).max(100),
    taxation: z.number().int().min(0).max(100),
    // Learning
    theology: z.number().int().min(0).max(100),
    scholarship: z.number().int().min(0).max(100),
    // Piety
    devotion: z.number().int().min(0).max(100),
    rites: z.number().int().min(0).max(100),
    // Body
    endurance: z.number().int().min(0).max(100),
    prowess: z.number().int().min(0).max(100),
  })
  .partial()
  .strict();
export type CharacterSubSkills = z.infer<typeof CharacterSubSkillsSchema>;

export const CharacterSkillsSchema = z
  .object({
    martial: z.number().int().min(0).max(100),
    intrigue: z.number().int().min(0).max(100),
    learning: z.number().int().min(0).max(100),
    piety: z.number().int().min(0).max(100),
    stewardship: z.number().int().min(0).max(100),
    diplomacy: z.number().int().min(0).max(100),
    body: z.number().int().min(0).max(100),
    subSkills: CharacterSubSkillsSchema,
  })
  .strict();

/**
 * What a man's gifts have been, beside what they are: the best each finer
 * skill has reached (it never falls below half of that), when each was last
 * put to use (one unused for a year starts to go), and the last yearly
 * reckoning of what age and disuse have done (`sim/skill-decline.ts`).
 */
export const SkillRecordSchema = z
  .object({
    peaks: CharacterSubSkillsSchema.default({}),
    usedAtStep: z.record(z.string(), z.number().int().nonnegative()).default({}),
    reviewedAtStep: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type SkillRecord = z.infer<typeof SkillRecordSchema>;
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
     * Age at the scenario's step zero. Frozen at creation -- never mutate this
     * after a character exists; use `characters/age.ts`'s `currentAgeYears` to
     * get today's age. (The `add_age` workflow that once mutated this directly
     * is now a system-only data-correction path, not part of normal play.)
     */
    ageYearsAtStart: z.number().int().min(0).max(120),

    /**
     * The exact elapsedStep this character was born, for a character born
     * during play (character-sim phase 5). `null` (the default, so every
     * pre-phase-5 character stays valid) means "derive age from
     * `ageYearsAtStart` as of elapsedStep 0" -- today's behaviour.
     */
    birthStep: z.number().int().safe().nullable().default(null),

    /**
     * Next step this character's life (aging, health, incapacity, death) is
     * due for deterministic review (character-sim phase 5). `null` means not
     * yet opted into review -- every pre-phase-5 character stays valid; the
     * turn pipeline schedules it going forward.
     */
    nextLifeReviewAtStep: ElapsedStepSchema.nullable().default(null),

    /** The office held, if any. A character's reach is their office. */
    officeId: EntityIdSchema.nullable(),
    personalAccountId: EntityIdSchema,

    skills: CharacterSkillsSchema,
    skillRecord: SkillRecordSchema.optional(),
    traits: z.array(EntityIdSchema),
    healthBps: BasisPointsSchema,
    prestigeBps: BasisPointsSchema,

    relations: z.array(DirectedRelationSchema),
    ambitions: z.array(AmbitionSchema),

    /**
     * Private psychology (character-sim phase 2). Defaulted to a
     * structurally-valid but psychologically inert value so an archived
     * snapshot from before this field existed still parses; a properly
     * role-derived mind is computed by `deriveDefaultMind` at every
     * character-creation site and by the backfill script, never by this
     * schema-level default alone.
     */
    mind: CharacterMindSchema.default(NEUTRAL_MIND),
    /** What has happened to him since his last life review, which that review moves his mind by (`mind-drift.ts`). */
    lessons: z.array(LessonSchema).max(MAX_LESSONS).optional(),

    /** Named heir, where the succession law uses one. */
    heirCharacterId: EntityIdSchema.nullable(),

    alive: z.boolean(),
    /** Set once, never cleared. Confirmed death is final (docs/08). */
    diedAtStep: ElapsedStepSchema.nullable(),

    /** Provenance for NPCs introduced by the World Director at runtime. */
    createdByDirector: z.boolean().optional(),
    createdAtStep: ElapsedStepSchema.optional(),
    creationReason: z.string().trim().min(1).max(320).optional(),

    /**
     * Status tags that disqualify a living character from political
     * participation (e.g. "captured"). Defaulted so every pre-phase-4
     * character stays valid; checked by the `not_disqualified` eligibility
     * requirement kind (character-sim phase 4).
     */
    disqualifyingStatuses: z.array(EntityIdSchema).default([]),
    /** When each ailment among them passes (`ailments.ts`); written with the ailment. */
    ailmentsUntil: z.array(z.object({ status: EntityIdSchema, untilStep: ElapsedStepSchema }).strict()).optional(),

    /**
     * Every office this person has held, and when they last held it: the
     * ladder a career climbs, and the gap before the same office again. Kept
     * by the engine from the seats (sim `recordTenures`); nobody writes it.
     */
    officesHeld: z.array(z.object({ officeId: EntityIdSchema, lastHeldAtStep: ElapsedStepSchema }).strict()).default([]),
    /**
     * What the law says a person is (VISION §12; roles plan phase 4). A slave's
     * purse, movements and bargains are his owner's; a freedman keeps his old
     * master as patron, and cannot hold high office. Defaulted, so every
     * character from before this existed is free.
     */
    legalStatus: z.enum(["free", "freed", "enslaved"]).default("free"),
    gender: z.enum(["male", "female"]).default("male"),
    /** A slave's owner, or a freedman's patron. */
    ownerCharacterId: EntityIdSchema.nullable().default(null),
    /** A slave allowed a purse of his own to spend: the peculium his owner grants, and can take back. */
    peculium: z.boolean().default(false),
    /** Requirements a law or a dictator set aside for this person, for one office, until a day. */
    eligibilityWaivers: z.array(z.object({ officeId: EntityIdSchema, untilStep: ElapsedStepSchema }).strict()).default([]),
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
    /**
     * Reusable eligibility checks a holder must pass (character-sim phase 4).
     * Defaulted so every pre-phase-4 office stays valid unchanged.
     */
    eligibilityRequirementIds: z.array(EntityIdSchema).default([]),
    /**
     * How long one holding lasts, in days: a consulship's year. Null for an
     * office held until death or removal. An elective office with a term is
     * refilled by election when it runs out (sim `holdElections`).
     */
    termDays: z.number().int().positive().max(36_600).nullable().optional(),
    /**
     * What sort of holding it is. A man holds one magistracy at a time, and
     * laying one down for another is what rising means; a seat in a council
     * or a priesthood is held alongside whatever else he holds, usually for
     * life. Absent means a magistracy, which is what every office was before.
     */
    kind: z.enum(["magistracy", "membership", "priesthood"]).optional(),
    /**
     * How many hold it at once, where that is more than the world names. Only
     * named people have seats; the rest of a college of eight quaestors or a
     * Senate of three hundred is implied, and a college is elected whole once
     * a term rather than seat by seat (sim `holdElections`).
     */
    seatCount: z.number().int().positive().max(1_000).optional(),
    /** How often a college is elected, where less often than its term runs: censors held office eighteen months in every five years. */
    cycleDays: z.number().int().positive().max(36_600).optional(),
    /** Its place on the ladder, lowest first: a man is not elected to what is beneath him. */
    rank: z.number().int().min(0).max(20).optional(),
    /** Its holder may forbid a measure. Friction only: the veto is said, and the world is left to honour it. */
    vetoes: z.boolean().optional(),
    /** A council every former magistrate of its power takes a seat in when his term ends. */
    enrolsFormerMagistrates: z.boolean().optional(),
  })
  .strict();
export type Office = z.infer<typeof OfficeSchema>;

/** Whether holding this office means laying down any other magistracy. */
export const isMagistracy = (office: Pick<Office, "kind"> | undefined): boolean => (office?.kind ?? "magistracy") === "magistracy";

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

/**
 * Every office that exists: the ones the scenario opened with, and the ones the
 * world has made since.
 *
 * Called everywhere offices are read, so an office a government invented for
 * one war confers authority exactly as an authored one does. The world's copy
 * wins a collision: the only way the world comes to hold an authored office's
 * id is a measure that reformed it (`enactment.ts`), and a consulship the
 * Senate has since given a two-year term has a two-year term. Its order is
 * the scenario's, so the offices a reader lists come out as they always did.
 */
export function allOffices(
  world: { readonly offices?: readonly Office[] },
  scenarioOffices: readonly Office[] = [],
): readonly Office[] {
  const made = world.offices ?? [];
  if (made.length === 0) return scenarioOffices;
  const byId = new Map(made.map((office) => [office.id, office]));
  const authored = new Set(scenarioOffices.map((office) => office.id));
  return [...scenarioOffices.map((office) => byId.get(office.id) ?? office), ...made.filter((office) => !authored.has(office.id))];
}

/**
 * Every succession rule there is: the scenario's, and the ones the world has
 * made or changed since. The world's copy wins a collision, as with offices.
 */
export function allSuccessionRules(
  world: { readonly successionRules?: readonly SuccessionRule[] },
  scenarioRules: readonly SuccessionRule[] = [],
): readonly SuccessionRule[] {
  const made = world.successionRules ?? [];
  if (made.length === 0) return scenarioRules;
  const byId = new Map(made.map((rule) => [rule.id, rule]));
  const authored = new Set(scenarioRules.map((rule) => rule.id));
  return [...scenarioRules.map((rule) => byId.get(rule.id) ?? rule), ...made.filter((rule) => !authored.has(rule.id))];
}

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
