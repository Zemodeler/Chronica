import { z } from "zod";

/**
 * What a person of this standing is actually worth (slice 11).
 *
 * The declaration prompt asks for `socioEconomicClass` and `startingMoney` in
 * the same breath and then believes whatever comes back. So a player who
 * declared himself a common soldier could be handed a senator's fortune, and
 * a merchant invented to lend the state money could be worth four coins --
 * which is the bug that put `wealth` on `character_create` in the first place,
 * solved in one direction and left open in the other.
 *
 * Bands are scenario data, because what a sum means is a property of a
 * currency and an economy that no engine can know. What the engine owns is the
 * rule: **clamp, never reject.** A model's judgment inside a band is worth
 * keeping -- a rich merchant and a poor one are both merchants -- and throwing
 * the whole declaration away over a number would cost the player their
 * character for the engine's convenience.
 */

export const WealthBandSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    label: z.string().trim().min(1).max(80),
    /** Any of these words in the stated standing puts a person in this band. */
    words: z.array(z.string().trim().min(1).max(40)).max(24),
    min: z.number().int().min(0),
    max: z.number().int().min(0),
  })
  .strict()
  .superRefine((band, context) => {
    if (band.max < band.min) {
      context.addIssue({ code: "custom", path: ["max"], message: "A wealth band's ceiling must be at or above its floor." });
    }
  });
export type WealthBand = z.infer<typeof WealthBandSchema>;

export const ScenarioWealthRulesSchema = z
  .object({
    bands: z.array(WealthBandSchema).max(12).default([]),
    /** Where somebody whose standing matches nothing lands. */
    defaultBandId: z.string().trim().min(1).max(60).nullable().default(null),
  })
  .strict();
export type ScenarioWealthRules = z.infer<typeof ScenarioWealthRulesSchema>;

/**
 * What a scenario that authors none gets.
 *
 * Deliberately coarse and deliberately overridable: four bands spanning three
 * orders of magnitude, in the units this codebase's scenarios already use. The
 * codebase has a standing objection to hardcoded assumptions about a
 * government or an economy, and this is one -- shipped because the alternative
 * is that every scenario that has not got round to authoring bands goes on
 * believing whatever a model says.
 */
export const DEFAULT_WEALTH_BANDS: readonly WealthBand[] = [
  {
    id: "poor", label: "a man with his hands and little else",
    words: ["poor", "labourer", "laborer", "peasant", "farmer", "slave", "freedman", "servant", "soldier", "legionary", "ranker", "sailor", "rower", "shepherd", "artisan", "craftsman", "smith"],
    min: 0, max: 60,
  },
  {
    id: "middling", label: "a household of some standing",
    words: ["citizen", "plebeian", "plebian", "commoner", "veteran", "centurion", "trader", "shopkeeper", "scribe", "clerk", "priest", "physician", "teacher", "yeoman", "burgher"],
    min: 20, max: 400,
  },
  {
    id: "substantial", label: "money enough to be courted for it",
    words: ["merchant", "shipowner", "equestrian", "equites", "eques", "knight", "landowner", "banker", "financier", "publican", "magistrate", "officer", "tribune", "decurion"],
    min: 200, max: 3_000,
  },
  {
    id: "great", label: "a fortune that is itself a kind of office",
    words: ["patrician", "senatorial", "senator", "aristocracy", "aristocrat", "noble", "nobility", "consul", "king", "queen", "prince", "royal", "dynast", "tyrant", "suffete", "magnate"],
    min: 1_000, max: 40_000,
  },
];

const words = (value: string): Set<string> =>
  new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2));

/**
 * The band this standing falls in.
 *
 * The richest matching band wins, because a stated standing is usually a
 * phrase rather than a word -- "an equestrian of senatorial family" is a
 * senator's household, and taking the first match would make him a merchant.
 */
export function bandFor(
  socioEconomicClass: string | null,
  rules: ScenarioWealthRules | undefined = undefined,
): WealthBand | undefined {
  const bands = rules?.bands !== undefined && rules.bands.length > 0 ? rules.bands : DEFAULT_WEALTH_BANDS;
  if (socioEconomicClass !== null && socioEconomicClass.trim().length > 0) {
    const tokens = words(socioEconomicClass);
    const matched = bands.filter((band) => band.words.some((word) => tokens.has(word)));
    if (matched.length > 0) return matched.reduce((richest, band) => (band.max > richest.max ? band : richest));
  }
  const fallbackId = rules?.defaultBandId ?? null;
  if (fallbackId !== null) {
    const named = bands.find((band) => band.id === fallbackId);
    if (named !== undefined) return named;
  }
  return undefined;
}

/**
 * The stated sum, brought inside what that standing can plausibly be worth.
 *
 * Returns the sum unchanged where nothing matches: an unrecognised standing is
 * not a licence to invent, but it is not grounds to overrule the model either.
 */
export function clampWealth(
  amount: number,
  socioEconomicClass: string | null,
  rules: ScenarioWealthRules | undefined = undefined,
): number {
  const band = bandFor(socioEconomicClass, rules);
  if (band === undefined) return Math.max(0, Math.round(amount));
  return Math.max(band.min, Math.min(band.max, Math.max(0, Math.round(amount))));
}

/** The bands in words, for the prompt that is being asked to stay inside them. */
export function describeWealthBands(rules: ScenarioWealthRules | undefined = undefined): string[] {
  const bands = rules?.bands !== undefined && rules.bands.length > 0 ? rules.bands : DEFAULT_WEALTH_BANDS;
  return bands.map((band) => `${band.label}: ${band.min}–${band.max}. Such a person is ${band.words.slice(0, 6).join(", ")}.`);
}
