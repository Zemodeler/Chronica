import { z } from "zod";
import { EntityIdSchema } from "../material-state";

/**
 * What a made thing goes on doing.
 *
 * The world could make anything -- a temple, an academy, a law, an aqueduct,
 * a guild -- and almost nothing it made did anything afterwards. A structure
 * a project finished was `kind: "other"` with no effect of any kind, so a
 * fortress built in play defended nobody; an arrangement was a record whose
 * effects the model was told to carry out "each period it matters", which it
 * could not, having no memory of periods. Only armies, money, ground and
 * people kept acting on the world by themselves.
 *
 * This is the rest of it, on the pattern troop kinds and positions already
 * use: the nouns are open, the verbs are closed. Anybody may make anything and
 * call it whatever they like; what it *does* is chosen from a short list of
 * quantities the engine already simulates, in words -- slight, marked, great
 * -- and the engine decides what each word is worth, applies it every month,
 * charges for its upkeep, and stops it when the upkeep stops. A model allowed
 * to write the number would write it high.
 *
 * - `stability`, `food_security`, `productive_capacity`: where the province
 *   settles back to. Levels, not bumps: a temple does not make a province
 *   calmer every month forever, it makes it a calmer place.
 * - `manpower`: how many of its people can be called up.
 * - `legitimacy`: how the owning power is regarded, while the thing stands.
 * - `income`: money into its owner's account each month, scaled to what the
 *   province can yield, so the same word means the same thing in every
 *   scenario's economy.
 * - `recruit_skill`: how good the people raised there are -- the academy.
 * - `defense`, `supply`: what a structure is worth to the men holding it.
 * - `conversion`: the named faith gains believers there each month.
 */
export const StandingEffectQuantitySchema = z.enum([
  "stability",
  "food_security",
  "productive_capacity",
  "manpower",
  "legitimacy",
  "income",
  "recruit_skill",
  "defense",
  "supply",
  "conversion",
]);
export type StandingEffectQuantity = z.infer<typeof StandingEffectQuantitySchema>;

export const EffectBandSchema = z.enum(["slight", "marked", "great"]);
export type EffectBand = z.infer<typeof EffectBandSchema>;

export const StandingEffectSchema = z
  .object({
    quantity: StandingEffectQuantitySchema,
    direction: z.enum(["raise", "lower"]).default("raise"),
    band: EffectBandSchema.default("slight"),
    /** Where it acts: the province the thing stands in, or every province its owner holds. */
    scope: z.enum(["here", "realm"]).default("here"),
    /** For `conversion`: the faith, by name. One nobody has heard of is founded. */
    faith: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  // Named once in the orchestrator's schema and pointed at from every place a
  // thing can be made, rather than inlined at each.
  .meta({ id: "StandingEffect" });
export type StandingEffect = z.infer<typeof StandingEffectSchema>;

/** Who pays to keep it going, and roughly how much. Null for a thing that costs nothing to keep. */
export const StandingUpkeepSchema = z
  .object({ fromAccountId: EntityIdSchema, band: EffectBandSchema })
  .strict();
export type StandingUpkeep = z.infer<typeof StandingUpkeepSchema>;

/** The fields every carrier of standing effects shares. Optional, so every snapshot and fixture before this parses. */
export const StandingEffectsCarrierShape = {
  effects: z.array(StandingEffectSchema).max(6).optional(),
  upkeep: StandingUpkeepSchema.nullable().optional(),
  /** The last day its month was settled. Absent until it has come into force. */
  effectsSettledThroughStep: z.number().int().nonnegative().nullable().optional(),
  /** The day it stopped, for want of upkeep. Absent while it stands. */
  lapsedAtStep: z.number().int().nonnegative().nullable().optional(),
};

/** How long a month is, for settling. */
export const EFFECT_PERIOD_DAYS = 30;

const SIGN = { raise: 1, lower: -1 } as const;

/** Where a province settles back to, shifted by this many basis points. */
const BASELINE_SHIFT_BPS: Record<EffectBand, number> = { slight: 500, marked: 1_200, great: 2_500 };
/** Share of the province's people who can be called up, as a multiplier on the ordinary share. */
const MANPOWER_SHIFT: Record<EffectBand, number> = { slight: 0.1, marked: 0.25, great: 0.5 };
/** Once, while it stands, on the owner's legitimacy. */
const LEGITIMACY_BPS: Record<EffectBand, number> = { slight: 200, marked: 500, great: 1_000 };
/** Of the province's tax capacity, each month. */
export const INCOME_SHARE: Record<EffectBand, number> = { slight: 0.03, marked: 0.08, great: 0.15 };
/** Of the province's tax capacity, each month. Cheaper than what a thing yields, dearer than nothing. */
export const UPKEEP_SHARE: Record<EffectBand, number> = { slight: 0.02, marked: 0.05, great: 0.1 };
/** Added to the skills of people made there. */
const RECRUIT_SKILL: Record<EffectBand, number> = { slight: 5, marked: 10, great: 15 };
/** The same scale the resolver already uses for walls and passes. */
const DEFENSE_BPS: Record<EffectBand, number> = { slight: 500, marked: 1_200, great: 2_000 };
const SUPPLY_RADIUS: Record<EffectBand, number> = { slight: 0, marked: 1, great: 2 };
/** Believers gained each month, in basis points of the province. */
const CONVERSION_BPS: Record<EffectBand, number> = { slight: 100, marked: 250, great: 500 };

export const effectWorth = {
  baselineShiftBps: (effect: StandingEffect): number => SIGN[effect.direction] * BASELINE_SHIFT_BPS[effect.band],
  manpowerShift: (effect: StandingEffect): number => SIGN[effect.direction] * MANPOWER_SHIFT[effect.band],
  legitimacyBps: (effect: StandingEffect): number => SIGN[effect.direction] * LEGITIMACY_BPS[effect.band],
  incomeShare: (effect: StandingEffect): number => SIGN[effect.direction] * INCOME_SHARE[effect.band],
  upkeepShare: (band: EffectBand): number => UPKEEP_SHARE[band],
  recruitSkill: (effect: StandingEffect): number => SIGN[effect.direction] * RECRUIT_SKILL[effect.band],
  defenseBps: (effect: StandingEffect): number => (effect.direction === "raise" ? DEFENSE_BPS[effect.band] : 0),
  supplyRadius: (effect: StandingEffect): number => (effect.direction === "raise" ? SUPPLY_RADIUS[effect.band] : 0),
  conversionBps: (effect: StandingEffect): number => (effect.direction === "raise" ? CONVERSION_BPS[effect.band] : 0),
};

/**
 * What a kind of building does when nobody said.
 *
 * A fortress defends and an academy trains whether or not the order that
 * built them spelled it out; a model that writes "build a fortress" and no
 * effects has still built a fortress.
 */
export const DEFAULT_STRUCTURE_EFFECTS: Record<string, readonly StandingEffect[]> = {
  fortress: [{ quantity: "defense", direction: "raise", band: "marked", scope: "here" }],
  wall: [{ quantity: "defense", direction: "raise", band: "slight", scope: "here" }],
  watchtower: [{ quantity: "defense", direction: "raise", band: "slight", scope: "here" }],
  depot: [{ quantity: "supply", direction: "raise", band: "marked", scope: "here" }],
  academy_building: [{ quantity: "recruit_skill", direction: "raise", band: "marked", scope: "here" }],
  temple: [{ quantity: "stability", direction: "raise", band: "slight", scope: "here" }],
  market: [{ quantity: "income", direction: "raise", band: "slight", scope: "here" }],
  monument: [{ quantity: "legitimacy", direction: "raise", band: "slight", scope: "here" }],
  other: [],
};

/** A standing effect in words, for the world slice and the Chronicle. */
export function effectInWords(effect: StandingEffect): string {
  const how = effect.direction === "raise" ? "raises" : "lowers";
  const where = effect.scope === "realm" ? " across the realm" : "";
  const what = effect.quantity === "conversion" ? `believers in ${effect.faith ?? "its faith"}` : effect.quantity.replace(/_/g, " ");
  return `${how} ${what} (${effect.band})${where}`;
}
