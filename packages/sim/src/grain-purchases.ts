import {
  addStock,
  atWar,
  economyOf,
  hubOf,
  isOccupied,
  kmFromAny,
  marketEntry,
  marketGeography,
  priceInDrachmae,
  drawStock,
  tradeTermsBetween,
  type FactProposalDraft,
  type GrainShipment,
  type MoneyTransaction,
  type WorldState,
} from "@chronica/shared";
import { cutOffHubs } from "./markets";
import type { IdFactory } from "./ports";

/**
 * Grain bought with the state's silver (docs/economy.md, "Grain bought, and bread by contract").
 *
 * A dole was money given away to nobody. Rome's aediles bought grain and gave it out (Livy 10.11, 23.41: the curule aediles' grain, from Etruria and Sicily),
 * and the quaestors of the fleet bought it abroad in a dearth. Now what the treasury spends in a dearth is spent at the markets: the officer who keeps the
 * grain looks at the hubs his power can reach, takes the ones that hold more than they need and sell it cheapest once the carrying is paid, draws it out of
 * their stocks (their prices rise by what he takes), pays for it through the market door, and sends it. It lands in the hungry hub when the road says, and
 * that hub's price falls by what it brings. No grain is made and no money: the stock moves from one hub to another and the silver from the chest to the country.
 *
 * The same buyer serves the houses that victual an army (`army-victualling.ts`): they take the cheapest bread the same way, for another destination.
 */

/** How far a buyer looks for grain, in the map's kilometres. */
export const BUYING_REACH_KM = 1_700;
/** What the carrying adds to the price of a modius, for every hundred kilometres (mostly by water; the share of the base price). */
export const CARRIAGE_PER_100_KM = 0.07;
/** The share of a hub's spare grain one buyer takes in a month. */
export const BUYERS_SHARE_OF_SPARE = 0.3;
/** Kilometres a cargo makes a day, and the days of loading and unloading. */
export const SHIP_KM_PER_DAY = 90;
export const HANDLING_DAYS = 10;
/** A shipment is worth sending at this many modii. */
export const LEAST_UNITS = 40;
/** Months of what its people use a hungry hub is sent, at the most. */
export const RELIEF_MONTHS = 3;
/** A hub's grain is bought for it only where it stands this dear (basis points of the base) and the grain would come at a good deal less. */
export const RELIEF_PRICE_BPS = 12_000;
export const RELIEF_CHEAPER_BY = 0.8;

/** A market a buyer may take grain from. */
export interface Source {
  readonly hubId: string;
  readonly km: number;
  /** Drachmae a modius costs at its stock now. */
  readonly unit: number;
  /** What a modius costs landed, the carriage added. */
  readonly landed: number;
  readonly spare: number;
}

/**
 * The markets that would sell to a power's buyer, for grain going to `toProvinceId`, the cheapest landed first: hubs within reach that hold more than
 * they mean to keep, are not shut by a siege, a blockade or an occupation, are not an enemy's, and are not closed to the buyer's power by a pact's terms
 * or an embargo on grain.
 */
export function sourcesFor(world: WorldState, buyerPolityId: string, toProvinceId: string, options: { readonly reachKm?: number; readonly without?: ReadonlySet<string> } = {}): Source[] {
  const geography = marketGeography(world);
  const toHub = hubOf(world, toProvinceId);
  const reach = kmFromAny(world, [toProvinceId], { budgetKm: options.reachKm ?? BUYING_REACH_KM });
  const cut = cutOffHubs(world, geography.hubs);
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  const found: Source[] = [];
  const terms = new Map<string, ReturnType<typeof tradeTermsBetween>>();
  for (const hubId of geography.hubs) {
    if (hubId === toHub || cut.has(hubId) || options.without?.has(hubId) === true) continue;
    const km = reach.get(hubId);
    const province = provinces.get(hubId);
    if (km === undefined || province === undefined || isOccupied(province)) continue;
    const holder = province.controllerPolityId;
    if (holder !== null && holder !== buyerPolityId) {
      if (atWar(world.polityAgreements, buyerPolityId, holder)) continue;
      let known = terms.get(holder);
      if (known === undefined) { known = tradeTermsBetween(world, buyerPolityId, holder); terms.set(holder, known); }
      if (known.closed !== null || known.forbidden.includes("grain")) continue;
    }
    const entry = marketEntry(world, hubId, "grain");
    if (entry === undefined) continue;
    const spare = Math.max(0, entry.stock - entry.target);
    if (spare < LEAST_UNITS / BUYERS_SHARE_OF_SPARE) continue;
    const unit = priceInDrachmae(world, hubId, "grain");
    found.push({ hubId, km, unit, landed: unit + (CARRIAGE_PER_100_KM * km) / 100, spare });
  }
  return found.sort((a, b) => a.landed - b.landed || a.hubId.localeCompare(b.hubId));
}

/** A leg of a purchase: so many modii bought in one hub, for so much, to be carried so far. */
export interface Leg {
  readonly hubId: string;
  readonly units: number;
  readonly cost: number;
  readonly km: number;
  readonly days: number;
}

export interface Bought {
  readonly world: WorldState;
  readonly legs: readonly Leg[];
  readonly units: number;
  readonly spent: number;
}

/**
 * Buy grain out of the stocks of the sources in order, the cheapest first, until the money or the wish is spent: each leg is a draw on a hub's stock and one
 * line through the market door out of the payer's account. Nothing is bought below `LEAST_UNITS` of a leg. The caller carries the grain.
 */
export function buyGrain(world: WorldState, input: {
  readonly sources: readonly Source[];
  readonly payerAccountId: string;
  readonly maxSpend: number;
  readonly maxUnits: number;
  readonly atStep: number;
  readonly ids: IdFactory;
  readonly causeId: string;
  readonly explanation: string;
}): Bought {
  const payer = world.material.accounts.find((account) => account.id === input.payerAccountId);
  let budget = Math.min(input.maxSpend, payer === undefined ? 0 : Math.max(0, payer.balance));
  let wanted = input.maxUnits;
  let current = world;
  const legs: Leg[] = [];
  const transactions: MoneyTransaction[] = [];
  let spent = 0;
  for (const source of input.sources) {
    if (wanted < LEAST_UNITS || budget < LEAST_UNITS * source.landed) break;
    // The price read at the stock as it now stands (an earlier leg may have drawn on a neighbour's), and the carriage on top.
    const entry = marketEntry(current, source.hubId, "grain");
    if (entry === undefined) continue;
    const spare = Math.max(0, entry.stock - entry.target);
    const unit = priceInDrachmae(current, source.hubId, "grain") + (CARRIAGE_PER_100_KM * source.km) / 100;
    const units = Math.min(Math.floor(spare * BUYERS_SHARE_OF_SPARE), Math.floor(budget / unit), wanted);
    if (units < LEAST_UNITS) continue;
    const drawn = drawStock(current, source.hubId, "grain", units);
    if (drawn.taken < LEAST_UNITS) continue;
    const cost = Math.max(1, Math.round(drawn.taken * unit));
    current = drawn.world;
    budget -= cost;
    wanted -= drawn.taken;
    spent += cost;
    legs.push({ hubId: source.hubId, units: drawn.taken, cost, km: source.km, days: Math.ceil(source.km / SHIP_KM_PER_DAY) + HANDLING_DAYS });
    transactions.push({
      id: input.ids.next("txn"), atStep: input.atStep, kind: "purchase", amount: cost, sourceAccountId: input.payerAccountId, external: "market",
      cause: { kind: "action", id: input.causeId, explanation: input.explanation.slice(0, 240) }, visibility: "polity",
    });
  }
  if (legs.length === 0) return { world, legs: [], units: 0, spent: 0 };
  return {
    world: {
      ...current,
      material: {
        ...current.material,
        accounts: current.material.accounts.map((account) => (account.id === input.payerAccountId ? { ...account, balance: account.balance - spent } : account)),
        transactions: [...current.material.transactions, ...transactions],
      },
    },
    legs,
    units: legs.reduce((sum, leg) => sum + leg.units, 0),
    spent,
  };
}

/**
 * The treasury of a power buys grain for a hub that stands at a famine's price, if the markets round it have more than they need and would sell for a good
 * deal less once carried: up to `RELIEF_MONTHS` of what the hub's country uses, or what `budget` buys. The grain is on the way, and the money gone, when this
 * returns; it lands by `landShipments`. Null where there is nothing to buy: the hub is not so dear, or no market near enough has any to spare.
 */
export function relieveAHub(world: WorldState, input: {
  readonly polityId: string;
  readonly payerAccountId: string;
  readonly provinceId: string;
  readonly budget: number;
  readonly atStep: number;
  readonly ids: IdFactory;
  readonly cause: string;
}): { readonly world: WorldState; readonly units: number; readonly spent: number; readonly legs: readonly Leg[]; readonly fact: FactProposalDraft } | null {
  const toHub = hubOf(world, input.provinceId);
  if (toHub === null) return null;
  const entry = marketEntry(world, toHub, "grain");
  if (entry === undefined || entry.priceBps < RELIEF_PRICE_BPS) return null;
  const here = priceInDrachmae(world, toHub, "grain");
  const sources = sourcesFor(world, input.polityId, toHub).filter((source) => source.landed <= here * RELIEF_CHEAPER_BY);
  if (sources.length === 0) return null;
  const bought = buyGrain(world, {
    sources, payerAccountId: input.payerAccountId, maxSpend: input.budget, maxUnits: Math.ceil(entry.demand * RELIEF_MONTHS),
    atStep: input.atStep, ids: input.ids, causeId: input.cause, explanation: `Grain bought for ${nameOf(world, toHub)} out of the chest`,
  });
  if (bought.legs.length === 0) return null;
  const memory = economyOf(bought.world);
  const shipments: GrainShipment[] = bought.legs.map((leg) => ({
    id: input.ids.next("shipment"), polityId: input.polityId, fromHubId: leg.hubId, toHubId: toHub, units: leg.units, paid: leg.cost,
    sentAtStep: input.atStep, arrivesAtStep: input.atStep + leg.days, status: "on_the_way" as const,
  }));
  const where = bought.legs.map((leg) => nameOf(world, leg.hubId));
  const last = Math.max(...bought.legs.map((leg) => leg.days));
  return {
    world: { ...bought.world, economy: { ...memory, shipments: [...memory.shipments.filter((row) => row.status === "on_the_way" || row.arrivesAtStep > input.atStep - 60), ...shipments].slice(-80) } },
    units: bought.units,
    spent: bought.spent,
    legs: bought.legs,
    fact: {
      localId: `grain_bought_${input.cause}`.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60),
      kind: "treasury_grain_bought",
      summary: `${nameOf(world, input.polityId, "polity")} bought ${bought.units.toLocaleString("en-GB")} modii of grain for ${nameOf(world, toHub)}, where bread stood dear, ${bought.spent.toLocaleString("en-GB")} out of the chest: ${join(where)}; it will be there in about ${last} days.`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: input.polityId }, { kind: "province", id: toHub }, ...bought.legs.map((leg) => ({ kind: "province" as const, id: leg.hubId }))],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40,
    },
  };
}

/**
 * Grain bought for the hungry lands, on the day it is due: into the hub's stock (its price falls at once), or lost if the hub has been shut since by a siege or a
 * blockade or taken by an enemy. Landed and lost rows are kept two months for the readers, then dropped.
 */
export function landShipments(world: WorldState, toDay: number): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const memory = economyOf(world);
  if (!memory.shipments.some((row) => row.status === "on_the_way" && row.arrivesAtStep <= toDay)) return { world, facts: [] };
  const geography = marketGeography(world);
  const cut = cutOffHubs(world, geography.hubs);
  let current = world;
  const facts: FactProposalDraft[] = [];
  const rows = memory.shipments.map((row): GrainShipment => {
    if (row.status !== "on_the_way" || row.arrivesAtStep > toDay) return row;
    const province = world.map.provinces.find((candidate) => candidate.id === row.toHubId);
    const shut = cut.has(row.toHubId) || (province !== undefined && province.controllerPolityId !== null && province.controllerPolityId !== row.polityId && atWar(world.polityAgreements, row.polityId, province.controllerPolityId));
    if (shut) {
      facts.push({
        localId: `grain_lost_${row.id}`.slice(0, 60), kind: "grain_shipment_lost",
        summary: `The grain ${nameOf(world, row.polityId, "polity")} had bought for ${nameOf(world, row.toHubId)} found the place shut against it, and was lost.`.slice(0, 600),
        affectedRefs: [{ kind: "polity", id: row.polityId }, { kind: "province", id: row.toHubId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 35,
      });
      return { ...row, status: "lost" };
    }
    current = addStock(current, row.toHubId, "grain", row.units);
    facts.push({
      localId: `grain_landed_${row.id}`.slice(0, 60), kind: "grain_shipment_landed",
      summary: `${row.units.toLocaleString("en-GB")} modii of the grain ${nameOf(world, row.polityId, "polity")} bought came into ${nameOf(world, row.toHubId)} from ${nameOf(world, row.fromHubId)}.`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: row.polityId }, { kind: "province", id: row.toHubId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 30,
    });
    return { ...row, status: "landed" };
  });
  const kept = rows.filter((row) => row.status === "on_the_way" || row.arrivesAtStep > toDay - 60);
  return { world: { ...current, economy: { ...economyOf(current), shipments: kept } }, facts };
}

function nameOf(world: WorldState, id: string, kind: "province" | "polity" = "province"): string {
  if (kind === "polity") return world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const province = world.map.provinces.find((candidate) => candidate.id === id);
  return province?.settlements.find((settlement) => settlement.kind === "port")?.name ?? province?.name ?? id;
}

function join(names: readonly string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return `from ${unique[0] ?? "abroad"}`;
  return `from ${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}
