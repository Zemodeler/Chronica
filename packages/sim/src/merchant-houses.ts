import {
  GOODS,
  atWar,
  economyOf,
  hasPort,
  hubOf,
  isOccupied,
  isLiveProvince,
  kmFromAny,
  marketEntry,
  marketGeography,
  priceInDrachmae,
  drawStock,
  tradePremiumBps,
  tradeTermsBetween,
  type FactProposalDraft,
  type GoodId,
  type MerchantHouse,
  type MoneyTransaction,
  type Province,
  type TradeVenture,
  type WorldState,
  MAX_VENTURES_PER_HOUSE,
} from "@chronica/shared";
import { keepTheSeats } from "./house-seat";
import { foundHousesByRule } from "./house-founding";
import { keepTheLine } from "./house-succession";
import { keepTheTutelage } from "./house-tutelage";
import { CREW_SHARE_BPS, dutyOnCargoBps, voyageLossBps } from "./house-voyages";
import type { IdFactory } from "./ports";
import { safeLocalId } from "./safe-local-id";

/**
 * The merchant houses (docs/economy.md, "Who manages the economy").
 *
 * The trade of the Mediterranean was an aggregate: goods moved between markets because they were dearer in
 * one than in the next, and nobody moved them. A dozen families now do. Each house is a head, a purse, a home
 * market and a habit: once a month it looks for the gap in prices it can carry goods across and, where there
 * is one worth the risk, buys the goods out of one hub's stock, sends them to the other as an ordinary
 * `TradeVenture` with a cargo (so the sale, the crew, the duty and the loss are all `cargoes.ts`'s), and
 * leaves the far hub's stock the richer by them when they land. A house with money to spare lends to its
 * power's treasury when the treasury's own officer asks (`fiscal-officers.ts`); a house that has had a good
 * year carries more, and a hub with houses has more carrying capacity (`merchantLiftByHub`).
 *
 * **Performance.** Aggregate and bounded: at most `MAX_VENTURES_PER_HOUSE` cargoes a house, at most two
 * opened a month, the hubs' prices read once into a table, one Dijkstra a house a month. A world with twenty
 * houses costs a few milliseconds a month, and a world with none costs a length check.
 *
 * **Money.** Nothing is made except what the markets pay a cargo, which is the `market` door already open. A
 * house's household and its liturgies (a share of its purse a month) leave as wages to the men nobody names and
 * as a tax to its power's treasury, so its capital does not run away; the duty and the crew come off each sale
 * (`house-voyages.ts`).
 */

/** The most cargoes a house starts in a month. */
const MAX_OPENED_PER_MONTH = 2;
/** What a house keeps in hand: this much, or this share of its purse, whichever is the more. */
const RESERVE_FLOOR = 6_000;
const RESERVE_SHARE = 0.35;
/** The most one cargo costs, and the share of the purse it may be. */
const MAX_STAKE = 36_000;
const MAX_STAKE_SHARE = 0.28;
/** Too small a cargo is not worth a ship. */
const MIN_STAKE = 2_500;
/** What a house must have in its purse to sail a cargo at all: what it keeps in hand, and the least a cargo is. Below it the firm sits idle (`house_found` says so). */
export const HOUSE_SAILING_FLOOR = RESERVE_FLOOR + MIN_STAKE;
export const HOUSE_RESERVE_IN_HAND = RESERVE_FLOOR;
/** A price gap this much over even (basis points of premium) is the least a house sails for. */
const MIN_PREMIUM_BPS = 10_400;
/** What it must expect to clear over its cost, after losses, crew and duty, to sail: basis points. */
const MIN_EXPECTED_BPS = 700;
/** How far a house looks for a market, in the map's kilometres. */
const MAX_REACH_KM = 1_700;
/** How far from an inland home a house's factor sits at the nearest port. */
const PORT_REACH_KM = 260;
/** How many of the most promising pairs a house weighs closely. */
const FINALISTS = 4;
/** Of a hub's spare stock, the share one house will buy in a month. */
const STOCK_SHARE = 0.3;
/** A house's cargo that was sold or lost this long ago is forgotten. */
const SPENT_AFTER_DAYS = 60;
/** What a hub keeps of its target for itself, of every good but bread (which keeps all of it). */
const KEEP_SHARE = 0.9;
/** Fewer units than this are not a cargo. */
const MIN_UNITS = 12;
/** What a house spends on itself a month, of its purse (basis points). Its liturgies come off each cargo's profit (`cargoes.ts`). */
const HOUSEHOLD_BPS = 110;
/** A purse this small pays neither. */
const HOUSEHOLD_FLOOR = 25_000;
/** A hub's carrying capacity grows by up to this much with the capital of the houses seated in it. */
export const MAX_MERCHANT_LIFT = 0.5;
/** The capital in a hub's houses at which the lift is at its most. */
export const LIFT_AT_CAPITAL = 800_000;
const GRAIN_RELIEF_AT_BPS = 12_000;
const GRAIN_RELIEF_BONUS_BPS = 1_500;

/**
 * The heads and heirs of the merchant houses: people who run on rules and are no part of a power's figures, a page's cast of
 * characters or the places that matter to a player (`slice.ts`), nor of the people the model is asked about (`cognition-policy.ts`),
 * unless they hold an office or the player's own circle touches them.
 */
export function houseFolkOf(world: Pick<WorldState, "economy" | "characters">): ReadonlySet<string> {
  const houses = world.economy?.houses;
  if (houses === undefined || houses.length === 0) return NO_ONE;
  const folk = new Set<string>();
  for (const house of houses) {
    folk.add(house.headCharacterId);
    const heir = world.characters.find((character) => character.id === house.headCharacterId)?.heirCharacterId;
    if (heir !== undefined && heir !== null) folk.add(heir);
  }
  return folk;
}
const NO_ONE: ReadonlySet<string> = new Set();

/** The purse of a house: its head's. */
export function purseOfHouse(world: WorldState, house: MerchantHouse): { readonly id: string; readonly balance: number; readonly active: boolean } | null {
  const head = world.characters.find((character) => character.id === house.headCharacterId);
  const purse = head === undefined ? undefined : world.material.accounts.find((account) => account.id === head.personalAccountId);
  return purse === undefined ? null : { id: purse.id, balance: purse.balance, active: purse.status === "active" };
}

/** The money a house has working: its purse and the cost of the cargoes it has out. */
export function capitalOfHouse(world: WorldState, house: MerchantHouse): number {
  const purse = purseOfHouse(world, house);
  const out = world.material.ventures.reduce((sum, venture) => (venture.ownerCharacterId === house.headCharacterId && venture.status === "running" ? sum + (venture.cargo?.cost ?? 0) : sum), 0);
  return Math.max(0, purse?.balance ?? 0) + out;
}

/**
 * How much more each hub can carry in a month for the houses seated in it, as a multiplier (1 to 1.5): the
 * capital of a hub's houses over `LIFT_AT_CAPITAL`, of `MAX_MERCHANT_LIFT`. Read by the trade flows, which
 * multiply a route's carrying capacity and what a hub's merchants can send out by it. Empty where no house is.
 */
export function merchantLiftByHub(world: WorldState): Map<string, number> {
  const lift = new Map<string, number>();
  const houses = world.economy?.houses;
  if (houses === undefined || houses.length === 0) return lift;
  const capital = new Map<string, number>();
  for (const house of houses) {
    if (house.status !== "trading") continue;
    const hub = hubOf(world, house.homeProvinceId);
    if (hub === null) continue;
    capital.set(hub, (capital.get(hub) ?? 0) + capitalOfHouse(world, house));
  }
  for (const [hub, sum] of capital) lift.set(hub, 1 + MAX_MERCHANT_LIFT * Math.min(1, sum / LIFT_AT_CAPITAL));
  return lift;
}

/**
 * How far each hub is from every province within a budget, by the map's own distances: geography, which does not change as
 * the months pass, so it is read once for a hub and kept for as long as the map's edges are (the same key the markets' own
 * geography is kept by). One Dijkstra a house in the whole game and not one a house a month.
 */
const reachCache = new WeakMap<object, Map<string, ReadonlyMap<string, number>>>();
function reachFrom(world: WorldState, provinceId: string, budgetKm: number): ReadonlyMap<string, number> {
  let byHub = reachCache.get(world.map.edges);
  if (byHub === undefined) { byHub = new Map(); reachCache.set(world.map.edges, byHub); }
  const key = `${provinceId}|${budgetKm}`;
  let reach = byHub.get(key);
  if (reach === undefined) { reach = kmFromAny(world, [provinceId], { budgetKm }); byHub.set(key, reach); }
  return reach;
}

interface Pair {
  readonly from: string;
  readonly to: string;
  readonly good: GoodId;
  readonly premium: number;
  readonly km: number;
  readonly score: number;
}

/** The house's factor sits in its home market where that is a port, else at the nearest port hub within reach. */
function tradingHubOf(world: WorldState, house: MerchantHouse, ports: readonly string[]): string | null {
  const home = hubOf(world, house.homeProvinceId);
  if (home !== null && hasPort(world, home)) return home;
  const near = reachFrom(world, house.homeProvinceId, PORT_REACH_KM);
  let best: string | null = null;
  let bestKm = Infinity;
  for (const port of ports) {
    const km = near.get(port);
    if (km !== undefined && (km < bestKm || (km === bestKm && best !== null && port < best))) { best = port; bestKm = km; }
  }
  return best;
}

/**
 * The good that pays most to carry between two hubs, off a price table: the one whose price at the far end
 * most exceeds its price at the near end, weighed as `bestGapGood` weighs it (by the root of its base price).
 */
function bestGoodOn(prices: ReadonlyMap<string, readonly number[]>, spare: ReadonlyMap<string, readonly number[]>, from: string, to: string): { good: GoodId; fromBps: number; toBps: number } | null {
  const a = prices.get(from);
  const b = prices.get(to);
  const can = spare.get(from);
  if (a === undefined || b === undefined || can === undefined) return null;
  let best: { good: GoodId; fromBps: number; toBps: number } | null = null;
  let bestGap = -Infinity;
  for (let index = 0; index < GOODS.length; index += 1) {
    const spec = GOODS[index]!;
    // Only what the hub can spare: a house buys out of stock, and a market that holds none to spare sells it none.
    if (can[index]! < MIN_UNITS / STOCK_SHARE) continue;
    const gap = ((b[index]! - a[index]!) / 10_000) * Math.sqrt(spec.basePrice);
    if (gap > bestGap) { bestGap = gap; best = { good: spec.id, fromBps: a[index]!, toBps: b[index]! }; }
  }
  return best;
}

/** Everything one month of the houses needs to read about the world, built once. */
interface Month {
  readonly provinces: ReadonlyMap<string, Province>;
  readonly prices: ReadonlyMap<string, readonly number[]>;
  /** What each hub holds above what it keeps for itself, in units, by good. */
  readonly spare: ReadonlyMap<string, readonly number[]>;
  readonly ports: readonly string[];
  readonly blockaded: ReadonlySet<string>;
  readonly polityAt: (provinceId: string) => string | null;
}

export function readTheMonth(world: WorldState): Month {
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  const prices = new Map<string, readonly number[]>();
  const spare = new Map<string, readonly number[]>();
  for (const hub of economyOf(world).markets) {
    prices.set(hub.hubId, GOODS.map((spec) => hub.goods.find((entry) => entry.good === spec.id)?.priceBps ?? 10_000));
    spare.set(hub.hubId, GOODS.map((spec) => {
      const entry = hub.goods.find((candidate) => candidate.good === spec.id);
      return entry === undefined ? 0 : Math.max(0, entry.stock - (spec.id === "grain" ? entry.target : entry.target * KEEP_SHARE));
    }));
  }
  const ports = marketGeography(world).hubs.filter((hub) => prices.has(hub) && hasPort(world, hub));
  const blockaded = new Set(world.blockades.filter((blockade) => blockade.status === "active").map((blockade) => blockade.provinceId));
  return { provinces, prices, spare, ports, blockaded, polityAt: (id) => provinces.get(id)?.controllerPolityId ?? null };
}

/**
 * The best cargoes a house could send this month, best first: pairs of ports within reach, in both
 * directions, where a good is dearer at the far end by enough to pay the voyage, the risk, the crew
 * and the duty. War between the two powers, an embargo on the good, a blockade or an occupation at
 * either end shuts a pair. Ranked by what a day's voyage earns.
 */
export function pairsFor(world: WorldState, house: MerchantHouse, month: Month, headPolityId: string | null, skip: ReadonlySet<string>): Pair[] {
  const hub = tradingHubOf(world, house, month.ports);
  if (hub === null) return [];
  const reach = reachFrom(world, hub, MAX_REACH_KM);
  const ownTerms = new Map<string, ReturnType<typeof tradeTermsBetween>>();
  const termsWith = (polityId: string | null): ReturnType<typeof tradeTermsBetween> | null => {
    if (polityId === null || headPolityId === null || polityId === headPolityId) return null;
    let known = ownTerms.get(polityId);
    if (known === undefined) { known = tradeTermsBetween(world, headPolityId, polityId); ownTerms.set(polityId, known); }
    return known;
  };
  const found: Pair[] = [];
  const shut = (id: string): boolean => {
    const province = month.provinces.get(id);
    return province === undefined || month.blockaded.has(id) || isOccupied(province);
  };
  if (shut(hub)) return [];
  for (const other of month.ports) {
    if (other === hub) continue;
    const km = reach.get(other);
    if (km === undefined || shut(other)) continue;
    const terms = termsWith(month.polityAt(other));
    if (terms !== null && terms.closed !== null) continue;
    const enemy = headPolityId !== null && month.polityAt(other) !== null && month.polityAt(other) !== headPolityId && atWar(world.polityAgreements, headPolityId, month.polityAt(other)!);
    if (enemy) continue;
    for (const [from, to] of [[hub, other], [other, hub]] as const) {
      const pick = bestGoodOn(month.prices, month.spare, from, to);
      if (pick === null) continue;
      if (terms !== null && terms.forbidden.includes(pick.good)) continue;
      const premium = tradePremiumBps(pick.fromBps, pick.toBps);
      if (premium < MIN_PREMIUM_BPS) continue;
      if (skip.has(`${from}>${to}`)) continue;
      const days = Math.min(60, Math.max(2, Math.ceil(km / 90)) + 10);
      const reliefBonus = pick.good === "grain" && pick.toBps >= GRAIN_RELIEF_AT_BPS ? GRAIN_RELIEF_BONUS_BPS : 0;
      const margin = 2_500 + Math.round((premium - 10_000) * 0.5) + reliefBonus - Math.max(0, days - 10) * 10;
      found.push({ from, to, good: pick.good, premium, km, score: (margin * 30) / days });
    }
  }
  return found.sort((a, b) => b.score - a.score || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

/** What a house expects to clear on a pair, in basis points of the cost: the margin, less the risk, the crew and the duty. */
function expectedBps(world: WorldState, pair: Pair, headPolityId: string | null, month: Month): number {
  const days = Math.min(60, Math.max(2, Math.ceil(pair.km / 90)) + 10);
  const open = (id: string): number => {
    const province = month.provinces.get(id);
    const holder = province?.controllerPolityId ?? null;
    return holder !== null && warActive(world, holder) ? 3_500 : 10_000;
  };
  const loss = voyageLossBps(true, days, open(pair.from), open(pair.to));
  const reliefBonus = pair.good === "grain" && (month.prices.get(pair.to)?.[0] ?? 0) >= GRAIN_RELIEF_AT_BPS ? GRAIN_RELIEF_BONUS_BPS : 0;
  const margin = 2_500 + Math.round((pair.premium - 10_000) * 0.5) + reliefBonus - Math.max(0, days - 10) * 10;
  const duty = dutyOnCargoBps(world, headPolityId, month.polityAt(pair.to), pair.good);
  return Math.round(((10_000 - loss) * (10_000 + margin)) / 10_000) - 10_000 - CREW_SHARE_BPS - duty;
}

const warCache = new WeakMap<WorldState, Map<string, boolean>>();
function warActive(world: WorldState, polityId: string): boolean {
  let known = warCache.get(world);
  if (known === undefined) { known = new Map(); warCache.set(world, known); }
  let at = known.get(polityId);
  if (at === undefined) {
    at = world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "war" && (agreement.polityId === polityId || agreement.otherPolityId === polityId));
    known.set(polityId, at);
  }
  return at;
}

const nameOfProvince = (world: WorldState, id: string): string => {
  const province = world.map.provinces.find((candidate) => candidate.id === id);
  return province?.settlements.find((settlement) => settlement.kind === "port")?.name ?? province?.name ?? id;
};

/**
 * Once a month, every trading house looks to its business. In id order, deterministic:
 *
 *  1. A head who has died is followed by the heir he named, if the heir lives; a house with nobody to follow
 *     him is wound up, and its name is not heard again.
 *  2. The household and the liturgy: a share of a rich purse leaves as wages and as a tax to its power.
 *  3. With room in its fleet (`MAX_VENTURES_PER_HOUSE`) and money to spare it buys goods out of a hub's stock
 *     and sends them where the price is best (`pairsFor`), and the cargo is a `TradeVenture` like any other.
 */
export function keepMerchantHouses(first: WorldState, toDay: number, ids: IdFactory, playerCharacterId: string | null = null): { world: WorldState; facts: FactProposalDraft[] } {
  // A rich man with a merchant's mind may found a house, once a month (`house-founding.ts`); the man the model plays does not unless he orders it.
  const founded = foundHousesByRule(first, toDay, ids, playerCharacterId);
  const start = founded.world;
  // Before the cargoes, the house's own affairs: its seat and power follow its head, and a head with nobody to follow him has one
  // named (`house-seat.ts`, `house-succession.ts`). Only houses whose month has come.
  const due = new Set(economyOf(start).houses.filter((house) => house.status === "trading" && toDay - house.actedAtStep >= 30).map((house) => house.id));
  if (due.size === 0) return { world: start, facts: founded.facts };
  const line = keepTheLine(start, toDay, ids, due);
  const tutelage = keepTheTutelage(line.world, toDay, ids, due);
  const seats = keepTheSeats(tutelage.world, toDay, ids, due);
  const cargoes = keepTheCargoes(seats.world, toDay, ids);
  return { world: cargoes.world, facts: [...founded.facts, ...line.facts, ...tutelage.facts, ...seats.facts, ...cargoes.facts] };
}

function keepTheCargoes(world: WorldState, toDay: number, ids: IdFactory): { world: WorldState; facts: FactProposalDraft[] } {
  const memory = economyOf(world);
  const standing = memory.houses.filter((house) => house.status === "trading");
  if (standing.length === 0) return { world, facts: [] };
  const due = standing.filter((house) => toDay - house.actedAtStep >= 30);
  if (due.length === 0) return { world, facts: [] };

  const facts: FactProposalDraft[] = [];
  let current = world;
  let accounts = world.material.accounts;
  const transactions: MoneyTransaction[] = [];
  const newVentures: TradeVenture[] = [];
  const newSources: typeof world.material.incomeSources = [];
  const characters = world.characters;
  const month = readTheMonth(world);
  const changed = new Map<string, MerchantHouse>();
  const told = (house: MerchantHouse, summary: string, significance: number, kind: string, refs: { kind: "character" | "province"; id: string }[]): void => {
    if (toDay - (house.toldAtStep ?? -999) < 90 || !isLiveProvince(world, house.homeProvinceId)) return;
    facts.push({ localId: safeLocalId(`${kind}_${house.id}_${toDay}`).slice(0, 60), kind, summary: summary.slice(0, 600), affectedRefs: refs, visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance });
    changed.set(house.id, { ...(changed.get(house.id) ?? house), toldAtStep: toDay });
  };

  for (const start of due) {
    let house = changed.get(start.id) ?? start;
    house = { ...house, actedAtStep: toDay };
    changed.set(house.id, house);
    // ── 1. The head ────────────────────────────────────────────────────
    let head = characters.find((character) => character.id === house.headCharacterId);
    if (head === undefined || !head.alive) {
      const heir = head?.heirCharacterId == null ? undefined : characters.find((character) => character.id === head!.heirCharacterId);
      if (heir !== undefined && heir.alive) {
        house = { ...house, headCharacterId: heir.id };
        changed.set(house.id, house);
        told(house, `${heir.name} takes up ${house.name} after ${head?.name ?? "its head"}; the cargoes sail on.`, 32, "house_succeeds", [{ kind: "character", id: heir.id }, { kind: "province", id: house.homeProvinceId }]);
        head = heir;
      } else {
        house = { ...house, status: "wound_up" };
        changed.set(house.id, house);
        told(house, `${house.name} is wound up: its head is dead and nobody takes the books.`, 35, "house_ends", [{ kind: "province", id: house.homeProvinceId }]);
        continue;
      }
    }
    const purse = accounts.find((account) => account.id === head!.personalAccountId);
    if (purse === undefined || purse.status !== "active") continue;
    const polityId = head.polityId;

    // ── 2. The household ───────────────────────────────────────────────
    if (purse.balance > HOUSEHOLD_FLOOR) {
      const over = purse.balance;
      const household = Math.round((over * HOUSEHOLD_BPS) / 10_000);
      if (household > 0) {
        accounts = accounts.map((account) => (account.id === purse.id ? { ...account, balance: account.balance - household } : account));
        transactions.push({
          id: ids.next("txn"), atStep: toDay, kind: "upkeep", amount: household, sourceAccountId: purse.id, external: "the_unnamed",
          cause: { kind: "action", id: house.id, explanation: `The household and the servants of ${house.name}`.slice(0, 240) }, visibility: "private",
        });
      }
    }

    // ── 3. The cargoes ─────────────────────────────────────────────────
    // Nothing to buy where no market has been reckoned yet.
    if (memory.markets.length === 0) continue;
    const mine = world.material.ventures.filter((venture) => venture.ownerCharacterId === head!.id && venture.status === "running");
    const opened = newVentures.filter((venture) => venture.ownerCharacterId === head!.id);
    let slots = Math.min(MAX_OPENED_PER_MONTH, MAX_VENTURES_PER_HOUSE - mine.length - opened.length);
    if (slots <= 0) continue;
    const skip = new Set([...mine, ...opened].map((venture) => `${venture.fromProvinceId}>${venture.toProvinceId}`));
    const finalists = pairsFor(current, house, month, polityId, skip).slice(0, FINALISTS)
      .map((pair) => ({ pair, expected: expectedBps(current, pair, polityId, month) }))
      .filter((entry) => entry.expected >= MIN_EXPECTED_BPS)
      .sort((a, b) => b.expected * 30 / Math.max(1, b.pair.km / 90 + 10) - a.expected * 30 / Math.max(1, a.pair.km / 90 + 10) || a.pair.from.localeCompare(b.pair.from) || a.pair.to.localeCompare(b.pair.to));
    for (const { pair } of finalists) {
      if (slots <= 0) break;
      const balance = accounts.find((account) => account.id === purse.id)!.balance;
      const reserve = Math.max(RESERVE_FLOOR, balance * RESERVE_SHARE);
      const stake = Math.min(MAX_STAKE, balance * MAX_STAKE_SHARE, balance - reserve);
      if (stake < MIN_STAKE) break;
      const entry = marketEntry(current, pair.from, pair.good);
      const price = priceInDrachmae(current, pair.from, pair.good);
      if (entry === undefined || price <= 0) continue;
      const keep = pair.good === "grain" ? entry.target : entry.target * KEEP_SHARE;
      const spare = Math.max(0, entry.stock - keep);
      const units = Math.min(Math.floor(stake / price), Math.floor(spare * STOCK_SHARE));
      if (units < MIN_UNITS) continue;
      const drawn = drawStock(current, pair.from, pair.good, units);
      if (drawn.taken < MIN_UNITS) continue;
      const cost = Math.max(1, Math.round(drawn.taken * price));
      current = drawn.world;
      accounts = accounts.map((account) => (account.id === purse.id ? { ...account, balance: account.balance - cost } : account));
      const ventureId = ids.next("venture");
      const incomeId = ids.next("income");
      const days = Math.min(60, Math.max(2, Math.ceil(pair.km / 90)) + 10);
      const title = `${house.name}: ${pair.good.replace("_", " and ")} from ${nameOfProvince(world, pair.from)} to ${nameOfProvince(world, pair.to)}`.slice(0, 120);
      transactions.push({
        id: ids.next("txn"), atStep: toDay, kind: "purchase", amount: cost, sourceAccountId: purse.id, external: "market",
        cause: { kind: "action", id: ventureId, explanation: `Goods bought for ${title}`.slice(0, 240) }, visibility: "private",
      });
      newSources.push({
        id: incomeId, kind: "trade", label: `Return of ${title}`.slice(0, 120), beneficiaryAccountId: purse.id, originKind: "venture", originId: ventureId,
        amount: 1, cadenceSteps: 30, nextDueStep: toDay + 30, collectionRateBps: 10_000,
        counterpartyPolityId: month.polityAt(pair.to) !== null && month.polityAt(pair.to) !== polityId ? month.polityAt(pair.to) : null, active: false,
      });
      newVentures.push({
        id: ventureId, title, ownerCharacterId: head.id, fromProvinceId: pair.from, toProvinceId: pair.to, bySea: true, incomeSourceId: incomeId,
        openedAtStep: toDay, interruptedBy: null, status: "running",
        cargo: { cost, good: pair.good, units: drawn.taken, sailedAtStep: toDay, arrivesAtStep: toDay + days, voyages: 0, rollsOver: false },
      });
      slots -= 1;
    }
  }

  // A cargo sold or lost two months ago is done with: its venture and its income row are dropped, so a world that has
  // traded for fifty years carries the cargoes at sea and not every cargo that ever sailed.
  const spent = new Set<string>();
  const spentSources = new Set<string>();
  for (const venture of world.material.ventures) {
    if (venture.status !== "closed" || venture.cargo === undefined || venture.cargo.arrivesAtStep + SPENT_AFTER_DAYS >= toDay) continue;
    if (!memory.houses.some((house) => venture.title.startsWith(`${house.name}:`))) continue;
    spent.add(venture.id);
    spentSources.add(venture.incomeSourceId);
  }
  if (newVentures.length === 0 && transactions.length === 0 && changed.size === 0 && spent.size === 0) return { world, facts };
  const houses = memory.houses.map((house) => changed.get(house.id) ?? house);
  return {
    world: {
      ...current,
      economy: { ...economyOf(current), houses },
      material: {
        ...current.material,
        accounts,
        incomeSources: [...(spentSources.size === 0 ? current.material.incomeSources : current.material.incomeSources.filter((source) => !spentSources.has(source.id))), ...newSources],
        ventures: [...(spent.size === 0 ? current.material.ventures : current.material.ventures.filter((venture) => !spent.has(venture.id))), ...newVentures],
        transactions: [...current.material.transactions, ...transactions],
      },
    },
    facts,
  };
}
