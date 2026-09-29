import type { WorldState } from "../world/world-state";
import type { EffectBand } from "../world/standing-effects";
import { provinceTaxCapacity } from "./province-material";

/**
 * What a trade venture is worth, on the same scale as everything else a
 * person can put money into (`estates.ts`, `world/standing-effects.ts`).
 *
 * A venture moves goods between two places, or sells them in one, so it can
 * be no richer than the poorer market it touches: its return is a share of
 * the lesser of the two provinces' monthly tax capacity. It pays back faster than land and is riskier -- a war
 * with the power at the other end, or an enemy fleet off either port, stops it
 * dead -- so it costs fewer months of its return than an estate does.
 */

/** Of the lesser province's monthly tax capacity: what a venture of each size returns its owner each month. */
const VENTURE_RETURN_SHARE: Record<EffectBand, number> = { slight: 0.003, marked: 0.008, great: 0.018 };
/** Months of its return a venture costs to set going: ships hired, goods bought, agents placed. */
export const VENTURE_PRICE_MONTHS = 15;

const capacityOf = provinceTaxCapacity;

/** What a venture of this size between these two places returns a month, and costs. Null if either place does not exist. */
export function ventureTerms(
  world: WorldState,
  fromProvinceId: string,
  toProvinceId: string,
  band: EffectBand,
): { readonly monthlyReturn: number; readonly price: number } | null {
  const from = capacityOf(world, fromProvinceId);
  const to = capacityOf(world, toProvinceId);
  if (from === null || to === null) return null;
  const monthlyReturn = Math.max(1, Math.round(Math.min(from, to) * VENTURE_RETURN_SHARE[band]));
  return { monthlyReturn, price: monthlyReturn * VENTURE_PRICE_MONTHS };
}

/** Whether a province can take part in trade by sea: it has a port. */
export function hasPort(world: WorldState, provinceId: string): boolean {
  return world.map.provinces.find((province) => province.id === provinceId)?.settlements.some((settlement) => settlement.kind === "port") === true;
}
