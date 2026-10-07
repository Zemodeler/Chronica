import {
  MAX_PREMIUM_BPS,
  coinageOfPolity,
  exchangeRateBps,
  standardOf,
  coinagesOf,
  economyOf,
  targetPriceLevelBps,
  warsOf,
  MIN_PRICE_LEVEL_BPS,
  MAX_PRICE_LEVEL_BPS,
  type Coinage,
  type FactProposalDraft,
  type WorldState,
  readDepartments,
} from "@chronica/shared";
import { coinsBadName } from "./levers";

/**
 * The coinages' monthly pass (phase E of the economy rework): where prices
 * and exchange rates are going after what a mint has done and what the world
 * has done to a power's credit.
 *
 * Two things move, a little each month, for each coinage a power strikes:
 *
 *  - the price level (`priceLevelBps`) closes on the ratio of the silver the
 *    coin was struck with to the silver it holds now. After a debasement the
 *    gap is slow to close at first (two in a hundred of it in the month of the
 *    debasement) and faster as the coin's new weight becomes known, a further
 *    hundredth for every month, up to a tenth of the gap a month; after a
 *    reform it comes back at half that, because prices are slow to fall;
 *  - the premium the coin fetches among money-changers drifts a tenth of the
 *    way a month toward what the issuer's credit would have it: up with a
 *    surplus of trade (customs and flows of phase D), down with a deficit, with
 *    war, with arrears on what the treasury owes and with the price level a
 *    debasement has built. Bounded to fifteen in a hundred either way.
 *
 * It never debases anything itself. A power at war that cannot pay what it
 * owes is told once a year that its coin is under strain, as a fact for the
 * rulers and their advisers; whether to strike it with less silver is theirs.
 */

/** What a month's drift closes: the least and the most of the gap to the price level it is heading for, in basis points of the gap. */
const LEVEL_RATE_MIN_BPS = 200;
const LEVEL_RATE_MAX_BPS = 1_000;
/** Each month known adds this to the rate, so the rise gathers pace. */
const LEVEL_RATE_PER_MONTH_BPS = 100;
/** Prices come down at this share of the rate they go up. */
const LEVEL_DEFLATION_RATE_BPS = 500;
/** The share of the way to the premium it is heading for that a coin goes each month. */
const PREMIUM_DRIFT_BPS = 1_000;
/** A balance of trade is worth this much premium at the extreme (all exports, or all imports). */
const TRADE_PREMIUM_BPS = 400;
/** War and arrears each take this much from what a coin fetches. */
const WAR_PREMIUM_BPS = 200;
const ARREARS_PREMIUM_BPS = 200;
/** A built-up price level takes this share of its excess from the premium, to this much at most. */
const INFLATION_PREMIUM_SHARE_BPS = 3_500;
const INFLATION_PREMIUM_MAX_BPS = 900;
const MONTH_DAYS = 30;
/** The strain is told no oftener than once a year, and at most to two powers in a pass. */
export const STRAIN_NEWS_REPEAT_DAYS = 360;
const MAX_STRAIN_NEWS_PER_PASS = 2;

const nameOf = (world: WorldState, id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

/** The premium a coin is heading for, given an issuer's trade, wars and arrears; bounded. */
export function premiumTarget(coinage: Coinage, balance: { readonly exports: number; readonly imports: number }, atWar: boolean, inArrears: boolean, badName = 1): number {
  const traded = balance.exports + balance.imports;
  const trade = traded <= 0 ? 0 : Math.round((TRADE_PREMIUM_BPS * (balance.exports - balance.imports)) / traded);
  const excess = Math.max(0, coinage.priceLevelBps - 10_000);
  const inflation = Math.min(INFLATION_PREMIUM_MAX_BPS, Math.round((excess * INFLATION_PREMIUM_SHARE_BPS) / 10_000));
  // How much of the coin's bad name -- war, arrears, the prices a lighter coin has built -- sticks to it among the money-changers
  // is what the master of its mint can answer for (the `mint` charge): a middling one, all of it.
  const target = trade - Math.round(((atWar ? WAR_PREMIUM_BPS : 0) + (inArrears ? ARREARS_PREMIUM_BPS : 0) + inflation) * badName);
  return Math.max(-MAX_PREMIUM_BPS, Math.min(MAX_PREMIUM_BPS, target));
}

/** One month's step of a coinage's price level toward where its silver content says prices belong. */
export function stepPriceLevel(coinage: Coinage, day: number): number {
  const target = targetPriceLevelBps(coinage);
  const gap = target - coinage.priceLevelBps;
  if (gap === 0) return coinage.priceLevelBps;
  const months = coinage.debasedSinceStep === null ? LEVEL_RATE_MAX_BPS / LEVEL_RATE_PER_MONTH_BPS : Math.max(0, (day - coinage.debasedSinceStep) / MONTH_DAYS);
  const rate = gap > 0 ? Math.max(LEVEL_RATE_MIN_BPS, Math.min(LEVEL_RATE_MAX_BPS, Math.round(LEVEL_RATE_MIN_BPS + LEVEL_RATE_PER_MONTH_BPS * months))) : LEVEL_DEFLATION_RATE_BPS;
  const move = Math.sign(gap) * Math.min(Math.abs(gap), Math.max(1, Math.round((Math.abs(gap) * rate) / 10_000)));
  return Math.max(MIN_PRICE_LEVEL_BPS, Math.min(MAX_PRICE_LEVEL_BPS, coinage.priceLevelBps + move));
}

/** One month's step of a coin's premium toward its target: a tenth of the way, never less than a basis point. */
export function stepPremium(premium: number, target: number): number {
  const gap = target - premium;
  if (gap === 0) return premium;
  return premium + Math.sign(gap) * Math.min(Math.abs(gap), Math.max(1, Math.round((Math.abs(gap) * PREMIUM_DRIFT_BPS) / 10_000)));
}

/**
 * The coinages' pass for the months the land was just reckoned (`days` the day
 * of each). Returns the world with its coinages moved, and the news of any
 * issuer whose coin is under strain.
 */
export function monthOfCoinage(world: WorldState, days: readonly number[], toDay: number): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const coinages = coinagesOf(world);
  if (coinages.length === 0 || days.length === 0) return { world, facts: [] };
  const memory = economyOf(world);

  // Each issuer's trade balance last month, from the busiest lanes between powers.
  const exports = new Map<string, number>();
  const imports = new Map<string, number>();
  for (const lane of memory.tradeLanes) {
    exports.set(lane.fromPolityId, (exports.get(lane.fromPolityId) ?? 0) + lane.value);
    imports.set(lane.toPolityId, (imports.get(lane.toPolityId) ?? 0) + lane.value);
  }
  // Which powers' treasuries owe what they have not paid: the owner of the account of each obligation in arrears.
  const owners = new Map(world.material.accounts.filter((account) => account.owner.kind === "polity").map((account) => [account.id, account.owner.id] as const));
  const behind = new Set<string>();
  for (const obligation of world.material.obligations) {
    if (!obligation.active || obligation.arrears <= 0) continue;
    const owner = owners.get(obligation.payerAccountId);
    if (owner !== undefined) behind.add(owner);
  }

  const facts: FactProposalDraft[] = [];
  let strained = 0;
  const reader = readDepartments(world);
  const next = coinages.map((coinage) => {
    const issuer = coinage.issuerPolityId;
    if (issuer === null) return coinage;
    const badName = coinsBadName(reader, issuer);
    const atWar = warsOf(world.polityAgreements, issuer).length > 0;
    const inArrears = behind.has(issuer);
    let current = coinage;
    for (const day of days) {
      const priceLevelBps = stepPriceLevel(current, day);
      const target = premiumTarget({ ...current, priceLevelBps }, { exports: exports.get(issuer) ?? 0, imports: imports.get(issuer) ?? 0 }, atWar, inArrears, badName);
      current = { ...current, priceLevelBps, premiumBps: stepPremium(current.premiumBps, target) };
    }
    // At war and behind on what it owes: the coin is under strain, said once a year.
    if (atWar && inArrears && strained < MAX_STRAIN_NEWS_PER_PASS && (coinage.strainToldStep === null || toDay - coinage.strainToldStep >= STRAIN_NEWS_REPEAT_DAYS)) {
      strained += 1;
      current = { ...current, strainToldStep: toDay };
      facts.push({
        localId: `coinage_strain_${coinage.id}_${toDay}`.slice(0, 60),
        kind: "coinage_strain",
        summary: `${nameOf(world, issuer)} is at war and behind on what its treasury owes, and its coin, ${coinage.name}, is under strain: the money-changers take it at less, and its rulers may be tempted to strike it with less silver.`.slice(0, 600),
        affectedRefs: [{ kind: "polity", id: issuer }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 35,
      });
    }
    return current;
  });
  const changed = next.some((coinage, index) => coinage !== coinages[index]);
  return { world: changed ? { ...world, economy: { ...memory, coinages: next } } : world, facts };
}

/** How far a coin's silver content, price level or premium must stray from ordinary before it is worth a line in a ruler's page. */
const NOTABLE_SILVER_SHORTFALL_BPS = 200;
const NOTABLE_PRICE_LEVEL_BPS = 500;
const NOTABLE_PREMIUM_BPS = 300;
/** The partners a line names, by the value of the trade. */
const PARTNERS_NAMED = 2;

/**
 * The line a power's rulers read about its money, or null where there is
 * nothing to say: its coin at its standard silver, prices where they were and
 * no premium or discount worth the name. Says what the coin holds against its
 * standard, which way prices are heading, what it fetches against its silver
 * and what a hundred of it buys of each main trading partner's coin.
 */
export function coinageSummary(world: WorldState, polityId: string): string | null {
  const coinages = coinagesOf(world);
  if (coinages.length === 0) return null;
  const own = coinageOfPolity(world, polityId);
  const standard = standardOf(own);
  const shortfall = standard - own.silverBps;
  const target = targetPriceLevelBps(own);
  const pressure = target - own.priceLevelBps;
  const notable = shortfall >= (standard * NOTABLE_SILVER_SHORTFALL_BPS) / 10_000
    || Math.abs(own.priceLevelBps - 10_000) >= NOTABLE_PRICE_LEVEL_BPS
    || Math.abs(own.premiumBps) >= NOTABLE_PREMIUM_BPS
    || own.strainToldStep !== null && world.elapsedStep - own.strainToldStep < STRAIN_NEWS_REPEAT_DAYS;
  if (!notable) return null;
  const parts = [`${own.name} holds ${Math.round((100 * own.silverBps) / standard)}% of its standard silver`];
  if (Math.abs(own.priceLevelBps - 10_000) >= NOTABLE_PRICE_LEVEL_BPS) parts.push(`prices at ${Math.round(own.priceLevelBps / 100)}% of ordinary${pressure >= NOTABLE_PRICE_LEVEL_BPS ? ` and heading for ${Math.round(target / 100)}%` : ""}`);
  if (Math.abs(own.premiumBps) >= NOTABLE_PREMIUM_BPS) parts.push(`fetching ${Math.abs(Math.round(own.premiumBps / 100))}% ${own.premiumBps > 0 ? "above" : "below"} its silver`);
  const trades = new Map<string, number>();
  for (const lane of economyOf(world).tradeLanes) {
    if (lane.fromPolityId !== polityId && lane.toPolityId !== polityId) continue;
    const other = lane.fromPolityId === polityId ? lane.toPolityId : lane.fromPolityId;
    trades.set(other, (trades.get(other) ?? 0) + lane.value);
  }
  const rates: string[] = [];
  const seen = new Set<string>([own.id]);
  for (const [other] of [...trades.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const theirs = coinageOfPolity(world, other);
    if (seen.has(theirs.id)) continue;
    seen.add(theirs.id);
    rates.push(`${theirs.name} ${Math.round(exchangeRateBps(world, own.id, theirs.id) / 100)}`);
    if (rates.length >= PARTNERS_NAMED) break;
  }
  if (rates.length > 0) parts.push(`a hundred of it buys ${rates.join(", ")} of theirs`);
  return `Coinage: ${parts.join("; ")}.`;
}
