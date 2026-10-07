import {
  GOODS,
  GOOD_COUNT,
  MAX_STOCK_MONTHS,
  customsOn,
  economyOf,
  isOccupied,
  marketGeography,
  mayTradeGood,
  priceBpsFrom,
  provinceGrounds,
  taxPolicyIndex,
  tradeTermsBetween,
  warsOf,
  type CrossingType,
  type GoodId,
  type HubLink,
  type Province,
  type ProvinceMaterial,
  type TradeBetween,
  type WorldState,
} from "@chronica/shared";
import type { Book, HubBook } from "./markets";

/**
 * Goods between markets (phase D of the economy rework).
 *
 * Every hub had been a country of its own: a bad harvest in one was a famine
 * there however full the granaries next door, a price at the bounds stayed
 * there for want of anybody to carry the difference, and a tariff or a pact
 * had nothing to bite. Once a month, after the hubs have made and used their
 * goods, goods now move between adjacent hubs, and they move for the reason
 * they do in life: somebody can buy them cheap in one place and sell them dear
 * in another.
 *
 * For each pair of neighbouring hubs (the graph the map's edges give, a pair
 * once, in id order) and each good, the cheaper market sells to the dearer
 * until the gap in price is no more than what it costs to carry them: so much
 * a hundred kilometres by the good's own bulk (grain and timber dear, cloth and
 * metal cheap), less by river and much less by water, less again where the two
 * ends are developed (roads and harbours), more where war has made the way
 * unsafe, and then the customs the buying power lays. Three things bound what
 * moves: the carriers' capacity on the way (a share of what the buying hub uses
 * in a month, larger by water, larger where the ends are developed), what the
 * selling hub can spare (it never sells below what it keeps for itself; for
 * grain that is what its people need to reach the next harvest and two months
 * more, which no price can buy), and the price itself, which closes the gap as
 * it moves.
 *
 * Whether goods may cross at all is the powers' business: war shuts the way,
 * an embargo shuts it for what it names, a pact lowers the customs
 * (`tradeTermsBetween`). A hub that is besieged, occupied or blockaded sends
 * nothing out, takes goods in only at a heavy price, and a harbour under a
 * tight blockade has no sea trade at all.
 *
 * It is O(hubs x neighbours x goods) a month (some seventy hubs, a couple of
 * hundred links, six goods) and writes only the hubs' stocks, prices and the
 * month's volumes, which stay on the hub for the readers of trade.
 */

// ── What it costs to carry ─────────────────────────────────────────────────

/**
 * What a hundred kilometres of land costs to carry a unit, as basis points of
 * the good's base price. Diocletian's edict has a wagon doubling the price of
 * grain in some five hundred miles and a donkey cart a good deal quicker, so
 * grain at fifteen in a hundred a hundred kilometres is the middle of it; bars,
 * and above all cloth, carry cheaply for what they are worth; slaves walk.
 */
export const LAND_HAUL_BPS_PER_100_KM: Readonly<Record<GoodId, number>> = {
  grain: 1_500,
  timber: 1_500,
  oil_wine: 700,
  metals: 350,
  textiles: 150,
  slaves: 120,
};

/** What a crossing costs against the same length of land: a river a little under half, a strait a quarter, the open sea an eighth; a mountain pass dearer. */
export const CROSSING_COST_SHARE: Readonly<Record<CrossingType, number>> = { land: 1, pass: 1.4, river: 0.4, strait: 0.25, sea_lane: 0.12 };
/** How much a way can carry in a month, as a share of what the buying hub uses in one, by its crossing. */
export const CROSSING_CAPACITY_SHARE: Readonly<Record<CrossingType, number>> = { land: 0.4, pass: 0.2, river: 0.7, strait: 1, sea_lane: 1.2 };

/** Grain by water into a hub where it sells at this much of its ordinary price or more is a relief ship. */
export const RELIEF_PRICE_BPS = 14_000;
/** The most a hub sends out of any one good in a month, over all its roads, as a share of what its own country uses in a month. */
export const EXPORT_SHARE_OF_USE = 0.5;
/** Of what the selling hub means to hold, the share it will not sell below, for every good but grain. */
export const RESERVE_SHARE = 0.7;
/** The months of grain a hub keeps for itself beyond what its people need to reach the next harvest, however high the price abroad. */
export const GRAIN_PROTECTED_MONTHS = 2;
/** A blockade tighter than this shuts a harbour's sea trade altogether; looser, it makes it dearer by the share left open. */
export const BLOCKADE_SHUTS_AT_BPS = 9_000;
/** The share a power's portoria is of the rate of a province taxed by customs: a province at the default tenth levies 2.5 in a hundred on what passes. */
export const PORTORIA_DIVISOR = 4;

const GRAIN = 0;

/**
 * How open a trading end is, in basis points: whole in peace; a third when its
 * holder is at war; a fifth when it is occupied by somebody else or under
 * blockade. What a war abroad does to a merchant who never sees it. (Moved
 * here from the tick, which still exports it: the flows and the ventures read
 * the same openness.)
 */
export function routeOpenBps(world: WorldState, provinceId: string): number {
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  if (province === undefined || province.controllerPolityId === null) return 10_000;
  const blockaded = world.blockades.some((blockade) => blockade.provinceId === provinceId && blockade.status === "active");
  return openBpsOf(world, province, blockaded);
}

function openBpsOf(world: Pick<WorldState, "polityAgreements">, province: Pick<Province, "controllerPolityId" | "ownerPolityId">, blockaded: boolean, wars?: Map<string, boolean>): number {
  if (province.controllerPolityId === null) return 10_000;
  if (isOccupied(province) || blockaded) return 2_000;
  const known = wars?.get(province.controllerPolityId);
  const atWar = known ?? warsOf(world.polityAgreements, province.controllerPolityId).length > 0;
  wars?.set(province.controllerPolityId, atWar);
  return atWar ? 3_500 : 10_000;
}

export interface FlowInput {
  readonly world: WorldState;
  /** The month's rows, for a hub's development and the regime it is taxed by. */
  readonly rows: ReadonlyMap<string, ProvinceMaterial>;
  /** Hubs a siege, an occupation or a blockade has shut. */
  readonly cut: ReadonlySet<string>;
  /** Months until grain next comes in: what a hub must keep to get there. */
  readonly toHarvest: number;
}

export interface FlowResult {
  /** Customs earned this pass by the power whose hub the goods entered, in drachmae. */
  readonly duties: Map<string, number>;
  /** What crossed between powers this month, by value in drachmae, `from>to`. */
  readonly lanes: Map<string, number>;
  /** Units moved, by good, over the whole pass. */
  readonly moved: number[];
  /**
   * Grain that came by water into a hub where it was dear (`RELIEF_PRICE_BPS`),
   * by the power the hub belongs to, with the powers it came from: what a
   * "relief ship" is in the news.
   */
  readonly relief: Map<string, { units: number; from: Set<string> }>;
}

interface HubState {
  readonly polity: string | null;
  readonly provinceId: string;
  readonly development: number;
  readonly open: number;
  /** 0 to 10 000: how tight a fleet holds the harbour. */
  readonly blockade: number;
  readonly cut: boolean;
  /** The portoria its policy lays on whatever enters it, from within or without the power. */
  readonly portoriaBps: number;
}

/** The most of `q` that can move from a seller to a buyer before the gap in price (net of customs) is no more than the cost of carrying. */
function worthMoving(spec: (typeof GOODS)[number], sellerStock: number, sellerTarget: number, buyerStock: number, buyerTarget: number, customs: number, cost: number, most: number): number {
  const gap = (q: number): number => priceBpsFrom(spec, buyerStock + q, buyerTarget) * (1 - customs / 10_000) - priceBpsFrom(spec, sellerStock - q, sellerTarget) - cost;
  if (most < 1 || gap(0) <= 0) return 0;
  if (gap(most) > 0) return most;
  let low = 0;
  let high = most;
  for (let step = 0; step < 16; step += 1) {
    const middle = (low + high) / 2;
    if (gap(middle) > 0) low = middle;
    else high = middle;
  }
  return Math.floor(low);
}

/**
 * One month of trade between the hubs of a book. Mutates the book (stocks,
 * prices, the month's volumes) and says what customs it earned and what crossed
 * between powers.
 */
export function tradeMonth(book: Book, input: FlowInput): FlowResult {
  const { world } = input;
  const geography = marketGeography(world);
  const grounds = provinceGrounds(world);
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  const memory = economyOf(world);
  const rates = new Map(memory.customsRates.map((entry) => [entry.polityId, entry.rateBps]));
  const policyOf = taxPolicyIndex(world);
  const blockades = new Map<string, number>();
  for (const blockade of world.blockades) {
    if (blockade.status === "active") blockades.set(blockade.provinceId, Math.max(blockades.get(blockade.provinceId) ?? 0, blockade.tightnessBps));
  }
  const wars = new Map<string, boolean>();
  const states = new Map<string, HubState>();
  for (const hubId of geography.hubs) {
    const province = provinces.get(hubId);
    if (province === undefined) continue;
    const row = input.rows.get(hubId);
    const policy = policyOf(province, row);
    states.set(hubId, {
      polity: province.controllerPolityId,
      provinceId: hubId,
      development: row?.developmentBps ?? grounds.get(hubId)?.startingDevelopmentBps ?? 5_000,
      open: openBpsOf(world, province, blockades.has(hubId), wars),
      blockade: blockades.get(hubId) ?? 0,
      cut: input.cut.has(hubId),
      portoriaBps: policy.explicit && policy.regime === "customs" ? Math.round(policy.rateBps / PORTORIA_DIVISOR) : 0,
    });
  }
  const terms = new Map<string, TradeBetween>();
  const termsOf = (a: string, b: string): TradeBetween => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let known = terms.get(key);
    if (known === undefined) {
      known = tradeTermsBetween(world, a, b);
      terms.set(key, known);
    }
    return known;
  };

  const result: FlowResult = { duties: new Map(), lanes: new Map(), moved: new Array<number>(GOOD_COUNT).fill(0), relief: new Map() };
  for (const hub of book.values()) {
    hub.inflow.fill(0);
    hub.outflow.fill(0);
  }
  for (const aId of geography.hubs) {
    const a = states.get(aId);
    const bookA = book.get(aId);
    if (a === undefined || bookA === undefined) continue;
    for (const link of geography.neighbours.get(aId) ?? []) {
      if (link.hubId < aId) continue;
      const b = states.get(link.hubId);
      const bookB = book.get(link.hubId);
      if (b === undefined || bookB === undefined) continue;
      routeMonth(book, input, result, { aId, a, bookA, bId: link.hubId, b, bookB, link, rates, termsOf });
    }
  }
  return result;
}

interface Route {
  readonly aId: string;
  readonly a: HubState;
  readonly bookA: HubBook;
  readonly bId: string;
  readonly b: HubState;
  readonly bookB: HubBook;
  readonly link: HubLink;
  readonly rates: ReadonlyMap<string, number>;
  readonly termsOf: (a: string, b: string) => TradeBetween;
}

/** One pair of hubs, every good, whichever way it pays. */
function routeMonth(_book: Book, input: FlowInput, result: FlowResult, route: Route): void {
  const { a, b, link } = route;
  const sea = link.crossing === "sea_lane" || link.crossing === "strait";
  // A fleet holding either harbour tightly shuts the water; a looser one makes it dearer.
  const seaOpen = sea ? Math.min(10_000 - a.blockade, 10_000 - b.blockade) : 10_000;
  if (sea && seaOpen < 10_000 - BLOCKADE_SHUTS_AT_BPS) return;
  const open = Math.max(500, Math.min(a.open, b.open)) * (seaOpen / 10_000);
  const kmShare = (link.km - link.crossingKm + link.crossingKm * CROSSING_COST_SHARE[link.crossing]) / 100;
  // Roads and harbours at both ends: from a quarter dearer at no development to a quarter cheaper at the most.
  const average = (a.development + b.development) / 2;
  const road = 1.25 - 0.5 * (average / 10_000);
  const carry = (0.5 + average / 10_000) * CROSSING_CAPACITY_SHARE[link.crossing];
  const crossPolity = a.polity !== null && b.polity !== null && a.polity !== b.polity;
  const terms = crossPolity ? route.termsOf(a.polity!, b.polity!) : undefined;
  if (terms !== undefined && terms.closed !== null) return;
  for (let index = 0; index < GOOD_COUNT; index += 1) {
    const spec = GOODS[index]!;
    if (terms !== undefined && !mayTradeGood(terms, spec.id)) continue;
    const haul = kmShare * LAND_HAUL_BPS_PER_100_KM[spec.id] * road * (10_000 / open);
    // Which way it would go: to the dearer market, net of what the buyer's customs take.
    const gapTo = (buyer: HubState, buyerPrice: number, sellerPrice: number): number => buyerPrice * (1 - dutyOn(buyer, spec.id) / 10_000) - sellerPrice - haul;
    const dutyOn = (buyer: HubState, good: GoodId): number => {
      const seller = buyer === a ? b : a;
      if (crossPolity && terms !== undefined) return customsOn(terms, route.rates.get(buyer.polity!) ?? 0, good);
      return seller.polity === buyer.polity ? buyer.portoriaBps : 0;
    };
    const priceA = route.bookA.price[index]!;
    const priceB = route.bookB.price[index]!;
    const toB = gapTo(b, priceB, priceA);
    const toA = gapTo(a, priceA, priceB);
    if (toB <= 0 && toA <= 0) continue;
    const intoB = toB >= toA;
    const [seller, buyer, sellerBook, buyerBook] = intoB
      ? [a, b, route.bookA, route.bookB] as const
      : [b, a, route.bookB, route.bookA] as const;
    // A shut hub sends nothing out.
    if (seller.cut) continue;
    const demand = buyerBook.demand[index]!;
    if (demand <= 0) continue;
    const reserve = index === GRAIN ? (input.toHarvest + GRAIN_PROTECTED_MONTHS) * sellerBook.demand[GRAIN]! : RESERVE_SHARE * sellerBook.target[index]!;
    const spare = Math.max(0, sellerBook.stock[index]! - reserve);
    const room = Math.max(0, MAX_STOCK_MONTHS * Math.max(1, demand) - buyerBook.stock[index]!);
    // Carriers take more of what is small for its worth (the root of how much dearer grain is to haul).
    // And a hub's merchants have only so many hulls and carts to send out in a month, whoever asks.
    const sendable = Math.max(0, EXPORT_SHARE_OF_USE * sellerBook.demand[index]! - sellerBook.outflow[index]!);
    const most = Math.min(spare, room, sendable, demand * carry * Math.sqrt(LAND_HAUL_BPS_PER_100_KM.grain / LAND_HAUL_BPS_PER_100_KM[spec.id]));
    const duty = dutyOn(buyer, spec.id);
    const moved = worthMoving(spec, sellerBook.stock[index]!, sellerBook.target[index]!, buyerBook.stock[index]!, buyerBook.target[index]!, duty, haul, most);
    if (moved < 1) continue;
    // Bread by sea to a hub where it is dear is a relief ship, and news.
    if (index === GRAIN && sea && buyer.polity !== null && buyerBook.price[index]! >= RELIEF_PRICE_BPS) {
      const kept = result.relief.get(buyer.polity) ?? { units: 0, from: new Set<string>() };
      kept.units += moved;
      if (seller.polity !== null) kept.from.add(seller.polity);
      result.relief.set(buyer.polity, kept);
    }
    sellerBook.stock[index]! -= moved;
    buyerBook.stock[index]! += moved;
    sellerBook.price[index] = priceBpsFrom(spec, sellerBook.stock[index]!, sellerBook.target[index]!);
    buyerBook.price[index] = priceBpsFrom(spec, buyerBook.stock[index]!, buyerBook.target[index]!);
    sellerBook.outflow[index]! += moved;
    buyerBook.inflow[index]! += moved;
    result.moved[index]! += moved;
    // What it fetched where it landed.
    const value = moved * spec.basePrice * (buyerBook.price[index]! / 10_000);
    if (crossPolity) {
      const key = `${seller.polity!}>${buyer.polity!}`;
      result.lanes.set(key, (result.lanes.get(key) ?? 0) + value);
    }
    if (duty > 0 && buyer.polity !== null) result.duties.set(buyer.polity, (result.duties.get(buyer.polity) ?? 0) + (value * duty) / 10_000);
  }
}
