import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, FormationLineSchema } from "../material-state";
import { EffectBandSchema, type EffectBand } from "../world/standing-effects";

/**
 * How a power builds its armies (docs/plans/armies-in-detail.md).
 *
 * An army was a commander and a list of headcounts, so a legionary was one
 * name among seven thousand, all infantry fought alike, and there was nothing
 * for a reform to change. An establishment is what a power's armies are made
 * of: the bodies it raises (a legion, an ala of the allies, a phalanx), the
 * formations each is drawn up in, the ranks of the men who lead them, whom it
 * recruits and how, and the doctrines it fights by.
 *
 * The rule `standing-effects.ts` follows holds here too: the nouns are open,
 * the verbs are closed. A body, a formation, a rank or a doctrine may be called
 * anything; what a doctrine *does* is chosen from `DOCTRINE_LEVERS`, in bands,
 * and the engine decides what each band is worth. A model allowed to write
 * the number would write it high.
 */

/** Where a body's men come from: its citizens, its allies, men it pays, men it rules, men it settled. */
export const BodySourceSchema = z.enum(["citizen", "ally", "mercenary", "subject", "settler", "royal"]);
export type BodySource = z.infer<typeof BodySourceSchema>;

/**
 * A formation as the establishment draws it: the hastati of a legion, the
 * Companions, a syntagma of the phalanx. `units` is how it divides -- ten
 * maniples of two centuries each (a fixed count), or syntagmata of 256 (a fixed
 * size, as many as the men make).
 */
export const FormationTemplateSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    categoryId: EntityIdSchema,
    line: FormationLineSchema,
    /** Men at full strength in one body. */
    men: z.number().int().positive().max(100_000),
    units: z
      .object({
        label: z.string().trim().min(1).max(40),
        /** So many units whatever the strength (ten maniples), or ... */
        count: z.number().int().positive().max(200).optional(),
        /** ... units of so many men (syntagmata of 256). */
        size: z.number().int().positive().max(10_000).optional(),
        /** What a unit divides into, where it does: two centuries to a maniple. */
        sub: z.object({ label: z.string().trim().min(1).max(40), count: z.number().int().positive().max(20) }).strict().optional(),
      })
      .strict(),
  })
  .strict();
export type FormationTemplate = z.infer<typeof FormationTemplateSchema>;

/** A body a power raises: a legion, an ala, a phalanx, a nation's contingent, a fleet. */
export const BodyTemplateSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    /** How one is called, `{n}` for its number: "Legio {n}", "{n} Ala of the allies". */
    naming: z.string().trim().min(1).max(80),
    numerals: z.enum(["roman", "ordinal", "none"]).default("roman"),
    source: BodySourceSchema,
    /** Words in a body of men's name that say they are this kind: "allied", "socii", "Numidian". */
    matches: z.array(z.string().trim().min(2).max(40)).max(16).default([]),
    /** The body men of no particular description are formed into, for each kind of troops it has. */
    isDefault: z.boolean().default(false),
    formationIds: z.array(EntityIdSchema).min(1).max(12),
  })
  .strict();
export type BodyTemplate = z.infer<typeof BodyTemplateSchema>;

/**
 * A rank in an army. `level` says what it is over; `grade` orders ranks of a
 * level (the sixty centurions of a legion stood in grades, the primus pilus
 * first); `filledBy` says how a man comes to it.
 */
export const RankTemplateSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    level: z.enum(["army", "body", "formation", "unit", "sub", "ranks"]),
    grade: z.number().int().min(0).max(100).default(0),
    filledBy: z.enum(["appointed", "elected", "seniority", "valour", "purchase", "hereditary"]).default("appointed"),
    /** Which formations it is found in; absent is all of them. */
    formationIds: z.array(EntityIdSchema).max(20).optional(),
    /** Words a role uses for it: "centurion", "optio". */
    words: z.array(z.string().trim().min(2).max(40)).max(8).default([]),
    /**
     * The office whose holders this rank is, where it is an office: Rome's
     * military tribunes were elected magistrates, and a man holding
     * `roman-military-tribune` serving in a legion is one of its tribunes.
     */
    officeIds: z.array(EntityIdSchema).max(4).optional(),
  })
  .strict();
export type RankTemplate = z.infer<typeof RankTemplateSchema>;

/** An honour or a punishment the army gives, and what it does to a man's standing. */
export const HonourSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    kind: z.enum(["decoration", "punishment"]),
    /** What earns it, as the men would say. */
    for: z.enum(["saving_a_comrade", "first_over_the_wall", "valour", "sleeping_on_watch", "flight", "disobedience"]),
    standing: EffectBandSchema,
    /** A punishment that can kill: the fustuarium. */
    mortal: z.boolean().default(false),
  })
  .strict();
export type Honour = z.infer<typeof HonourSchema>;

export const EstablishmentSchema = z
  .object({
    polityId: EntityIdSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(600).optional(),
    bodies: z.array(BodyTemplateSchema).min(1).max(16),
    formations: z.array(FormationTemplateSchema).min(1).max(40),
    ranks: z.array(RankTemplateSchema).max(30).default([]),
    honours: z.array(HonourSchema).max(12).default([]),
    recruitment: z
      .object({
        basis: z.enum(["property_class", "citizens", "settlers", "volunteers", "mercenary", "subject_levy"]),
        /** Who qualifies, where there is a floor: the assidui above a census, or anybody. */
        floor: z.enum(["none", "low", "middling", "high"]).default("none"),
        /** Raised for the year and sent home, or kept under the standards. */
        standing: z.boolean().default(false),
      })
      .strict(),
    /** Who arms the men: themselves, or the state. */
    equipment: z.enum(["self", "state"]).default("self"),
    /** Campaigns a man owes before his discharge. */
    serviceCampaigns: z.object({ foot: z.number().int().min(1).max(40), horse: z.number().int().min(1).max(40) }).strict(),
    /** What a discharged man is owed. */
    discharge: z.enum(["none", "cash", "land"]).default("none"),
    /** Campaigns before a man may stand for office, where there is a rule. */
    campaignsForOffice: z.number().int().min(0).max(20).default(0),
    /** The power's own doctrines, by id in `world.doctrines`. */
    doctrineIds: z.array(EntityIdSchema).max(24).default([]),
    /** What the last body of each kind was numbered, so the next is the next. */
    numbered: z.record(z.string(), z.number().int().nonnegative()).default({}),
  })
  .strict();
export type MilitaryEstablishment = z.infer<typeof EstablishmentSchema>;

/**
 * The closed verbs a doctrine may move. Each is read by one engine path:
 *
 * - `frontal_weight`: what a man is worth in the clash (battle-resolver).
 * - `steadiness`: how slowly a formation loses its cohesion under loss.
 * - `line_relief`: fresh lines coming through the tired one -- worth nothing
 *   to an army with no reserve line standing.
 * - `rough_ground`: how it fights in hills, woods and marsh.
 * - `screen`: what its skirmishers buy at contact.
 * - `pursuit`: how hard it rides down a beaten enemy.
 * - `boarding`: what its ships are worth closing with an enemy's.
 * - `siege_craft`: how fast its siege works go forward.
 * - `march_speed`: how fast it marches, with or without the baggage.
 * - `supply_need`: how much bread it eats per man (raise = needs less).
 * - `drill_ceiling`, `drill_rate`: how good drill can make it, and how soon.
 * - `muster_speed`: how fast a levy comes in.
 * - `levy_cost`: what a man costs to raise and arm (raise = dearer).
 * - `manpower_basis`: how many of its people may be called.
 * - `service_length`: campaigns owed before discharge.
 * - `loyalty_to_general`: how soon an army is its general's more than its country's.
 * - `veteran_claim`: what its discharged men demand, and how hard.
 * - `pay_discipline`: how long it bears arrears before it sulks, and deserts.
 */
export const DOCTRINE_LEVERS = [
  "frontal_weight",
  "steadiness",
  "line_relief",
  "rough_ground",
  "screen",
  "pursuit",
  "boarding",
  "siege_craft",
  "march_speed",
  "supply_need",
  "drill_ceiling",
  "drill_rate",
  "muster_speed",
  "levy_cost",
  "manpower_basis",
  "service_length",
  "loyalty_to_general",
  "veteran_claim",
  "pay_discipline",
] as const;
export const DoctrineLeverSchema = z.enum(DOCTRINE_LEVERS);
export type DoctrineLever = z.infer<typeof DoctrineLeverSchema>;

/** Levers that make an army better in the field, and so count against the edge cap. */
export const COMBAT_LEVERS: ReadonlySet<DoctrineLever> = new Set(["frontal_weight", "steadiness", "line_relief", "rough_ground", "screen", "pursuit", "boarding"]);

export const DoctrineEffectSchema = z
  .object({
    lever: DoctrineLeverSchema,
    direction: z.enum(["raise", "lower"]).default("raise"),
    band: EffectBandSchema.default("slight"),
  })
  .strict()
  .meta({ id: "DoctrineEffect" });
export type DoctrineEffect = z.infer<typeof DoctrineEffectSchema>;

/**
 * A way of making war: "the triplex acies", "gladiatorial drill", "the corvus",
 * "enrol the head count". Anything at all, described in any words; it does
 * what its effects say, and costs what the engine says it costs.
 */
export const DoctrineSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(600),
    /** Authored with the world, carried by a law, or one army's own practice. */
    origin: z.enum(["scenario", "reform", "practice"]),
    polityId: EntityIdSchema,
    /** Which formations it changes: by template, by line, or by kind of troops. Absent is all of them. */
    appliesTo: z
      .object({
        formationIds: z.array(EntityIdSchema).max(20).optional(),
        lines: z.array(FormationLineSchema).max(7).optional(),
        categoryIds: z.array(EntityIdSchema).max(10).optional(),
      })
      .strict()
      .optional(),
    effects: z.array(DoctrineEffectSchema).min(1).max(8),
    /** Who pays its keep each month; null when nobody does (and then it costs nothing but time). */
    upkeepAccountId: EntityIdSchema.nullable().default(null),
    adoptedAtStep: ElapsedStepSchema,
    /** Who brought it in. */
    adoptedByCharacterId: EntityIdSchema.nullable().default(null),
    /** The army that practises it, for an army's own doctrine. */
    forceId: EntityIdSchema.nullable().default(null),
    settledThroughStep: ElapsedStepSchema.nullable().default(null),
    /** Given up, or fallen into disuse for want of its keep. */
    lapsedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type Doctrine = z.infer<typeof DoctrineSchema>;

/**
 * A way of making war, as an order or a law brings it in: "the triplex acies",
 * "gladiatorial drill", "the boarding-bridge", "enrol the head count". Called
 * anything; it does only what its effects say, in words, and the engine prices
 * every gain it names -- in its keep, and in the months the men take to learn it.
 */
export const DoctrineProposalSchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(300),
  effects: z.array(DoctrineEffectSchema).min(1).max(6),
  /** Only these lines, or these kinds of troops. Absent is all of the army. */
  lines: z.array(FormationLineSchema).max(7).optional(),
  kinds: z.array(EntityIdSchema).max(6).optional(),
}).strict().meta({ id: "Doctrine" });

/**
 * A power's armies remade by law: ways of war taken up or given up, whom it
 * calls to its standards (`recruit`), kept under them (`standing`), armed by
 * the state (`stateArms`), for how many campaigns, owed what at the end, and a
 * body redrawn -- the maniples into cohorts. Existing formations are refitted
 * over months; new levies come in the new form. Kept compact: it is sent with
 * every order.
 */
export const MilitaryReformSchema = z.object({
  adopt: z.array(DoctrineProposalSchema).max(4).optional(),
  /** Doctrines given up, by id. */
  drop: z.array(EntityIdSchema).max(6).optional(),
  recruit: z.enum(["property_class", "citizens", "settlers", "volunteers", "mercenary", "subject_levy"]).optional(),
  standing: z.boolean().optional(),
  stateArms: z.boolean().optional(),
  /** Campaigns a foot soldier owes; the horse owe five in eight of it. */
  campaigns: z.number().int().min(1).max(40).optional(),
  discharge: z.enum(["none", "cash", "land"]).optional(),
  /** One kind of body redrawn: its formations replaced by these, in units of "size" men. */
  redraw: z.object({
    bodyId: EntityIdSchema,
    formations: z.array(z.object({
      label: z.string().trim().min(1).max(80),
      kind: EntityIdSchema,
      line: FormationLineSchema,
      men: z.number().int().positive().max(100_000),
      unit: z.string().trim().min(1).max(40),
      size: z.number().int().positive().max(10_000),
    }).strict()).min(1).max(8),
  }).strict().optional(),
}).strict();

export type DoctrineProposal = z.infer<typeof DoctrineProposalSchema>;
export type MilitaryReform = z.infer<typeof MilitaryReformSchema>;

// ── What each band is worth ──────────────────────────────────────────────

const POINTS: Record<EffectBand, number> = { slight: 1, marked: 2, great: 3 };

/**
 * Basis points (or shares) per band, per lever. Combat levers are basis
 * points of strength or of cohesion protection; the rest are shares.
 */
export const LEVER_WORTH: Readonly<Record<DoctrineLever, Readonly<Record<EffectBand, number>>>> = {
  frontal_weight: { slight: 400, marked: 900, great: 1_500 },
  steadiness: { slight: 500, marked: 1_000, great: 1_600 },
  line_relief: { slight: 800, marked: 1_500, great: 2_200 },
  rough_ground: { slight: 300, marked: 700, great: 1_200 },
  screen: { slight: 200, marked: 500, great: 800 },
  pursuit: { slight: 2_500, marked: 5_000, great: 8_000 },
  boarding: { slight: 500, marked: 1_200, great: 2_000 },
  siege_craft: { slight: 0.15, marked: 0.3, great: 0.5 },
  march_speed: { slight: 0.1, marked: 0.2, great: 0.35 },
  supply_need: { slight: 0.1, marked: 0.2, great: 0.35 },
  drill_ceiling: { slight: 800, marked: 1_600, great: 2_600 },
  drill_rate: { slight: 0.25, marked: 0.5, great: 1 },
  muster_speed: { slight: 0.25, marked: 0.5, great: 1 },
  levy_cost: { slight: 0.15, marked: 0.3, great: 0.6 },
  manpower_basis: { slight: 0.1, marked: 0.25, great: 0.5 },
  service_length: { slight: 2, marked: 4, great: 8 },
  loyalty_to_general: { slight: 0.2, marked: 0.4, great: 0.6 },
  veteran_claim: { slight: 500, marked: 1_200, great: 2_500 },
  pay_discipline: { slight: 1, marked: 1, great: 2 },
};

/** Signed worth of one effect. */
export function effectValue(effect: DoctrineEffect): number {
  const worth = LEVER_WORTH[effect.lever][effect.band];
  return effect.direction === "lower" ? -worth : worth;
}

/**
 * Whether a lever going up is good for the army that has it. Most are;
 * `levy_cost` going up is a price, and `veteran_claim` going up is a
 * promise the state will have to keep.
 */
const RAISE_IS_A_COST: ReadonlySet<DoctrineLever> = new Set(["levy_cost", "veteran_claim", "service_length", "loyalty_to_general"]);

/**
 * What a doctrine gives against what it takes, in band points: a raise of a
 * good thing is a gain, a lower of one a cost, and the other way about for the
 * levers that are prices. Never negative: a doctrine that costs more than it
 * gives is paid for already.
 */
export function doctrineNetGain(effects: readonly DoctrineEffect[]): number {
  let net = 0;
  for (const effect of effects) {
    const points = POINTS[effect.band];
    const good = (effect.direction === "raise") !== RAISE_IS_A_COST.has(effect.lever);
    net += good ? points : -points;
  }
  return Math.max(0, net);
}

/** What a doctrine's keep costs a month, per thousand men it covers: two for every point it gains on what it gives up. */
export const DOCTRINE_UPKEEP_PER_THOUSAND_PER_POINT = 2;

/** How long a formation takes to be refitted to a new way of fighting. */
export function refitDaysFor(effects: readonly DoctrineEffect[]): number {
  const points = effects.reduce((sum, effect) => sum + POINTS[effect.band], 0);
  return Math.max(20, Math.min(180, points * 20));
}

/**
 * The edge cap: what doctrine, drill and experience together may add to a
 * formation's worth per man in the field, and to its protection from breaking.
 * A world cannot win by stacking doctrines; it can win by being better.
 */
export const STRENGTH_EDGE_CAP_BPS = 2_500;
export const STRENGTH_EDGE_FLOOR_BPS = -2_500;
export const COHESION_PROTECTION_CAP_BPS = 3_000;

/** What full drill and full experience are worth per man, before the cap. */
export const TRAINING_STRENGTH_BPS = 1_500;
export const EXPERIENCE_STRENGTH_BPS = 1_500;
export const TRAINING_STEADINESS_BPS = 800;
export const EXPERIENCE_STEADINESS_BPS = 1_200;

/** How good drill alone can make men, without a doctrine that raises the ceiling. */
export const BASE_DRILL_CEILING_BPS = 5_000;

/** Training and experience in words, the way an officer would say it. */
export function qualityInWords(trainingBps: number, experienceBps: number): string {
  const score = trainingBps * 0.5 + experienceBps * 0.5;
  if (experienceBps >= 7_000) return "old soldiers";
  if (score >= 5_500) return "veterans";
  if (score >= 3_500) return "steady";
  if (score >= 1_800) return "trained";
  return "raw";
}
