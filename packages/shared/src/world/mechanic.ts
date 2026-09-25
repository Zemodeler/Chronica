import { z } from "zod";
import { RelationDimensionSchema } from "../characters/character";
import { stableHash } from "../determinism";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema, MoneyAmountSchema, ProvinceLevelSchema, SignedScoreSchema } from "../material-state";
import { OrderPartyRefSchema } from "./party-ref";
import { EFFECT_PERIOD_DAYS, EffectBandSchema } from "./standing-effects";
import { WATCH_ARMS } from "./watch";

/**
 * A mechanic: a rule the world writes once and the engine runs for ever.
 *
 * VISION §1 says the world can "dynamically create mechanics or entities when
 * the evolving world requires them". It could create entities. An act that
 * fitted no op was kept as an arrangement whose effects came from a closed
 * list of ten quantities, and a pursuit did nothing at all: the world
 * remembered that the toll-house was built and nothing was ever tolled.
 *
 * A mechanic hangs off the arrangement (`GenericEntity.mechanic`) rather than
 * being a thing beside it: the arrangement already has an owner, a province,
 * a keep and two ways to end, and retiring or lapsing it ends the rule for
 * free. The rule itself is data -- a trigger, conditions, effects, an end, a
 * price -- in a closed language the engine can validate, clamp and run with
 * no model involved: every effect is one of five ops the applier already
 * runs, every amount is a band or a share of a value the engine can read, and
 * every condition is a predicate the watch evaluator already reads.
 *
 * Written by one small model call (`sim/mechanics/write-mechanic.ts`), never
 * by the orchestrator: the orchestrator's prompt does not grow by a character
 * for any of this.
 */

/**
 * The arms a mechanic may test, beyond the watch's own.
 *
 * All plain states, read as "yes" or "no", so a trigger on one fires only on
 * the edge from no to yes -- the guard every watch arm has to keep by hand is
 * kept here by construction. There is no month-of-year arm: the evaluator has
 * no clock, and a calendar is scenario data; `monthly` and a term cover what a
 * season would.
 */
export const MECHANIC_ARMS = [
  z.object({ kind: z.literal("province_level_above"), provinceId: EntityIdSchema, level: ProvinceLevelSchema, bps: BasisPointsSchema }).strict(),
  z.object({ kind: z.literal("province_level_below"), provinceId: EntityIdSchema, level: ProvinceLevelSchema, bps: BasisPointsSchema }).strict(),
  /** The mirror of the watch's `account_below`. */
  z.object({ kind: z.literal("account_above"), accountId: EntityIdSchema, amount: MoneyAmountSchema }).strict(),
  z.object({ kind: z.literal("relation_above"), subjectCharacterId: EntityIdSchema, targetCharacterId: EntityIdSchema, dimension: RelationDimensionSchema, score: SignedScoreSchema }).strict(),
  z.object({ kind: z.literal("relation_below"), subjectCharacterId: EntityIdSchema, targetCharacterId: EntityIdSchema, dimension: RelationDimensionSchema, score: SignedScoreSchema }).strict(),
  z.object({ kind: z.literal("polity_trust_above"), polityId: EntityIdSchema, towardPolityId: EntityIdSchema, score: SignedScoreSchema }).strict(),
  z.object({ kind: z.literal("polity_trust_below"), polityId: EntityIdSchema, towardPolityId: EntityIdSchema, score: SignedScoreSchema }).strict(),
  z.object({ kind: z.literal("at_war"), polityId: EntityIdSchema, otherPolityId: EntityIdSchema, atWar: z.boolean() }).strict(),
  /** The mirror of the watch's `force_strength_below`. */
  z.object({ kind: z.literal("force_strength_above"), forceId: EntityIdSchema, headcount: z.number().int().nonnegative() }).strict(),
] as const;

/** One predicate language: everything a watch can test, and everything a mechanic can. `sim/watch.ts` reads both. */
export const MechanicPredicateSchema = z.discriminatedUnion("kind", [...WATCH_ARMS, ...MECHANIC_ARMS]).meta({ id: "MechanicPredicate" });
export type MechanicPredicate = z.infer<typeof MechanicPredicateSchema>;

/** A value the engine can read a share of. */
export const ReadableValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account_balance"), accountId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("province_tax_capacity"), provinceId: EntityIdSchema }).strict(),
]);
export type ReadableValue = z.infer<typeof ReadableValueSchema>;

/**
 * How a sum is written: never a bare number the model chose without a cap.
 * A band is of the mechanic's own scale (its province's monthly tax
 * capacity); a share is of a value the engine reads at the moment of firing;
 * a fixed sum is clamped like a share of the scale.
 */
export const MechanicAmountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("band"), band: EffectBandSchema }).strict(),
  z.object({ kind: z.literal("share"), bps: z.number().int().min(1).max(10_000), of: ReadableValueSchema }).strict(),
  z.object({ kind: z.literal("fixed"), amount: MoneyAmountSchema.min(1) }).strict(),
]);
export type MechanicAmount = z.infer<typeof MechanicAmountSchema>;

const DirectionSchema = z.enum(["raise", "lower"]);

/**
 * What a firing may do: templates over ops the applier already runs. No
 * force ops (men die in battles, not in side doors), nothing that creates,
 * and no income from the outside world -- that is the arrangement's own
 * `income` standing effect, already priced.
 */
export const MechanicEffectSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("money_transfer"), fromAccountId: EntityIdSchema, toAccountId: EntityIdSchema.nullable(), amount: MechanicAmountSchema }).strict(),
  z.object({
    op: z.literal("province_material_shift"), provinceId: EntityIdSchema,
    quantity: z.enum(["stability", "food_security", "productive_capacity", "war_damage", "available_manpower"]),
    direction: DirectionSchema, band: EffectBandSchema,
  }).strict(),
  z.object({ op: z.literal("legitimacy_shift"), polityId: EntityIdSchema, direction: DirectionSchema, band: EffectBandSchema }).strict(),
  z.object({ op: z.literal("polity_stance_shift"), polityId: EntityIdSchema, towardPolityId: EntityIdSchema, direction: DirectionSchema, band: EffectBandSchema }).strict(),
  /** Instantiated as one `social_events` relation cause. */
  z.object({
    op: z.literal("relation_shift"), subjectCharacterId: EntityIdSchema, targetCharacterId: EntityIdSchema,
    dimension: RelationDimensionSchema, direction: DirectionSchema, band: EffectBandSchema,
  }).strict(),
]);
export type MechanicEffect = z.infer<typeof MechanicEffectSchema>;

export const MechanicTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("monthly") }).strict(),
  /** A fact of this kind, touching this party (or anybody, when null), recorded since the rule last looked. */
  z.object({
    kind: z.literal("on_fact"),
    factKind: z.string().trim().min(1).max(80).refine((factKind) => !factKind.startsWith("mechanic_"), "a rule cannot fire on its own firings"),
    subjectRef: OrderPartyRefSchema.nullable().default(null),
  }).strict(),
  /** The first time a condition becomes true, and again each time it becomes true anew. */
  z.object({ kind: z.literal("when"), predicate: MechanicPredicateSchema }).strict(),
]);
export type MechanicTrigger = z.infer<typeof MechanicTriggerSchema>;

export const MechanicEndSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("never") }).strict(),
  z.object({ kind: z.literal("term"), days: z.number().int().min(EFFECT_PERIOD_DAYS).max(3_660) }).strict(),
  z.object({ kind: z.literal("when"), predicate: MechanicPredicateSchema }).strict(),
  z.object({ kind: z.literal("owner_death") }).strict(),
]);
export type MechanicEnd = z.infer<typeof MechanicEndSchema>;

/** What the writer returns: the rule, with no engine bookkeeping in it. */
export const MechanicDraftSchema = z.object({
  trigger: MechanicTriggerSchema,
  conditions: z.array(MechanicPredicateSchema).max(3).default([]),
  effects: z.array(MechanicEffectSchema).min(1).max(4),
  end: MechanicEndSchema,
  /** Named in money; the engine clamps both into bands of the province (`sim/mechanics/price-mechanic.ts`). */
  price: z.object({ setup: MoneyAmountSchema, upkeepPerMonth: MoneyAmountSchema }).strict(),
  /** One sentence on why it fires and why it stops. Shown back; never parsed. */
  why: z.string().trim().min(1).max(300),
}).strict();
export type MechanicDraft = z.infer<typeof MechanicDraftSchema>;

/**
 * Why a rule may take money from an account its owner does not control.
 *
 * Found once, when the rule is attached, from what stands in the world then:
 * the owner's authority over a treasury, an agreement or contract the payer
 * consented to, or the payer being the owner. Stored on the rule, checked
 * again at every firing, and never inferred from the rule's own text.
 */
export const DebitWarrantSchema = z.object({
  accountId: EntityIdSchema,
  basis: z.enum(["authority", "consent", "owner"]),
  /** The office, agreement or contract the warrant rests on; null for the owner's own purse. */
  refId: z.string().min(1).max(120).nullable(),
}).strict();
export type DebitWarrant = z.infer<typeof DebitWarrantSchema>;

export const MechanicSchema = MechanicDraftSchema.extend({
  attachedAtStep: ElapsedStepSchema,
  /** Written by the model for this arrangement, or cut from a shape an earlier one left. */
  origin: z.enum(["written"]),
  /** What the rule does, abstracted from whom it does it to (`stableKey`). */
  shapeKey: z.string().min(1).max(40),
  debitWarrants: z.array(DebitWarrantSchema).max(8).default([]),
  /** `monthly`: the next day it is due. Set a period after attaching, so nothing fires at once. */
  nextDueStep: ElapsedStepSchema.nullable().default(null),
  /** `when` trigger and `when` end: what each read when last looked at (the contingency pattern). */
  armedReading: z.string().min(1).max(120).nullable().default(null),
  endArmedReading: z.string().min(1).max(120).nullable().default(null),
  endsAtStep: ElapsedStepSchema.nullable().default(null),
  setupPaid: MoneyAmountSchema.default(0),
  firedCount: z.number().int().nonnegative().default(0),
  /** Firings in which at least one effect was carried out: what "changes a number" means. */
  changedCount: z.number().int().nonnegative().default(0),
  lastFiredStep: ElapsedStepSchema.nullable().default(null),
  /** Consecutive firings in which every effect was refused. Retired at `MECHANIC_MAX_EMPTY_FIRINGS`. */
  emptyFirings: z.number().int().nonnegative().default(0),
  endedAtStep: ElapsedStepSchema.nullable().default(null),
  endedReason: z.string().max(200).nullable().default(null),
}).strict();
export type Mechanic = z.infer<typeof MechanicSchema>;

/** A rule that fires and does nothing this many times running is retired. */
export const MECHANIC_MAX_EMPTY_FIRINGS = 3;
/** A `monthly` rule catches up at most this many periods in one run, as the tick does. */
export const MECHANIC_MAX_PERIODS_PER_RUN = 24;
/** No rule fires more often than this in one run, whatever its trigger. */
export const MECHANIC_MAX_FIRINGS_PER_RUN = 8;
/** Of a purse's balance, per firing. */
export const MECHANIC_PURSE_DEBIT_MAX_BPS = 1_000;
/** Of a purse's balance at the start of a burst, by all rules together, in that burst. */
export const MECHANIC_MAX_DEBIT_PER_BURST_BPS = 1_500;
/** Of the scale, per money effect per firing: the venture and project ceiling family. */
export const MECHANIC_MONEY_MAX_SHARE = 0.15;
/** Setup is clamped between these shares of the scale: a great venture costs about a quarter of one. */
export const MECHANIC_SETUP_MIN_SHARE = 0.05;
export const MECHANIC_SETUP_MAX_SHARE = 0.5;
/**
 * A private person's rule is measured at a tenth of the province: the scale a
 * venture is already priced by (`VENTURE_RETURN_SHARE` is a tenth of an
 * arrangement's income bands). At the province's own scale a stall's keep was
 * four hundred a month and every private rule the corpus wrote lapsed within
 * one, unpaid.
 */
export const MECHANIC_PRIVATE_SCALE_SHARE = 0.1;

/** What a band is worth, per firing, for each effect the rule may have. */
export const mechanicWorth = {
  /** Of the scale. The same shares as an arrangement's income bands. */
  moneyShare: { slight: 0.03, marked: 0.08, great: 0.15 } as const,
  /** A bump the province's recovery pulls back; a fifth of a standing effect's baseline shift, so twelve firings are about one "great". */
  provinceBps: { slight: 100, marked: 250, great: 500 } as const,
  /** Of the province's population. */
  manpowerShare: { slight: 0.005, marked: 0.01, great: 0.02 } as const,
  legitimacyBps: { slight: 50, marked: 150, great: 300 } as const,
  trust: { slight: 2, marked: 5, great: 10 } as const,
  /** Within `relationCauses`' own ±20. */
  relation: { slight: 3, marked: 8, great: 15 } as const,
  relationDecayPerYearBps: 5_000,
} as const;

/**
 * What the rule does, without whom it does it to: trigger and end kinds, the
 * condition arms, and each effect's op, quantity and how its amount is written.
 */
export function stableKey(draft: MechanicDraft): string {
  const parts: (string | number)[] = [
    draft.trigger.kind,
    draft.trigger.kind === "on_fact" ? draft.trigger.factKind : draft.trigger.kind === "when" ? draft.trigger.predicate.kind : "",
    ...[...draft.conditions.map((condition) => condition.kind)].sort(),
    ...draft.effects.map((effect) => {
      const quantity = "quantity" in effect ? effect.quantity : "dimension" in effect ? effect.dimension : "";
      const direction = "direction" in effect ? effect.direction : "";
      const amount = effect.op === "money_transfer" ? effect.amount.kind : "band" in effect ? effect.band : "";
      return `${effect.op}/${quantity}/${direction}/${amount}`;
    }),
    draft.end.kind,
    draft.end.kind === "when" ? draft.end.predicate.kind : "",
  ];
  return stableHash(parts).toString(16).padStart(8, "0");
}
