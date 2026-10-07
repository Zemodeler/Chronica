import {
  GOODS,
  GOOD_COUNT,
  GRAIN_RESERVE_MONTHS,
  MAX_STOCK_MONTHS,
  SURPLUS_AT,
  SURPLUS_SPILL_BPS,
  astronomicalYearOf,
  calendarDateOf,
  calendarYearOf,
  dayOfCalendarDate,
  economyOf,
  foodReadoutBps,
  isOccupied,
  marketGeography,
  openingMarkets,
  priceBpsFrom,
  provinceGrounds,
  type MarketHub,
  type ProvinceMaterial,
  type ProvinceTargets,
  type ScenarioClock,
  type WorldState,
  addFlows,
} from "@chronica/shared";

/**
 * The monthly market step (phase C of the economy rework).
 *
 * Once a month, for every hub and every good: what the hub's country makes
 * comes in, what its people use goes out, what a siege or an army takes is
 * taken, what is more than a hub can keep spoils, and the price is read off
 * what is left against what the hub ought to hold. Grain comes in once a
 * year, in the harvest month (`sim/economy.ts`), and carries from one year to
 * the next in the hubs' granaries; so a drought that a hub can bear with its
 * reserve only makes bread dear, and two droughts running do what one never
 * could, which is famine.
 *
 * It works on a small book of arrays in memory (one entry a hub, six numbers
 * a good) and writes it back once. Nothing here searches the province list;
 * the pass walks the provinces once a month in id order, adding each one's use
 * and output to its hub's totals, which is all a market is made of.
 */

/** Days in the calendar's month: the reckoning's. */
const MONTH_DAYS = 30;
/** Where the calendar is silent, grain is taken to come in six months from now. */
const NO_CALENDAR_MONTHS_TO_HARVEST = 6;
/** The share of a besieged, occupied or blockaded hub's stock requisitioned, burned or eaten by whoever lies about it, each month. */
export const CUT_OFF_REQUISITION_BPS = 2_500;
/** The country round a shut hub eats from its own farms: it does not go below this while only the town is besieged (basis points of food security). */
export const FARMS_FEED_BPS = 6_000;
/** What of its country's output reaches a hub that is cut off: the carters will not go through the lines. */
export const CUT_OFF_INFLOW = 0.25;
/** A hub's price answers use and output a month late, and not further than this either way. */
const DEMAND_RESPONSE_RANGE = [0.55, 1.25] as const;
const SUPPLY_RESPONSE_RANGE = [0.6, 1.5] as const;
/** A province's bread readout moves this far toward what its hub's grain says each month, up and down (basis points). */
export const FOOD_STEP_DOWN_BPS = 2_500;
export const FOOD_STEP_UP_BPS = 1_500;

const GRAIN = 0;

/** One hub's goods in the arrays the month works on. */
export interface HubBook {
  readonly stock: number[];
  readonly target: number[];
  readonly demand: number[];
  readonly price: number[];
  /** What trade brought in from other hubs and sent out to them last month, in units (`trade-flows.ts`). */
  readonly inflow: number[];
  readonly outflow: number[];
  /** What the hub's grain says a fed country's food security is, from the month's reckoning. */
  food: number;
}
export type Book = Map<string, HubBook>;

/** How many months are left until grain next comes in, from the calendar; absent a calendar, half a year. */
export function monthsToHarvest(day: number, clock: ScenarioClock | undefined, harvestMonth: number): number {
  if (clock === undefined) return NO_CALENDAR_MONTHS_TO_HARVEST;
  const year = astronomicalYearOf(calendarDateOf({ day, minute: 0 }, clock));
  const harvestDay = (astronomical: number): number => dayOfCalendarDate({ ...calendarYearOf(astronomical), month: harvestMonth, day: 1 }, clock);
  const next = harvestDay(year) > day ? harvestDay(year) : harvestDay(year + 1);
  return Math.max(0, (next - day) / MONTH_DAYS);
}

/**
 * The book of a world's markets: what it remembers, with an opening for any
 * hub it does not (the world has never been reckoned, or its hubs changed).
 * Opening stocks are a season's reserve and what the hub needs to reach the
 * next harvest (`openingMarkets`).
 */
export function openBook(world: WorldState, toHarvest: number): Book {
  const geography = marketGeography(world);
  const kept = new Map<string, MarketHub>(economyOf(world).markets.map((hub) => [hub.hubId, hub]));
  const missing = geography.hubs.some((id) => !kept.has(id));
  const opening = missing ? new Map(openingMarkets(world, toHarvest).map((hub) => [hub.hubId, hub])) : undefined;
  const book: Book = new Map();
  for (const id of geography.hubs) {
    const hub = kept.get(id) ?? opening!.get(id)!;
    const entry = new Map(hub.goods.map((good) => [good.good, good]));
    const stock: number[] = [];
    const target: number[] = [];
    const demand: number[] = [];
    const price: number[] = [];
    const inflow: number[] = [];
    const outflow: number[] = [];
    for (const spec of GOODS) {
      const found = entry.get(spec.id);
      stock.push(found?.stock ?? 0);
      target.push(found?.target ?? 0);
      demand.push(found?.demand ?? 0);
      price.push(found?.priceBps ?? 10_000);
      inflow.push(found?.inflow ?? 0);
      outflow.push(found?.outflow ?? 0);
    }
    book.set(id, { stock, target, demand, price, inflow, outflow, food: 8_000 });
  }
  return book;
}

/** A book written back into a world's memory, hubs in id order. */
export function closeBook(world: WorldState, book: Book): WorldState {
  const markets: MarketHub[] = [...book.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([hubId, hub]) => ({
    hubId,
    goods: GOODS.map((spec, index) => ({
      good: spec.id,
      stock: Math.max(0, Math.round(hub.stock[index]!)),
      target: Math.max(0, Math.round(hub.target[index]!)),
      demand: Math.max(0, Math.round(hub.demand[index]!)),
      priceBps: Math.max(1, Math.round(hub.price[index]!)),
      inflow: Math.max(0, Math.round(hub.inflow[index]!)),
      outflow: Math.max(0, Math.round(hub.outflow[index]!)),
    })),
  }));
  return { ...world, economy: { ...economyOf(world), markets } };
}

/** What cuts a hub off: a siege laid to it, an enemy sitting on it, or a fleet off its harbour. */
export function cutOffHubs(world: WorldState, hubs: readonly string[]): ReadonlySet<string> {
  const sieged = new Set(world.sieges.filter((siege) => siege.status === "active").map((siege) => siege.provinceId));
  const blockaded = new Set(world.blockades.filter((blockade) => blockade.status === "active").map((blockade) => blockade.provinceId));
  const wanted = new Set(hubs);
  const cut = new Set<string>();
  for (const province of world.map.provinces) {
    if (!wanted.has(province.id)) continue;
    if (sieged.has(province.id) || blockaded.has(province.id) || (province.controllerPolityId !== null && isOccupied(province))) cut.add(province.id);
  }
  return cut;
}

export interface MonthInput {
  readonly world: WorldState;
  readonly rows: Map<string, ProvinceMaterial>;
  /** Ids in order, so a pass is the same on every machine. */
  readonly ids: readonly string[];
  /** What the month is: its day, and so how many months grain has still to last. */
  readonly day: number;
  readonly clock: ScenarioClock | undefined;
  readonly harvestMonth: number;
  readonly cut: ReadonlySet<string>;
  readonly targets: ReadonlyMap<string, ProvinceTargets>;
}

const clamp = (value: number, [low, high]: readonly [number, number]): number => Math.max(low, Math.min(high, value));

/**
 * One month of every market, and the food each province eats as a result.
 * Mutates the book and the rows map it is handed (the caller's own copies).
 */
export function marketMonth(book: Book, input: MonthInput): void {
  const geography = marketGeography(input.world);
  const grounds = provinceGrounds(input.world);
  const provinceById = new Map(input.world.map.provinces.map((province) => [province.id, province]));
  const demandOf = new Map<string, number[]>();
  const supplyOf = new Map<string, number[]>();
  for (const hub of geography.hubs) {
    demandOf.set(hub, new Array<number>(GOOD_COUNT).fill(0));
    supplyOf.set(hub, new Array<number>(GOOD_COUNT).fill(0));
  }
  // Every province adds its use and output to its hub's totals, once.
  for (const id of input.ids) {
    const hub = geography.hubOf.get(id);
    const row = input.rows.get(id);
    const province = provinceById.get(id);
    const ground = grounds.get(id);
    if (hub === undefined || row === undefined || province === undefined || ground === undefined) continue;
    addFlows(row, province, ground, demandOf.get(hub)!, supplyOf.get(hub)!);
  }
  const toHarvest = monthsToHarvest(input.day, input.clock, input.harvestMonth);
  const calendar = input.clock !== undefined;
  for (const hubId of geography.hubs) {
    const hub = book.get(hubId);
    if (hub === undefined) continue;
    const used = demandOf.get(hubId)!;
    const made = supplyOf.get(hubId)!;
    const cut = input.cut.has(hubId);
    let grainFed = 1;
    for (let index = 0; index < GOOD_COUNT; index += 1) {
      const spec = GOODS[index]!;
      const priceRatio = hub.price[index]! / 10_000;
      // What is wanted is what is used, less what a dear price talks people out of.
      const wanted = used[index]! * clamp(Math.pow(priceRatio, -spec.demandElasticity), DEMAND_RESPONSE_RANGE);
      // What is made comes in: grain once a year, at the harvest, unless the calendar is silent; the rest as it is made, more where it pays.
      const inflow = index === GRAIN && calendar
        ? 0
        : made[index]! * (spec.supplyElasticity === 0 ? 1 : clamp(Math.pow(priceRatio, spec.supplyElasticity), SUPPLY_RESPONSE_RANGE)) * (cut ? CUT_OFF_INFLOW : 1);
      let stock = hub.stock[index]! + inflow;
      const eaten = Math.min(stock, wanted);
      stock -= eaten;
      // A besieged, occupied or blockaded hub is stripped by whoever lies about it.
      if (cut) stock -= stock * (CUT_OFF_REQUISITION_BPS / 10_000);
      const target = index === GRAIN ? (toHarvest + GRAIN_RESERVE_MONTHS) * used[index]! : spec.targetMonths * used[index]!;
      // More than a hub can use spoils, or is sold on abroad, a share a month; and no hub's warehouses are without end.
      if (stock > SURPLUS_AT * target) stock -= (stock - SURPLUS_AT * target) * (SURPLUS_SPILL_BPS / 10_000);
      stock = Math.min(stock, MAX_STOCK_MONTHS * Math.max(1, used[index]!));
      hub.stock[index] = Math.max(0, stock);
      hub.target[index] = target;
      hub.demand[index] = used[index]!;
      hub.price[index] = priceBpsFrom(spec, hub.stock[index]!, target);
      if (index === GRAIN) grainFed = wanted > 0 ? Math.min(1, eaten / wanted) : 1;
    }
    // What the hub's grain says of how well its people are fed: against what they need to reach the harvest.
    const needs = Math.max(1, hub.demand[GRAIN]! * (toHarvest + 1));
    const cover = hub.stock[GRAIN]! / needs;
    hub.food = grainFed < 0.999 ? Math.min(foodReadoutBps(cover), Math.round(7_000 * grainFed)) : foodReadoutBps(cover);
  }
  // Each province eats as its hub's grain says, less what war has burned of its own fields, and a granary
  // in it lifts it; its food readout moves toward that and no faster than the steps allow.
  for (const id of input.ids) {
    const hub = geography.hubOf.get(id);
    const row = input.rows.get(id);
    if (hub === undefined || row === undefined) continue;
    const book0 = book.get(hub);
    if (book0 === undefined) continue;
    // The town under siege starves; the countryside round it eats from its own farms, not the town's granary.
    const readout = input.cut.has(hub) && id !== hub ? Math.max(book0.food, FARMS_FEED_BPS) : book0.food;
    const local = readout * (1 - row.warDamageBps / 20_000) + (input.targets.get(id)?.foodSecurityShiftBps ?? 0);
    const goal = Math.max(0, Math.min(10_000, Math.round(local)));
    const now = row.foodSecurityBps;
    const next = goal < now ? Math.max(goal, now - FOOD_STEP_DOWN_BPS) : Math.min(goal, now + FOOD_STEP_UP_BPS);
    if (next !== now) input.rows.set(id, { ...row, foodSecurityBps: next });
  }
}

/**
 * Grain, as the harvest brings it: add each hub's crop to its stock, set its
 * target for a year to the next harvest, and price it from the result.
 * `crops` is units of grain by hub id.
 */
export function stockTheHarvest(world: WorldState, crops: ReadonlyMap<string, number>): WorldState {
  const geography = marketGeography(world);
  const book = openBook(world, 12);
  const cut = cutOffHubs(world, geography.hubs);
  for (const hubId of geography.hubs) {
    const hub = book.get(hubId);
    if (hub === undefined) continue;
    // A hub the lines have shut cannot be carted to: most of what its country grew stays in the country.
    const crop = (crops.get(hubId) ?? 0) * (cut.has(hubId) ? CUT_OFF_INFLOW : 1);
    const target = (12 + GRAIN_RESERVE_MONTHS) * hub.demand[GRAIN]!;
    hub.stock[GRAIN] = Math.min(hub.stock[GRAIN]! + crop, MAX_STOCK_MONTHS * Math.max(1, hub.demand[GRAIN]!));
    hub.target[GRAIN] = target;
    hub.price[GRAIN] = priceBpsFrom(GOODS[GRAIN]!, hub.stock[GRAIN]!, target);
  }
  return closeBook(world, book);
}
