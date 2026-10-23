import {
  GOODS,
  economyOf,
  inTalents,
  marketsOf,
  tradeTermsBetween,
  type FactProposalDraft,
  type GoodId,
  type WorldState,
} from "@chronica/shared";
import { safeLocalId } from "./safe-local-id";

/**
 * What a power's trade is doing, as one line for its rulers and as news
 * (phase D of the economy rework).
 *
 * A line a power and never a line a hub or a province: a ruler is told whom it
 * trades with, what it sells and buys, what customs it lays, which pacts and
 * embargoes stand and whether trade is easing or worsening a shortage, not
 * given a ledger of lanes. Said only when there is something to say.
 */

/** A good this dear (basis points of ordinary) in a hub is a shortage trade can ease or worsen. */
const DEAR_BPS = 14_000;
/** The news of ships of relief is told to a power no sooner than this many days after it was last told. */
export const RELIEF_NEWS_REPEAT_DAYS = 360;
/** At most this many powers hear of relief ships in a pass. */
const MAX_RELIEF_NEWS_PER_PASS = 2;
/** The powers named as chief partners, and the goods named as sold and bought. */
const PARTNERS_NAMED = 3;
const GOODS_NAMED = 2;

const nameOf = (world: WorldState, id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
const listed = (names: readonly string[]): string => (names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`);
const goodName = (good: GoodId): string => GOODS.find((spec) => spec.id === good)!.name;
const percent = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/**
 * The line a power's rulers read about its trade, or null where there is
 * nothing to say: no customs laid, no pact or embargo standing, and no
 * shortage that trade is easing or worsening.
 */
export function tradeSummary(world: WorldState, polityId: string): string | null {
  const memory = economyOf(world);
  const customs = memory.customsRates.find((entry) => entry.polityId === polityId)?.rateBps ?? 0;

  // Pacts and embargoes that stand, with the other power named.
  const partners = new Set<string>();
  const pacts: string[] = [];
  const embargoes: string[] = [];
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || (agreement.kind !== "trade_pact" && agreement.kind !== "embargo")) continue;
    if (agreement.polityId !== polityId && agreement.otherPolityId !== polityId) continue;
    const other = agreement.polityId === polityId ? agreement.otherPolityId : agreement.polityId;
    partners.add(other);
    if (agreement.kind === "trade_pact") {
      const terms = tradeTermsBetween(world, polityId, other);
      const cap = agreement.trade?.tariffCapBps;
      pacts.push(`${nameOf(world, other)}${terms.pactSuspended ? " (held by war)" : cap == null ? "" : ` (cap ${percent(cap)})`}`);
    } else {
      const goods = (agreement.trade?.goods ?? []).map(goodName);
      const what = goods.length === 0 ? "all trade" : listed(goods);
      embargoes.push(agreement.polityId === polityId ? `we have embargoed ${what} with ${nameOf(world, other)}` : `${nameOf(world, other)} has embargoed ${what} with us`);
    }
  }

  // What passed through the hubs this power holds last month, and where dear goods were eased or worsened by it.
  const held = new Set(world.map.provinces.filter((province) => province.controllerPolityId === polityId).map((province) => province.id));
  const sold = new Map<GoodId, number>();
  const bought = new Map<GoodId, number>();
  let eased = 0;
  let worsened = 0;
  for (const hub of marketsOf(world)) {
    if (!held.has(hub.hubId)) continue;
    for (const entry of hub.goods) {
      const spec = GOODS.find((candidate) => candidate.id === entry.good)!;
      const worth = spec.basePrice * entry.priceBps / 10_000;
      if (entry.outflow > 0) sold.set(entry.good, (sold.get(entry.good) ?? 0) + entry.outflow * worth);
      if (entry.inflow > 0) bought.set(entry.good, (bought.get(entry.good) ?? 0) + entry.inflow * worth);
      if (entry.priceBps >= DEAR_BPS) {
        if (entry.inflow > 0) eased += 1;
        else if (entry.outflow > 0) worsened += 1;
      }
    }
  }
  if (customs === 0 && pacts.length === 0 && embargoes.length === 0 && eased === 0 && worsened === 0) return null;

  const parts: string[] = [];
  const trades = new Map<string, number>();
  for (const lane of memory.tradeLanes) {
    if (lane.fromPolityId !== polityId && lane.toPolityId !== polityId) continue;
    const other = lane.fromPolityId === polityId ? lane.toPolityId : lane.fromPolityId;
    trades.set(other, (trades.get(other) ?? 0) + lane.value);
  }
  const chief = [...trades.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, PARTNERS_NAMED);
  if (chief.length > 0) parts.push(`partners ${listed(chief.map(([id, value]) => `${nameOf(world, id)} (${inTalents(value)} a month)`))}`);
  const top = (flows: ReadonlyMap<GoodId, number>): string[] => [...flows.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, GOODS_NAMED).map(([good]) => goodName(good));
  if (sold.size > 0) parts.push(`we sell ${listed(top(sold))}`);
  if (bought.size > 0) parts.push(`buy ${listed(top(bought))}`);
  if (customs > 0) parts.push(`customs ${percent(customs)} on foreign goods`);
  if (pacts.length > 0) parts.push(`pacts with ${listed(pacts)}`);
  if (embargoes.length > 0) parts.push(embargoes.join("; "));
  if (eased > 0) parts.push(`trade eases dear goods in ${eased} market${eased === 1 ? "" : "s"}`);
  if (worsened > 0) parts.push(`trade worsens dear goods in ${worsened} market${worsened === 1 ? "" : "s"}`);
  return `Trade: ${parts.join("; ")}.`;
}

export interface ReliefTold {
  readonly polityId: string;
  readonly otherPolityId: string;
  readonly kind: "relief";
  readonly atStep: number;
}

/**
 * Powers whose dear markets grain reached by sea, as news: one fact a power,
 * told no more than once a year and at most twice a pass, the most grain
 * first. `relief` is what the month's flows brought, by the power it reached.
 */
export function reliefNews(world: WorldState, relief: ReadonlyMap<string, { units: number; from: ReadonlySet<string> }>, toDay: number): { readonly facts: FactProposalDraft[]; readonly told: ReliefTold[] } {
  const lastTold = new Map(economyOf(world).tradeNews.filter((entry) => entry.kind === "relief").map((entry) => [entry.polityId, entry.atStep]));
  const candidates = [...relief.entries()]
    .filter(([polityId, kept]) => kept.units >= 1_000 && !(lastTold.has(polityId) && toDay - lastTold.get(polityId)! < RELIEF_NEWS_REPEAT_DAYS))
    .sort((a, b) => b[1].units - a[1].units || a[0].localeCompare(b[0]))
    .slice(0, MAX_RELIEF_NEWS_PER_PASS);
  const facts: FactProposalDraft[] = candidates.map(([polityId, kept]) => {
    const from = [...kept.from].sort();
    return {
      localId: safeLocalId(`relief_ship_${polityId}_${toDay}`).slice(0, 60),
      kind: "relief_ship",
      summary: `Ships with grain have reached ${nameOf(world, polityId)}'s dear markets${from.length === 0 ? "" : ` from ${listed(from.slice(0, 3).map((id) => nameOf(world, id)))}`}: some ${Math.round(kept.units).toLocaleString("en-GB")} measures this month, easing the price of bread.`.slice(0, 600),
      affectedRefs: [{ kind: "polity" as const, id: polityId }, ...from.slice(0, 2).map((id) => ({ kind: "polity" as const, id }))],
      visibility: "public" as const,
      discoveryState: "public" as const,
      knowableInDays: 0,
      significance: 30,
    };
  });
  return { facts, told: candidates.map(([polityId, kept]) => ({ polityId, otherPolityId: [...kept.from].sort()[0] ?? polityId, kind: "relief" as const, atStep: toDay })) };
}
