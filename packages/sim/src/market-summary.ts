import {
  GOODS,
  economyOf,
  hasMarkets,
  marketGeography,
  marketsOf,
  provinceOf,
  type FactProposalDraft,
  type GoodId,
  type MarketHub,
  type WorldState,
} from "@chronica/shared";
import { safeLocalId } from "./safe-local-id";

/**
 * What a power's markets are doing, as one line for its rulers and as news.
 *
 * A line a power and never a line a province or a hub: a power may hold half
 * the hubs on the map, and a ruler is told how bread stands in his country and
 * what has gone dear or cheap, not given the granaries' ledgers. The figures
 * are the power's own people's, weighted by how many of them trade in each hub.
 */

/** A hub whose granary holds less than this share of what it ought is "in shortage". */
export const SHORTAGE_COVER = 0.7;
/** Grain at least this dear (basis points of ordinary) is a shortage worth the news; at most the second is a glut. */
export const SHORTAGE_PRICE_BPS = 18_000;
export const GLUT_PRICE_BPS = 6_000;
/** And a good this dear or cheap is named in the line. */
const DEAR_BPS = 14_000;
const CHEAP_BPS = 7_000;
/** The news of a power's markets is told again no sooner than this many days after it was last told of it. */
export const MARKET_NEWS_REPEAT_DAYS = 360;
/** At most this many powers a pass hear of their markets. */
const MAX_NEWS_PER_PASS = 3;

export interface PolityMarket {
  readonly people: number;
  /** Grain in the hubs its people trade in, in months of what those hubs use. Null where nothing is used. */
  readonly grainMonths: number | null;
  /** Grain's price across its people, basis points of ordinary. */
  readonly grainBps: number;
  /** Every good's price across its people, basis points of ordinary. */
  readonly prices: ReadonlyMap<GoodId, number>;
  readonly hubs: number;
  /** Of those, hubs whose granary holds under `SHORTAGE_COVER` of what it ought. */
  readonly shortHubs: number;
}

/** Every power's markets, from one pass over the provinces. */
export function polityMarkets(world: WorldState): Map<string, PolityMarket> {
  if (!hasMarkets(world)) return new Map();
  const geography = marketGeography(world);
  const books = new Map<string, MarketHub>(marketsOf(world).map((hub) => [hub.hubId, hub]));
  const trading = new Map<string, Map<string, number>>();
  for (const row of world.material.provinceMaterial) {
    if (row.population <= 0) continue;
    const holder = provinceOf(world, row.provinceId)?.controllerPolityId;
    const hub = geography.hubOf.get(row.provinceId);
    if (holder === null || holder === undefined || hub === undefined) continue;
    const by = trading.get(holder) ?? new Map<string, number>();
    by.set(hub, (by.get(hub) ?? 0) + row.population);
    trading.set(holder, by);
  }
  const result = new Map<string, PolityMarket>();
  for (const [polityId, by] of trading) {
    let people = 0;
    const weighted = new Map<GoodId, number>(GOODS.map((spec) => [spec.id, 0]));
    let stock = 0;
    let demand = 0;
    let short = 0;
    for (const [hubId, weight] of by) {
      const hub = books.get(hubId);
      if (hub === undefined) continue;
      people += weight;
      for (const entry of hub.goods) weighted.set(entry.good, weighted.get(entry.good)! + weight * entry.priceBps);
      const grain = hub.goods.find((entry) => entry.good === "grain");
      if (grain !== undefined) {
        stock += grain.stock;
        demand += grain.demand;
        if (grain.target > 0 && grain.stock < SHORTAGE_COVER * grain.target) short += 1;
      }
    }
    if (people === 0) continue;
    const prices = new Map<GoodId, number>([...weighted].map(([good, sum]) => [good, Math.round(sum / people)]));
    result.set(polityId, {
      people,
      grainMonths: demand > 0 ? stock / demand : null,
      grainBps: prices.get("grain") ?? 10_000,
      prices,
      hubs: by.size,
      shortHubs: short,
    });
  }
  return result;
}

const names = (good: GoodId): string => GOODS.find((spec) => spec.id === good)!.name;
const times = (bps: number): string => `${(bps / 10_000).toFixed(1)}x`;

/**
 * The line a power's rulers read about its markets: grain in store, its price,
 * the two dearest and two cheapest goods when any is far from ordinary, and the
 * hubs short of grain. Null when there is nothing to say: grain near its
 * ordinary price, no good far off it, nobody short.
 */
export function marketSummary(market: PolityMarket | undefined): string | null {
  if (market === undefined) return null;
  const ranked = [...market.prices.entries()].filter(([good]) => good !== "grain").sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const dear = ranked.filter(([, bps]) => bps >= DEAR_BPS).slice(0, 2);
  const cheap = [...ranked].reverse().filter(([, bps]) => bps <= CHEAP_BPS).slice(0, 2);
  const grainOff = Math.abs(market.grainBps - 10_000) >= 1_500;
  if (!grainOff && dear.length === 0 && cheap.length === 0 && market.shortHubs === 0) return null;
  const parts: string[] = [];
  if (market.grainMonths !== null) {
    const verdict = market.grainBps >= 11_500 ? ": bread is dear, and armies cost more to keep" : market.grainBps <= 8_500 ? ": bread is cheap" : "";
    parts.push(`grain in store for ${Math.round(market.grainMonths)} months, selling at ${Math.round(market.grainBps / 100)}% of its ordinary price${verdict}`);
  }
  if (dear.length > 0) parts.push(`dear: ${dear.map(([good, bps]) => `${names(good)} ${times(bps)}`).join(", ")}`);
  if (cheap.length > 0) parts.push(`cheap: ${cheap.map(([good, bps]) => `${names(good)} ${times(bps)}`).join(", ")}`);
  if (market.shortHubs > 0) parts.push(`${market.shortHubs} of ${market.hubs} markets short of grain`);
  return `Our markets: ${parts.join("; ")}.`;
}

/**
 * Powers whose grain has gone far too dear or too cheap, as news: one fact a
 * power, told no more than once a year, at most three a pass, the dearest
 * first. Returns the facts and the memory of who was told, which the caller
 * writes into the economy.
 */
export function marketNews(world: WorldState, toDay: number): { readonly facts: FactProposalDraft[]; readonly told: { polityId: string; kind: "shortage" | "glut"; atStep: number }[] } {
  const memory = economyOf(world);
  const markets = polityMarkets(world);
  const lastTold = new Map(memory.marketNews.map((entry) => [`${entry.polityId}:${entry.kind}`, entry.atStep]));
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const candidates = [...markets.entries()].flatMap(([polityId, market]) => {
    const kind = market.grainBps >= SHORTAGE_PRICE_BPS ? "shortage" as const : market.grainBps <= GLUT_PRICE_BPS ? "glut" as const : null;
    if (kind === null || market.people < 5_000) return [];
    const was = lastTold.get(`${polityId}:${kind}`);
    return was !== undefined && toDay - was < MARKET_NEWS_REPEAT_DAYS ? [] : [{ polityId, kind, market }];
  }).sort((a, b) => Math.abs(b.market.grainBps - 10_000) - Math.abs(a.market.grainBps - 10_000) || a.polityId.localeCompare(b.polityId)).slice(0, MAX_NEWS_PER_PASS);
  const facts: FactProposalDraft[] = candidates.map(({ polityId, kind, market }) => ({
    localId: safeLocalId(`${kind}_${polityId}_${toDay}`).slice(0, 60),
    kind,
    summary: kind === "shortage"
      ? `Grain is short in ${name(polityId)}: it sells at ${times(market.grainBps)} its ordinary price, with ${market.grainMonths === null ? "little" : `${Math.round(market.grainMonths)} months`} in store${market.shortHubs > 0 ? ` and ${market.shortHubs} of its ${market.hubs} markets short` : ""}; armies cost more to keep and the poor will go hungry.`.slice(0, 600)
      : `Grain is a glut in ${name(polityId)}: it sells at ${times(market.grainBps)} its ordinary price, the granaries full; farmers will not thank the weather.`.slice(0, 600),
    affectedRefs: [{ kind: "polity", id: polityId }],
    visibility: "public",
    discoveryState: "public",
    knowableInDays: 0,
    significance: kind === "shortage" ? 45 : 20,
  }));
  return { facts, told: candidates.map(({ polityId, kind }) => ({ polityId, kind, atStep: toDay })) };
}
