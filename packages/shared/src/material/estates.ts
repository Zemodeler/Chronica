import type { WorldState } from "../world/world-state";
import type { EffectBand } from "../world/standing-effects";
import { REVENUE_SCALE, provinceTaxCapacity } from "./province-material";

/**
 * What land is worth to the man who owns it.
 *
 * A scale, not a market. Every figure is a share of the province's own monthly
 * tax capacity, so an estate in rich Campania yields more than one in the
 * Bruttian hills, and the same word means the same thing in every scenario's
 * economy -- the rule `world/standing-effects.ts` already follows. The shares
 * are an order of magnitude below a market's, because a man's estate is his
 * living, not a town's trade.
 */

/**
 * What a private man's wealth is, against what a state's is, from the same
 * province: three tenths. The shares below were set when a province's tax
 * capacity was counted in hundreds, and are now shares of millions
 * (`TAX_CAPACITY_PER_POPULATION`), which left a marked estate in Rome yielding
 * a hundred and twenty thousand a year, and its owner worth three times the
 * hundred thousand denarii that put a man in the Senate. At this scale a
 * senator with a marked estate, a purse of the same size and a venture or two
 * is worth what the census said: about a hundred thousand.
 */
export const PRIVATE_WEALTH_SCALE = 0.3 / REVENUE_SCALE;

/** Of the province's monthly tax capacity: what an estate of each size yields its owner each month. */
const ESTATE_YIELD_SHARE: Record<EffectBand, number> = { slight: 0.0002 * PRIVATE_WEALTH_SCALE, marked: 0.0005 * PRIVATE_WEALTH_SCALE, great: 0.0012 * PRIVATE_WEALTH_SCALE };
/**
 * Months of its yield an estate costs to buy. Far below what land fetched in
 * any real age, deliberately: at twenty years' rent, no senator in the game
 * could buy a farm with everything he owned.
 */
export const ESTATE_PRICE_MONTHS = 20;
/**
 * Months of its yield an estate costs to buy, as land fetched: two hundred, so it pays six in a hundred a year of what it cost (Columella, writing later, gives
 * four to six; the Roman rate on money was one in a hundred a month, which land, being safe, paid well under). The shares above are a tenth of what they were
 * when land was priced at twenty months and paid sixty in a hundred a year, a better business than any venture; what an estate costs has not changed, only what
 * it pays. The pledge of an estate (`money.ts`) is reckoned at this price too, as the authored estates were rescaled to it (2026-10-08); `ESTATE_PRICE_MONTHS` is the old reckoning, kept for old saves' readers.
 */
export const ESTATE_LAND_PRICE_MONTHS = 200;
/** Of the province's monthly tax capacity: what one improvement of each size adds to the yield. */
const IMPROVEMENT_SHARE: Record<EffectBand, number> = { slight: 0.0001 * PRIVATE_WEALTH_SCALE, marked: 0.00025 * PRIVATE_WEALTH_SCALE, great: 0.0005 * PRIVATE_WEALTH_SCALE };
/** Months of the added yield an improvement costs: it pays for itself in twenty-five years, four in a hundred a year, a little under what the land itself pays. */
export const IMPROVEMENT_PAYBACK_MONTHS = 300;
/** However much is spent on it, an estate yields no more than this share of its province each month. */
const ESTATE_MAX_SHARE = 0.003 * PRIVATE_WEALTH_SCALE;

const capacityOf = provinceTaxCapacity;

/** What an estate of this size in this province yields a month, and costs to buy. Null for a province that does not exist. */
export function estateTerms(world: WorldState, provinceId: string, band: EffectBand): { readonly monthlyYield: number; readonly price: number } | null {
  const capacity = capacityOf(world, provinceId);
  if (capacity === null) return null;
  const monthlyYield = Math.max(1, Math.round(capacity * ESTATE_YIELD_SHARE[band]));
  return { monthlyYield, price: monthlyYield * ESTATE_LAND_PRICE_MONTHS };
}

/**
 * What improving an estate by this much adds, and costs. `added` is cut down to
 * what the land still has in it; zero means it has nothing more to give.
 */
export function improvementTerms(
  world: WorldState,
  provinceId: string,
  currentMonthlyYield: number,
  band: EffectBand,
): { readonly added: number; readonly cost: number } | null {
  const capacity = capacityOf(world, provinceId);
  if (capacity === null) return null;
  const ceiling = Math.round(capacity * ESTATE_MAX_SHARE);
  const added = Math.max(0, Math.min(Math.round(capacity * IMPROVEMENT_SHARE[band]), ceiling - currentMonthlyYield));
  return { added, cost: added * IMPROVEMENT_PAYBACK_MONTHS };
}
