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
const ESTATE_YIELD_SHARE: Record<EffectBand, number> = { slight: 0.002 * PRIVATE_WEALTH_SCALE, marked: 0.005 * PRIVATE_WEALTH_SCALE, great: 0.012 * PRIVATE_WEALTH_SCALE };
/**
 * Months of its yield an estate costs to buy. Far below what land fetched in
 * any real age, deliberately: at twenty years' rent, no senator in the game
 * could buy a farm with everything he owned.
 */
export const ESTATE_PRICE_MONTHS = 20;
/** Of the province's monthly tax capacity: what one improvement of each size adds to the yield. */
const IMPROVEMENT_SHARE: Record<EffectBand, number> = { slight: 0.001 * PRIVATE_WEALTH_SCALE, marked: 0.0025 * PRIVATE_WEALTH_SCALE, great: 0.005 * PRIVATE_WEALTH_SCALE };
/** Months of the added yield an improvement costs: it pays for itself in two and a half years. */
export const IMPROVEMENT_PAYBACK_MONTHS = 30;
/** However much is spent on it, an estate yields no more than this share of its province each month. */
const ESTATE_MAX_SHARE = 0.03 * PRIVATE_WEALTH_SCALE;

const capacityOf = provinceTaxCapacity;

/** What an estate of this size in this province yields a month, and costs to buy. Null for a province that does not exist. */
export function estateTerms(world: WorldState, provinceId: string, band: EffectBand): { readonly monthlyYield: number; readonly price: number } | null {
  const capacity = capacityOf(world, provinceId);
  if (capacity === null) return null;
  const monthlyYield = Math.max(1, Math.round(capacity * ESTATE_YIELD_SHARE[band]));
  return { monthlyYield, price: monthlyYield * ESTATE_PRICE_MONTHS };
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
