import type { WorldState } from "../world/world-state";
import { economyOf } from "../world/economy";
import { GOODS, marketGeography, marketsOf, type GoodId } from "../world/markets";
import { tradeTermsBetween } from "../world/agreements";

/**
 * The markets and trade of a power as the one who governs it reads them
 * (phase F of the economy rework): how many months of bread its granaries
 * hold, what the six goods cost in the hubs its people trade in against what
 * they ordinarily cost, which lanes carry the most, the customs it lays, and
 * which pacts and embargoes stand.
 *
 * Derived from the world each time, stored nowhere, one entry a hub and never
 * a line a province.
 */

/** The hubs listed, the biggest by the people who trade in them. */
export const HUBS_SHOWN = 5;
export const LANES_SHOWN = 6;

export interface GoodPrice {
  readonly good: GoodId;
  readonly name: string;
  readonly unit: string;
  /** In drachmae a unit, as the hub sells it now. */
  readonly price: number;
  /** In drachmae a unit when the market holds what it ought. */
  readonly base: number;
  /** Basis points of the base: 10 000 is the ordinary price. */
  readonly bps: number;
}

export interface HubLine {
  readonly hubId: string;
  readonly name: string;
  /** The people who trade in it, from this power's own provinces. */
  readonly people: number;
  /** Grain in store, in months of what the hub's people use. Null where nobody uses any. */
  readonly grainMonths: number | null;
  readonly short: boolean;
  readonly goods: readonly GoodPrice[];
}

export interface LaneLine {
  readonly withLabel: string;
  /** What passed a month, in drachmae. */
  readonly value: number;
  readonly direction: "to_us" | "from_us";
}

export interface PactLine {
  readonly key: string;
  readonly kind: "trade_pact" | "embargo";
  readonly withLabel: string;
  /** "customs capped at 5 in a hundred, most-favoured terms", or the goods an embargo forbids. */
  readonly terms: string;
  readonly heldByWar: boolean;
  /** Laid by us (an embargo) rather than on us. */
  readonly byUs: boolean;
}

export interface TradeReading {
  readonly polityLabel: string;
  readonly hubs: number;
  readonly shortHubs: number;
  /** Grain in the hubs its people trade in, in months of their use. */
  readonly grainMonths: number | null;
  /** Its people's grain price, basis points of ordinary. */
  readonly grainBps: number;
  readonly customsRateBps: number;
  readonly main: readonly HubLine[];
  readonly lanes: readonly LaneLine[];
  readonly pacts: readonly PactLine[];
}

const SHORTAGE_COVER = 0.7;
const percent = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)} in a hundred`;

/** The trade of one power, or null where its provinces trade in no market that has been reckoned yet. */
export function readTheTrade(world: WorldState, polityId: string): TradeReading | null {
  const hubs = marketsOf(world);
  if (hubs.length === 0) return null;
  const geography = marketGeography(world);
  const books = new Map(hubs.map((hub) => [hub.hubId, hub]));
  const holder = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  const names = new Map(world.map.provinces.map((province) => [province.id, province.name]));
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? "another power";
  const memory = economyOf(world);

  const people = new Map<string, number>();
  for (const row of world.material.provinceMaterial) {
    if (row.population <= 0 || holder.get(row.provinceId) !== polityId) continue;
    const hub = geography.hubOf.get(row.provinceId);
    if (hub !== undefined) people.set(hub, (people.get(hub) ?? 0) + row.population);
  }
  if (people.size === 0) return null;

  let stock = 0;
  let demand = 0;
  let short = 0;
  let weightSum = 0;
  let grainWeighted = 0;
  const lines: HubLine[] = [];
  for (const [hubId, weight] of people) {
    const hub = books.get(hubId);
    if (hub === undefined) continue;
    const grain = hub.goods.find((entry) => entry.good === "grain");
    const isShort = grain !== undefined && grain.target > 0 && grain.stock < SHORTAGE_COVER * grain.target;
    if (grain !== undefined) {
      stock += grain.stock;
      demand += grain.demand;
      grainWeighted += grain.priceBps * weight;
      weightSum += weight;
      if (isShort) short += 1;
    }
    lines.push({
      hubId,
      name: names.get(hubId) ?? hubId,
      people: weight,
      grainMonths: grain !== undefined && grain.demand > 0 ? grain.stock / grain.demand : null,
      short: isShort,
      goods: GOODS.map((spec) => {
        const entry = hub.goods.find((candidate) => candidate.good === spec.id);
        const bps = entry?.priceBps ?? 10_000;
        return { good: spec.id, name: spec.name, unit: spec.unit, price: Math.round(spec.basePrice * bps) / 10_000, base: spec.basePrice, bps };
      }),
    });
  }
  lines.sort((a, b) => b.people - a.people || a.hubId.localeCompare(b.hubId));

  const lanes: LaneLine[] = memory.tradeLanes
    .filter((lane) => lane.fromPolityId === polityId || lane.toPolityId === polityId)
    .map((lane) => ({ withLabel: polityName(lane.fromPolityId === polityId ? lane.toPolityId : lane.fromPolityId), value: lane.value, direction: lane.toPolityId === polityId ? "to_us" as const : "from_us" as const }))
    .sort((a, b) => b.value - a.value || a.withLabel.localeCompare(b.withLabel))
    .slice(0, LANES_SHOWN);

  const pacts: PactLine[] = [];
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || (agreement.kind !== "trade_pact" && agreement.kind !== "embargo")) continue;
    if (agreement.polityId !== polityId && agreement.otherPolityId !== polityId) continue;
    const other = agreement.polityId === polityId ? agreement.otherPolityId : agreement.polityId;
    const terms = agreement.trade;
    const goods = (terms?.goods ?? []).map((good) => GOODS.find((spec) => spec.id === good)?.name ?? good);
    const parts = agreement.kind === "embargo"
      ? [goods.length === 0 ? "all trade" : goods.join(", ")]
      : [
        terms?.tariffCapBps != null ? `customs capped at ${percent(terms.tariffCapBps)}` : null,
        terms?.mostFavoured === true ? "most-favoured terms" : null,
        (terms?.exempt ?? []).length > 0 ? `${terms!.exempt.map((good) => GOODS.find((spec) => spec.id === good)?.name ?? good).join(", ")} free of customs` : null,
      ].filter((part): part is string => part !== null);
    pacts.push({
      key: agreement.id,
      kind: agreement.kind,
      withLabel: polityName(other),
      terms: parts.length === 0 ? "no special terms" : parts.join("; "),
      heldByWar: agreement.kind === "trade_pact" && tradeTermsBetween(world, polityId, other).pactSuspended,
      byUs: agreement.kind === "embargo" && agreement.polityId === polityId,
    });
  }

  return {
    polityLabel: polityName(polityId),
    hubs: people.size,
    shortHubs: short,
    grainMonths: demand > 0 ? stock / demand : null,
    grainBps: weightSum > 0 ? Math.round(grainWeighted / weightSum) : 10_000,
    customsRateBps: memory.customsRates.find((entry) => entry.polityId === polityId)?.rateBps ?? 0,
    main: lines.slice(0, HUBS_SHOWN),
    lanes,
    pacts,
  };
}
