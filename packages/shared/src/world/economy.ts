import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, MAX_TAX_RATE_BPS, TaxRegimeSchema } from "../material-state";
import { GOODS, MAX_MARKET_HUBS, MarketHubSchema, goodSpec, marketPriceBps, openingMarkets, type GoodId } from "./markets";
import { provinceOf } from "./movement";
import type { WorldState } from "./world-state";

/**
 * What the world remembers of its own seasons, its bargains and its troubles.
 *
 * The land did nothing by itself: a province's people never grew or starved,
 * the harvest was a card the narrator might draw, a tributary paid nothing, an
 * ally never came, and a province could sit in misery for ten years without
 * anybody rising. The engine now does all of that on the calendar
 * (`sim/economy.ts`, `sim/treaties.ts`, `sim/unrest.ts`), and this is the
 * little it has to remember from one month to the next to do each thing once.
 *
 * Optional on the world, so every snapshot written before it still loads; a
 * world without one has simply never been reviewed.
 */
/** No power lays more than this on a good entering its markets: past it nothing would come. */
export const MAX_CUSTOMS_RATE_BPS = 5_000;

export const EconomyMemorySchema = z
  .object({
    /** The last day the land was reckoned: its people, its taxes, its migrants. */
    lastReviewStep: ElapsedStepSchema.nullable().default(null),
    /** The last year (astronomical) whose harvest came in. */
    lastHarvestYear: z.number().int().nullable().default(null),
    /** Months each province has spent in misery, while it lasts: what a rising is made of. */
    unrest: z.array(z.object({ provinceId: EntityIdSchema, months: z.number().int().nonnegative() }).strict()).max(800).default([]),
    /** Tribute and indemnities already declared broken, so a breach is news once. */
    breachedObligationIds: z.array(EntityIdSchema).max(400).default([]),
    /** Wars already weighed for a peace they broke and for the allies they call. */
    reviewedWarIds: z.array(EntityIdSchema).max(400).default([]),
    /** The day treaties were first kept: the wars standing then were the world's before play, and call nobody. */
    treatiesKeptSince: ElapsedStepSchema.nullable().default(null),
    /** One power's quarrel with another it may make war over: a broken treaty, a deserted alliance. */
    grievances: z.array(z.object({
      polityId: EntityIdSchema,
      againstPolityId: EntityIdSchema,
      reason: z.string().trim().min(1).max(240),
      sinceStep: ElapsedStepSchema,
    }).strict()).max(200).default([]),
    /** A call to arms the player's own power has not yet answered, and the day it must. */
    pendingCalls: z.array(z.object({
      warId: EntityIdSchema,
      allyPolityId: EntityIdSchema,
      callerPolityId: EntityIdSchema,
      enemyPolityId: EntityIdSchema,
      dueStep: ElapsedStepSchema,
    }).strict()).max(40).default([]),
    /**
     * The day each ally bound by foedus last sent its leader a contingent. The
     * treaty owes men once a campaigning season, however many wars the leader
     * is in: Rome's Apulians and Umbrians marched for the war with Syracuse
     * and were levied again a month later for the war with Carthage.
     */
    contingentsSent: z.array(z.object({ polityId: EntityIdSchema, atStep: ElapsedStepSchema }).strict()).max(200).default([]),
    /** Civil wars: the faction a general made of his army, what it broke from, and when it began -- or was made up. */
    civilWars: z.array(z.object({
      rebelPolityId: EntityIdSchema,
      fromPolityId: EntityIdSchema,
      leaderCharacterId: EntityIdSchema,
      sinceStep: ElapsedStepSchema,
    }).strict()).max(60).default([]),
    /**
     * How each power taxes its provinces unless a province has its own word
     * (`ProvinceMaterial.taxRegime`): the regime and the share taken. Kept
     * here and not on the rows because it is one line a power, where the rows
     * are six thousand. A power with no line taxes as it always did.
     */
    taxPolicies: z.array(z.object({
      polityId: EntityIdSchema,
      regime: TaxRegimeSchema,
      rateBps: z.number().int().min(0).max(MAX_TAX_RATE_BPS),
    }).strict()).max(200).default([]),
    /**
     * When a power last heard that its countryside lies waste, and of how many
     * districts, so the news comes once a war and not once a month: again only
     * when more of its ground has been laid waste, and never within two years.
     */
    wasteNews: z.array(z.object({ polityId: EntityIdSchema, atStep: ElapsedStepSchema, districts: z.number().int().nonnegative().default(0) }).strict()).max(200).default([]),
    /**
     * The markets: for each hub (some sixty on the Punic map), the stock, the
     * target and the price of each of six goods (`world/markets.ts`). Empty
     * until the land is first reckoned, when they open with a season's
     * reserve (`ensureMarkets`); which provinces trade in which hub is
     * geography, derived from the map and not stored.
     */
    markets: z.array(MarketHubSchema).max(MAX_MARKET_HUBS).default([]),
    /** When a power last heard that grain had gone far too dear or too cheap in its country, so the news is told once a year and not once a month. */
    marketNews: z.array(z.object({ polityId: EntityIdSchema, kind: z.enum(["shortage", "glut"]), atStep: ElapsedStepSchema }).strict()).max(200).default([]),
    /**
     * The customs each power lays on goods that enter its markets from another
     * power's, in basis points of their value (`world/trade.ts`). A power with
     * no line lays none. Set by `tax_policy_set` with the `customs` scope; a
     * trade pact may cap what is charged on its partner's goods.
     */
    customsRates: z.array(z.object({ polityId: EntityIdSchema, rateBps: z.number().int().min(0).max(MAX_CUSTOMS_RATE_BPS) }).strict()).max(200).default([]),
    /**
     * Customs the month's trade flows have earned each power and not yet paid
     * into its treasury (drachmae). The monthly pass of the markets accrues it
     * and the tick pays it out the same day (`sim/customs.ts`), so a world run
     * without the tick (the tests' bare months) simply holds it here.
     */
    customsDue: z.array(z.object({ polityId: EntityIdSchema, amount: z.number().int().nonnegative() }).strict()).max(200).default([]),
    /** Which powers' hubs traded most with which last month, by value in drachmae: what a ruler's slice reads. Capped, largest first. */
    tradeLanes: z.array(z.object({ fromPolityId: EntityIdSchema, toPolityId: EntityIdSchema, value: z.number().int().nonnegative() }).strict()).max(60).default([]),
    /** When a power last heard of trade resumed or cut between it and another, so news is told once, not each month. */
    tradeNews: z.array(z.object({ polityId: EntityIdSchema, otherPolityId: EntityIdSchema, kind: z.enum(["resumed", "cut"]), atStep: ElapsedStepSchema }).strict()).max(200).default([]),
  })
  .strict();
export type EconomyMemory = z.infer<typeof EconomyMemorySchema>;

export const EMPTY_ECONOMY_MEMORY: EconomyMemory = {
  lastReviewStep: null,
  lastHarvestYear: null,
  unrest: [],
  breachedObligationIds: [],
  reviewedWarIds: [],
  treatiesKeptSince: null,
  grievances: [],
  pendingCalls: [],
  contingentsSent: [],
  civilWars: [],
  taxPolicies: [],
  wasteNews: [],
  markets: [],
  marketNews: [],
  customsRates: [],
  customsDue: [],
  tradeLanes: [],
  tradeNews: [],
};

export const economyOf = (world: Pick<WorldState, "economy">): EconomyMemory => world.economy ?? EMPTY_ECONOMY_MEMORY;

/**
 * What a legionary is owed a month, in drachmae, before stoppages: two obols a
 * day, as Polybius gives it (6.39), thirty days to the month. The one rate
 * every army's pay is counted from: the treasury's outlay for an army
 * (`SOLDIER_PAY_PER_THOUSAND`), the pay of the named men in its ranks
 * (`sim/money.ts`) and the price of the bread it buys (`ordinaryGrainPrice`)
 * were three rates, a hundred and eighty times apart, until they were one.
 */
export const LEGIONARY_PAY_GROSS = 10;
/**
 * And what is stopped out of it for his grain, his clothes and the arms he is
 * issued, which Polybius says the quaestor deducted: about a third. A legionary
 * keeps seven a month, a centurion twice that, a horseman three times.
 */
export const PAY_STOPPAGES_SHARE = 1 / 3;
/**
 * What the treasury pays out for every thousand men of an army each month:
 * their gross pay, the part stopped out of it going on their grain, clothes and
 * arms, which the treasury buys. A power that states no rate of its own pays
 * this (`PolityMap.soldierPayPerThousand`).
 */
export const SOLDIER_PAY_PER_THOUSAND = LEGIONARY_PAY_GROSS * 1_000;
/**
 * A warship's crew a month, hull for hull: a trireme's oarsmen and marines are
 * not each paid a legionary's wage -- most were citizens or allies serving
 * their city's turn, and the pay is the keep of the rest.
 */
export const WARSHIP_PAY_PER_HULL = 500;

/** A talent of silver, the unit indemnities and treasuries were reckoned in: 6,000 drachmae. */
export const DRACHMAE_PER_TALENT = 6_000;

/** A sum of drachmae in the words a treaty would use: "3,200 talents" where it is large enough to be counted so. */
export function inTalents(drachmae: number): string {
  const talents = drachmae / DRACHMAE_PER_TALENT;
  return talents >= 1 ? `${Math.round(talents).toLocaleString("en-GB")} talents` : `${Math.round(drachmae).toLocaleString("en-GB")} drachmae`;
}

/**
 * A world with its markets opened, if they were not: the stocks a world that
 * has never been reckoned would start with (`openingMarkets`). The monthly
 * pass does this itself the first time it runs; readers and tests that want a
 * market to read or stress ask for it here. A world that has markets is
 * returned as it is.
 */
export function ensureMarkets(world: WorldState, monthsToHarvest = 6): WorldState {
  if (world.economy?.markets !== undefined && world.economy.markets.length > 0) return world;
  return { ...world, economy: { ...(world.economy ?? EMPTY_ECONOMY_MEMORY), markets: openingMarkets(world, monthsToHarvest) } };
}

/**
 * What bread for a thousand men for a day costs at a power's ordinary price:
 * half a day's pay at its own rate.
 */
export function ordinaryGrainPrice(soldierPayPerThousand: number | null | undefined): number {
  return (soldierPayPerThousand ?? SOLDIER_PAY_PER_THOUSAND) / 60;
}

/**
 * The one price of bread for an army, at the grain price of the market it
 * buys in (basis points of ordinary, `marketPriceBps`): the power's ordinary
 * price times what grain costs there. `sim/grain.ts` used to read a second
 * price off food security of its own, from 1 to 3 times, beside this
 * module's from 0.5 to 3: a famine that made bread dear to the treasury did
 * not make it dear to the legion. Both now read the market's stock.
 */
export function grainPriceFor(soldierPayPerThousand: number | null | undefined, grainBps: number): number {
  return (ordinaryGrainPrice(soldierPayPerThousand) * grainBps) / 10_000;
}

/**
 * What grain costs across a power's ground, weighted by the people who eat it:
 * each province pays the price of its hub's market (`marketPriceBps`).
 * 10 000 for a power with no ground or no reckoning yet.
 */
export function polityGrainPriceBps(world: Pick<WorldState, "map" | "material" | "economy">, polityId: string): number {
  if (!hasMarkets(world)) return 10_000;
  let people = 0;
  let weighted = 0;
  for (const row of world.material.provinceMaterial) {
    if (row.population <= 0 || provinceOf(world, row.provinceId)?.controllerPolityId !== polityId) continue;
    people += row.population;
    weighted += row.population * marketPriceBps(world, row.provinceId, "grain");
  }
  return people === 0 ? 10_000 : Math.round(weighted / people);
}

/** Whether the land has been reckoned and the markets opened. */
export const hasMarkets = (world: Pick<WorldState, "economy">): boolean => (world.economy?.markets?.length ?? 0) > 0;

/**
 * How much of a soldier's keep is bread, by what the obligation pays for: a
 * legion's pay buys the grain its allies eat and some of its own, a
 * victualling contract is nearly all food. Wages proper do not follow the
 * market; the rest does.
 */
export const BREAD_SHARE_BPS: Readonly<Partial<Record<string, number>>> = {
  army_pay: 3_000,
  army_upkeep: 7_000,
};

/**
 * What one payment of an army's keep costs with grain at this price: the bread
 * share bought at the market, the rest as written. Dear bread in a famine
 * year makes the same legion dearer to keep; a glut makes it cheaper.
 */
export function victualledAmount(amount: number, kind: string, grainBps: number): number {
  const bread = BREAD_SHARE_BPS[kind];
  if (bread === undefined || amount <= 0) return amount;
  return Math.max(1, Math.round(amount * ((10_000 - bread) + bread * grainBps / 10_000) / 10_000));
}

/**
 * What a trade route earns against its ordinary take, as basis points: a
 * merchant carrying from a cheap market to a dear one does well, the other way
 * badly. Half the price gap is his, bounded to between 0.7 and 1.5 times.
 * Prices are in basis points of the good's own base, so any good's two prices
 * will do (`bestGapGood` picks the one that pays most).
 */
export function tradePremiumBps(fromPriceBps: number, toPriceBps: number): number {
  return Math.max(7_000, Math.min(15_000, Math.round(10_000 + (toPriceBps - fromPriceBps) / 2)));
}

/**
 * Between two provinces' markets, the good that pays most to carry from the
 * first to the second, and the two prices (basis points of base) it fetches:
 * the one whose price at the far end most exceeds its price at the near end,
 * weighed by the root of its base price so that a cheap bulk good does not
 * beat a dear one on its percentage alone. With no good dearer at the far end
 * it is the least bad one; between equal markets, grain (as every old venture
 * was). Ties to the good listed first.
 */
export function bestGapGood(world: Pick<WorldState, "economy" | "map">, fromProvinceId: string, toProvinceId: string, among: readonly GoodId[] = GOODS.map((spec) => spec.id)): { readonly good: GoodId; readonly fromBps: number; readonly toBps: number } {
  let best: { good: GoodId; fromBps: number; toBps: number } = { good: "grain", fromBps: 10_000, toBps: 10_000 };
  let bestGap = -Infinity;
  for (const good of among) {
    const fromBps = marketPriceBps(world, fromProvinceId, good);
    const toBps = marketPriceBps(world, toProvinceId, good);
    const gap = (toBps - fromBps) * Math.sqrt(goodSpec(good).basePrice);
    if (gap > bestGap + 1e-9) {
      bestGap = gap;
      best = { good, fromBps, toBps };
    }
  }
  return best;
}

/** Grain price in one province's market, 10 000 where nothing is reckoned for it. */
export function provinceGrainPriceBps(world: Pick<WorldState, "economy" | "map">, provinceId: string): number {
  return marketPriceBps(world, provinceId, "grain");
}

/** What grain costs where this account's owner buys it: his power's ground, or where he stands. */
export function grainPriceForAccount(world: Pick<WorldState, "map" | "material" | "characters" | "economy">, accountId: string): number {
  const owner = world.material.accounts.find((account) => account.id === accountId)?.owner;
  if (owner?.kind === "polity") return polityGrainPriceBps(world, owner.id);
  if (owner?.kind === "character") {
    const where = world.characters.find((character) => character.id === owner.id)?.locationProvinceId;
    return where === undefined ? 10_000 : provinceGrainPriceBps(world, where);
  }
  return 10_000;
}

/** One payment of this obligation as the market makes it today: its bread share at the payer's grain price. */
export function obligationAmountNow(world: Pick<WorldState, "map" | "material" | "characters" | "economy">, obligation: { readonly amount: number; readonly kind: string; readonly payerAccountId: string }): number {
  return victualledAmount(obligation.amount, obligation.kind, grainPriceForAccount(world, obligation.payerAccountId));
}
