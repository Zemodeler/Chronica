import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import type { ProvinceMaterial } from "../material-state";
import { developmentFactor, harvestDevelopmentFactor, provinceGrounds, type ProvinceGround } from "../material/province-material";
import { GOOD_IDS, GoodIdSchema, type GoodId } from "./good-ids";
import type { Province } from "./map";
import { RouteHeap, adjacentTo } from "./movement";
import type { WorldState } from "./world-state";

/**
 * Goods and the places they are bought and sold (phase C of the economy rework).
 *
 * The price of grain was read off a province's food security, so there was no
 * market and no storage: a bad harvest was a number that came back to normal at
 * a few hundred a month, a granary was a modifier, and what an army bought
 * left no mark on what the next army could buy. Now there are six goods, some
 * sixty market hubs, and each hub keeps a stock of each good that carries from
 * one year to the next. A price is what that stock says it is: dear when the
 * hub holds less than it ought, cheap when it holds more. Everything else
 * (what a province eats, what it grows, what an army takes, whether a siege
 * shuts a market) works on the stocks, and a price is read off them.
 *
 * The model is small on purpose. A province's weight in a market is derived
 * (its people, its ground, its development) and never stored; what is stored
 * is a handful of numbers a hub and a good, which is why a world of six
 * thousand provinces carries it for nothing.
 */

// ── Goods ──────────────────────────────────────────────────────────────────

export { GOOD_IDS, GoodIdSchema, type GoodId };
export const GOOD_COUNT = GOOD_IDS.length;
const GRAIN = 0;
/** Where a good sits in a hub's arrays. */
export const goodIndex = (good: GoodId): number => GOOD_IDS.indexOf(good);

export interface GoodSpec {
  readonly id: GoodId;
  readonly name: string;
  /** What one unit is, for the person reading a price. */
  readonly unit: string;
  /** Drachmae a unit sells for when the market holds what it ought. */
  readonly basePrice: number;
  /**
   * How hard the price answers a shortage: price = base x (target stock / stock)^exponent.
   * Grain, which nobody can do without, answers nearly one for one; the rest less.
   */
  readonly priceExponent: number;
  /** The price is never below or above these shares of the base (basis points). */
  readonly floorBps: number;
  readonly ceilingBps: number;
  /** What a head uses a month, in units, at the neutral level of development. */
  readonly perCapitaMonthly: number;
  /** How much richer provinces use of it: demand goes with (development / neutral)^exponent. 0 is a need, 2 a luxury. */
  readonly wealthExponent: number;
  /** How much a dear price cuts what is bought (grain, a need, barely; textiles a good deal). */
  readonly demandElasticity: number;
  /** How much a dear price draws more out of the ground. */
  readonly supplyElasticity: number;
  /** Months of what is used the stock should be for the price to stand at the base. */
  readonly targetMonths: number;
  /**
   * What the ground makes of it, as a share of what its people use, by terrain:
   * 1 is self-sufficient. Averaged across a hub's country these come near one,
   * so that a market with no trade yet (phase D) is not condemned to famine or
   * glut by an accident of its hinterland.
   */
  readonly supplyByTerrain: Readonly<Record<string, number>>;
  readonly supplyOtherwise: number;
  /** A port's workshops and quays add this share on top (textiles, luxuries). */
  readonly portSupply: number;
  /** Heads a head's worth of frontier trickles to the market a month at nil development (slaves): fades as a province develops. */
  readonly frontierSupply: number;
}

/**
 * The six goods, at the prices of the age in drachmae.
 *
 * Grain is a modius, at about a drachma as Athens and Delos paid; a head eats
 * four of them a month (a soldier's ration is the same, 4 modii, which is why
 * bread for a thousand men for a day is a hundred and thirty-odd drachmae).
 * Oil and wine are a measure (about an amphora's fifth), metals a bar of ten
 * kilos, timber a cubic cubit squared up for the yard, textiles a tunic's
 * length of cloth with the luxuries of the quays counted in it, and a slave is
 * a head, two hundred drachmae at the middle of the scale (Delos in the second
 * century held them at between 150 and 300, and a trained man far more).
 */
export const GOODS: readonly GoodSpec[] = [
  {
    id: "grain", name: "grain", unit: "modius", basePrice: 1, priceExponent: 0.9, floorBps: 4_000, ceilingBps: 40_000,
    perCapitaMonthly: 4, wealthExponent: 0, demandElasticity: 0.25, supplyElasticity: 0, targetMonths: 0,
    supplyByTerrain: { "coastal-plain": 1.06, hills: 1.05, "hills-uplands": 1.04, "desert-steppe": 1.03 }, supplyOtherwise: 1.04, portSupply: 0, frontierSupply: 0,
  },
  {
    id: "oil_wine", name: "oil and wine", unit: "measure", basePrice: 8, priceExponent: 0.6, floorBps: 4_000, ceilingBps: 40_000,
    perCapitaMonthly: 0.3, wealthExponent: 0.5, demandElasticity: 0.5, supplyElasticity: 0.5, targetMonths: 3,
    supplyByTerrain: { "coastal-plain": 1.1, hills: 0.9, "hills-uplands": 0.4, "desert-steppe": 0.15 }, supplyOtherwise: 0.7, portSupply: 0.05, frontierSupply: 0,
  },
  {
    id: "metals", name: "metals", unit: "bar", basePrice: 30, priceExponent: 0.5, floorBps: 4_000, ceilingBps: 40_000,
    perCapitaMonthly: 0.02, wealthExponent: 0.5, demandElasticity: 0.4, supplyElasticity: 0.5, targetMonths: 4,
    supplyByTerrain: { "coastal-plain": 0.55, hills: 2, "hills-uplands": 2.8, "desert-steppe": 0.5 }, supplyOtherwise: 1.5, portSupply: 0, frontierSupply: 0,
  },
  {
    id: "timber", name: "timber and naval stores", unit: "load", basePrice: 4, priceExponent: 0.5, floorBps: 4_000, ceilingBps: 40_000,
    perCapitaMonthly: 0.3, wealthExponent: 0.3, demandElasticity: 0.4, supplyElasticity: 0.5, targetMonths: 3,
    supplyByTerrain: { "coastal-plain": 0.75, hills: 1.6, "hills-uplands": 2, "desert-steppe": 0.15 }, supplyOtherwise: 1.3, portSupply: 0, frontierSupply: 0,
  },
  {
    id: "textiles", name: "textiles and luxuries", unit: "length", basePrice: 25, priceExponent: 0.6, floorBps: 4_000, ceilingBps: 40_000,
    perCapitaMonthly: 0.04, wealthExponent: 1, demandElasticity: 0.6, supplyElasticity: 0.5, targetMonths: 2,
    supplyByTerrain: { "coastal-plain": 0.8, hills: 0.7, "hills-uplands": 0.55, "desert-steppe": 0.45 }, supplyOtherwise: 0.6, portSupply: 0.6, frontierSupply: 0,
  },
  {
    id: "slaves", name: "slaves", unit: "head", basePrice: 200, priceExponent: 0.8, floorBps: 5_000, ceilingBps: 30_000,
    perCapitaMonthly: 0.0012, wealthExponent: 1.5, demandElasticity: 0.5, supplyElasticity: 0.3, targetMonths: 1,
    supplyByTerrain: {}, supplyOtherwise: 0, portSupply: 0, frontierSupply: 0.005,
  },
];

const SPEC_BY_ID = new Map<GoodId, GoodSpec>(GOODS.map((spec) => [spec.id, spec]));
export const goodSpec = (good: GoodId): GoodSpec => SPEC_BY_ID.get(good)!;

/** The neutral level of development at which a head uses what `perCapitaMonthly` says. */
const NEUTRAL_DEVELOPMENT = 5_000;
/** Development at and above which a province has no frontier to trickle slaves from. */
const FRONTIER_ENDS_AT_DEVELOPMENT = 6_000;

/** The months of grain a hub keeps in hand beyond what it needs to reach the next harvest: what the price is measured against. */
export const GRAIN_RESERVE_MONTHS = 6;
/** And the reserve a market opens with, the same: half a year of bread above what is needed to reach the harvest, so that one drought does not starve it and two do (the season of reserve the plan asked for was too little for the first). */
export const GRAIN_OPENING_RESERVE_MONTHS = 6;
/** Stock above this share of its target spoils, or is sold abroad, at `SURPLUS_SPILL_BPS` a month. */
export const SURPLUS_AT = 1.15;
export const SURPLUS_SPILL_BPS = 400;
/** No hub holds more than this many months of what it uses. */
export const MAX_STOCK_MONTHS = 30;

// ── What is kept ───────────────────────────────────────────────────────────

/** One good in one hub. Integers all, so a world serialises the same everywhere. */
export const MarketEntrySchema = z
  .object({
    good: GoodIdSchema,
    /** Units held in the hub: granaries, warehouses, the yards. */
    stock: z.number().int().nonnegative(),
    /** What the hub would hold for the good to stand at its base price (months of what is used, for the season). */
    target: z.number().int().nonnegative().default(0),
    /** What the hub's country uses of it in a month, in units: what stock is measured in months by. */
    demand: z.number().int().nonnegative().default(0),
    /** Its price, in basis points of the base. Derived from the stock; kept so readers need not recompute it. */
    priceBps: z.number().int().min(1).max(1_000_000).default(10_000),
  })
  .strict();
export type MarketEntry = z.infer<typeof MarketEntrySchema>;

export const MarketHubSchema = z
  .object({
    hubId: EntityIdSchema,
    goods: z.array(MarketEntrySchema).max(12),
  })
  .strict();
export type MarketHub = z.infer<typeof MarketHubSchema>;

/** At most this many hubs are kept: a map of thousands of provinces has some sixty. */
export const MAX_MARKET_HUBS = 256;

// ── Hubs ───────────────────────────────────────────────────────────────────

/**
 * Which provinces are market hubs.
 *
 * A hub is a province with a harbour of some size, or a large town: where
 * goods change hands. On the Punic map a port town of 20 settlement units or
 * more (a city of eight thousand and its country) or any province whose towns
 * add to 60 does it, which comes to about sixty. A stretch of country the
 * graph cannot connect to any of them (an island of no town) is given the
 * biggest settled province in it, or its first by id, so that every province
 * belongs to some market.
 */
export const PORT_HUB_SETTLED_SIZE = 25;
export const INLAND_HUB_SETTLED_SIZE = 70;

const settledSizeOf = (province: Pick<Province, "settlements">): number => province.settlements.reduce((total, settlement) => total + settlement.size, 0);
const hasHarbour = (province: Pick<Province, "settlements">): boolean => province.settlements.some((settlement) => settlement.kind === "port");

export interface MarketGeography {
  /** The hubs' province ids, sorted. */
  readonly hubs: readonly string[];
  /** Each province's hub: itself, where it is one. */
  readonly hubOf: ReadonlyMap<string, string>;
  /** Provinces in each hub's country (itself included), in id order. */
  readonly country: ReadonlyMap<string, readonly string[]>;
  /**
   * The hubs that touch one another and the shortest way between them in the
   * map's own distance units: the graph trade flows will run over (phase D).
   * Neighbours in id order.
   */
  readonly neighbours: ReadonlyMap<string, readonly { readonly hubId: string; readonly km: number }[]>;
}

interface Assignment {
  readonly hubKey: string;
  readonly geography: MarketGeography;
}

const assignmentByEdges = new WeakMap<readonly unknown[], Assignment>();
const geographyByProvinces = new WeakMap<readonly Province[], MarketGeography>();

/**
 * Each province's hub, and the hubs themselves, for this map.
 *
 * Nearest by the map's graph distance, ties to the hub with the lower id. The
 * assignment is geography: it does not change when a province changes hands, a
 * hub is besieged or a town grows a little. What war does to a market is done
 * to its stock and its inflow month by month (`sim/markets.ts`), not by
 * redrawing the country. It is recomputed only when the set of hubs changes,
 * and kept for as long as the map's province list lives.
 */
export function marketGeography(world: Pick<WorldState, "map">): MarketGeography {
  const known = geographyByProvinces.get(world.map.provinces);
  if (known !== undefined) return known;
  const provinces = world.map.provinces;
  const size = new Map<string, number>();
  const hubs = new Set<string>();
  for (const province of provinces) {
    const total = settledSizeOf(province);
    size.set(province.id, total);
    if ((hasHarbour(province) && total >= PORT_HUB_SETTLED_SIZE) || total >= INLAND_HUB_SETTLED_SIZE) hubs.add(province.id);
  }
  let labelled = labelCountries(world, provinces, hubs);
  // Ground the hubs cannot reach: one more hub for each such stretch.
  if (labelled.unreached.length > 0) {
    const seen = new Set<string>();
    for (const id of labelled.unreached) {
      if (seen.has(id)) continue;
      const members: string[] = [];
      const queue = [id];
      seen.add(id);
      while (queue.length > 0) {
        const next = queue.pop()!;
        members.push(next);
        for (const neighbour of adjacentTo(world, next)) {
          if (seen.has(neighbour.provinceId)) continue;
          seen.add(neighbour.provinceId);
          queue.push(neighbour.provinceId);
        }
      }
      members.sort((a, b) => (size.get(b) ?? 0) - (size.get(a) ?? 0) || a.localeCompare(b));
      hubs.add(members[0]!);
    }
    labelled = labelCountries(world, provinces, hubs);
  }
  const hubKey = [...hubs].sort().join("|");
  const cached = assignmentByEdges.get(world.map.edges);
  if (cached !== undefined && cached.hubKey === hubKey) {
    geographyByProvinces.set(provinces, cached.geography);
    return cached.geography;
  }
  const geography = buildGeography(world, labelled);
  assignmentByEdges.set(world.map.edges, { hubKey, geography });
  geographyByProvinces.set(provinces, geography);
  return geography;
}

interface Labelled {
  readonly hubs: readonly string[];
  readonly label: ReadonlyMap<string, string>;
  readonly cost: ReadonlyMap<string, number>;
  readonly unreached: readonly string[];
}

/** Multi-source Dijkstra over the map's edges, each province labelled with its nearest hub (ties to the lower id). */
function labelCountries(world: Pick<WorldState, "map">, provinces: readonly Province[], hubSet: ReadonlySet<string>): Labelled {
  const hubs = [...hubSet].sort();
  const rank = new Map(hubs.map((id, index) => [id, index]));
  const RANK_SPAN = 4_096;
  // The heap's key packs distance and the hub's rank, so equal distances settle to the lower id and the order is the same on every machine.
  const best = new Map<string, number>();
  const label = new Map<string, string>();
  const cost = new Map<string, number>();
  const heap = new RouteHeap();
  for (const id of hubs) {
    best.set(id, rank.get(id)!);
    heap.push(rank.get(id)!, id);
  }
  while (heap.size > 0) {
    const { cost: key, id } = heap.pop();
    if (label.has(id)) continue;
    const hubRank = key % RANK_SPAN;
    const distance = Math.floor(key / RANK_SPAN);
    label.set(id, hubs[hubRank]!);
    cost.set(id, distance);
    for (const next of adjacentTo(world, id)) {
      if (label.has(next.provinceId)) continue;
      const total = (distance + next.edge.distance) * RANK_SPAN + hubRank;
      if (total >= (best.get(next.provinceId) ?? Infinity)) continue;
      best.set(next.provinceId, total);
      heap.push(total, next.provinceId);
    }
  }
  return { hubs, label, cost, unreached: provinces.filter((province) => !label.has(province.id)).map((province) => province.id) };
}

function buildGeography(world: Pick<WorldState, "map">, labelled: Labelled): MarketGeography {
  const country = new Map<string, string[]>(labelled.hubs.map((id) => [id, []]));
  const ids = world.map.provinces.map((province) => province.id).sort();
  for (const id of ids) country.get(labelled.label.get(id)!)?.push(id);
  const nearest = new Map<string, Map<string, number>>();
  for (const edge of world.map.edges) {
    const a = labelled.label.get(edge.from);
    const b = labelled.label.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    const km = (labelled.cost.get(edge.from) ?? 0) + edge.distance + (labelled.cost.get(edge.to) ?? 0);
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const row = nearest.get(from) ?? new Map<string, number>();
      if (km < (row.get(to) ?? Infinity)) row.set(to, km);
      nearest.set(from, row);
    }
  }
  const neighbours = new Map<string, { hubId: string; km: number }[]>();
  for (const hub of labelled.hubs) {
    neighbours.set(hub, [...(nearest.get(hub) ?? new Map<string, number>()).entries()].map(([hubId, km]) => ({ hubId, km })).sort((x, y) => x.hubId.localeCompare(y.hubId)));
  }
  return { hubs: labelled.hubs, hubOf: labelled.label, country, neighbours };
}

/** The hub whose market a province buys and sells in, or null for a province the map does not have. */
export function hubOf(world: Pick<WorldState, "map">, provinceId: string): string | null {
  return marketGeography(world).hubOf.get(provinceId) ?? null;
}

// ── What a province makes and uses ─────────────────────────────────────────

/** The yield of the year's weather, from its roll (0 to 99): about one year in sixteen a drought, one in seven poor, a little over half fair, one in seven good, one in sixteen a glut. */
export const HARVEST_BANDS = [
  { upTo: 6, kind: "drought", yield: 0.55 },
  { upTo: 20, kind: "poor", yield: 0.8 },
  { upTo: 75, kind: "fair", yield: 1 },
  { upTo: 92, kind: "good", yield: 1.15 },
  { upTo: 101, kind: "bumper", yield: 1.3 },
] as const;
export type HarvestKind = (typeof HARVEST_BANDS)[number]["kind"];

const cache0: number[] = new Array<number>(GOOD_COUNT).fill(0);

/**
 * The land is reckoned every thirty days and a year is a little over twelve
 * such reckonings (365 days), so a "month" of use is thirty days of it, a
 * twelve-three-hundred-and-sixty-fifth of the year's: otherwise twelve
 * reckonings eat a year's grain in 360 days and every harvest comes in five
 * days of bread short of the last.
 */
const REVIEW_SHARE_OF_MONTH = 360 / 365;

/**
 * How much more (or less) the ground yields for being more (or less)
 * developed than it started: the ratio of the harvest's development factor
 * now to what it was at the start. A province is as self-sufficient in grain
 * as its terrain says on the day the game opens, and a province that has
 * built roads and drained fields feeds more than its people, one that has
 * been laid waste feeds fewer.
 */
const grainSkill = (developmentBps: number, startingBps: number): number => harvestDevelopmentFactor(developmentBps) / harvestDevelopmentFactor(startingBps);

/**
 * Add one province's monthly use and output to a hub's running totals.
 *
 * Use is its people times what a head uses, richer as the province is more
 * developed (a need, grain, not at all; a luxury, a great deal). Output is its
 * people times what a head uses, times how much its ground makes of it, times
 * what its capacity and development let it do and what war and a scar leave:
 * a province burned or scarred sells little. Slaves are the exception: none
 * are bred or raised, they trickle in from the frontier (poorly developed
 * country) and arrive in a flood where a city is sacked (`takeCaptives`).
 */
export function addFlows(
  row: Pick<ProvinceMaterial, "population" | "productiveCapacityBps" | "warDamageBps" | "developmentBps" | "scarBps">,
  province: Pick<Province, "terrainId" | "settlements">,
  ground: Pick<ProvinceGround, "startingDevelopmentBps" | "port">,
  demand: number[],
  supply: number[],
): void {
  const people = row.population;
  if (people <= 0) return;
  const development = row.developmentBps ?? ground.startingDevelopmentBps;
  const wealth = development / NEUTRAL_DEVELOPMENT;
  const capacity = (row.productiveCapacityBps / 10_000) * (1 - 0.7 * (row.warDamageBps / 10_000)) * (1 - 0.3 * ((row.scarBps ?? 0) / 10_000));
  const skill = developmentFactor(development);
  for (let index = 0; index < GOOD_COUNT; index += 1) {
    const spec = GOODS[index]!;
    const use = people * spec.perCapitaMonthly * REVIEW_SHARE_OF_MONTH;
    demand[index]! += spec.wealthExponent === 0 ? use : use * Math.pow(wealth, spec.wealthExponent);
    if (index === GRAIN) {
      const ratio = spec.supplyByTerrain[province.terrainId] ?? spec.supplyOtherwise;
      supply[index]! += use * ratio * capacity * grainSkill(development, ground.startingDevelopmentBps);
    } else if (spec.frontierSupply > 0) {
      supply[index]! += people * spec.frontierSupply * Math.max(0, 1 - development / FRONTIER_ENDS_AT_DEVELOPMENT) * capacity;
    } else {
      const ratio = (spec.supplyByTerrain[province.terrainId] ?? spec.supplyOtherwise) + (ground.port ? spec.portSupply : 0);
      supply[index]! += use * ratio * capacity * skill;
    }
  }
}

/** A year's grain crop of one province, in modii, at a yield of one (the ordinary year), before the year's weather and luck. */
export function ordinaryCrop(
  row: Pick<ProvinceMaterial, "population" | "productiveCapacityBps" | "warDamageBps" | "developmentBps">,
  province: Pick<Province, "terrainId">,
  ground: Pick<ProvinceGround, "startingDevelopmentBps">,
): number {
  if (row.population <= 0) return 0;
  const spec = GOODS[GRAIN]!;
  const development = row.developmentBps ?? ground.startingDevelopmentBps;
  const ratio = spec.supplyByTerrain[province.terrainId] ?? spec.supplyOtherwise;
  return row.population * spec.perCapitaMonthly * 12 * ratio * (row.productiveCapacityBps / 10_000) * (1 - row.warDamageBps / 20_000) * grainSkill(development, ground.startingDevelopmentBps);
}

// ── Price ──────────────────────────────────────────────────────────────────

/**
 * The price of a good in basis points of its base, from what a hub holds
 * against what it ought: base x (target / stock)^exponent, between the floor
 * and the ceiling of the good. A hub that holds nothing, or one with nobody to
 * use the good, is at the ceiling or at the base respectively.
 */
export function priceBpsFrom(spec: Pick<GoodSpec, "priceExponent" | "floorBps" | "ceilingBps">, stock: number, target: number): number {
  if (target <= 0) return 10_000;
  const scarcity = target / Math.max(0.02 * target, stock);
  return Math.max(spec.floorBps, Math.min(spec.ceilingBps, Math.round(10_000 * Math.pow(scarcity, spec.priceExponent))));
}

/**
 * Food security as a readout of grain in hand.
 *
 * Cover is the grain a hub holds against what its people need until the next
 * harvest (the stock over the use of the months still to come, and a month
 * more). Enough to last (1) reads 7 000, which is fed; half enough reads 3 500,
 * which is the line below which people begin to die; three times enough reads
 * 10 000. Nothing in hand reads nothing, which is famine.
 */
export function foodReadoutBps(cover: number): number {
  if (cover >= 1) return Math.min(10_000, Math.round(7_000 + 1_500 * (cover - 1)));
  return Math.max(0, Math.round(7_000 * cover));
}

// ── Reading and changing a world's markets ─────────────────────────────────

/** The hubs a world's economy keeps, from memory; empty where it has not been reckoned yet. */
export function marketsOf(world: Pick<WorldState, "economy">): readonly MarketHub[] {
  return world.economy?.markets ?? [];
}

/** The entry for one good in one hub, or undefined. */
export function marketEntry(world: Pick<WorldState, "economy" | "map">, provinceId: string, good: GoodId): MarketEntry | undefined {
  const hub = hubOf(world, provinceId);
  if (hub === null) return undefined;
  const markets = marketsOf(world);
  for (const candidate of markets) {
    if (candidate.hubId === hub) return candidate.goods.find((entry) => entry.good === good);
  }
  return undefined;
}

/**
 * What a good costs in a province's market, in basis points of its ordinary
 * (base) price: 10 000 where the market has not been reckoned yet. The one
 * place a price is read from, so the army's bread, a merchant's margin, a
 * famine fact and the page a ruler reads all quote the same one. Phase D's
 * trade flows read and write the same entries.
 */
export function marketPriceBps(world: Pick<WorldState, "economy" | "map">, provinceId: string, good: GoodId): number {
  return marketEntry(world, provinceId, good)?.priceBps ?? 10_000;
}

/** What a unit of a good costs in a province's market, in drachmae. */
export function priceInDrachmae(world: Pick<WorldState, "economy" | "map">, provinceId: string, good: GoodId): number {
  return (goodSpec(good).basePrice * marketPriceBps(world, provinceId, good)) / 10_000;
}

/** Units of a good a hub holds, for a province's market. */
export function stockIn(world: Pick<WorldState, "economy" | "map">, provinceId: string, good: GoodId): number {
  return marketEntry(world, provinceId, good)?.stock ?? 0;
}

/** Months of its ordinary use a province's market holds of a good, or null where nothing is reckoned. */
export function stockMonths(world: Pick<WorldState, "economy" | "map">, provinceId: string, good: GoodId): number | null {
  const entry = marketEntry(world, provinceId, good);
  return entry === undefined || entry.demand <= 0 ? null : entry.stock / entry.demand;
}

function withEntry(world: WorldState, provinceId: string, good: GoodId, change: (entry: MarketEntry) => MarketEntry): WorldState {
  const hub = hubOf(world, provinceId);
  const memory = world.economy;
  if (hub === null || memory === undefined || memory.markets === undefined) return world;
  const spec = goodSpec(good);
  let changed = false;
  const markets = memory.markets.map((candidate) => {
    if (candidate.hubId !== hub) return candidate;
    return {
      ...candidate,
      goods: candidate.goods.map((entry) => {
        if (entry.good !== good) return entry;
        const next = change(entry);
        changed = true;
        return { ...next, priceBps: priceBpsFrom(spec, next.stock, next.target) };
      }),
    };
  });
  return changed ? { ...world, economy: { ...memory, markets } } : world;
}

/**
 * Take units of a good from a province's market (an army buys it, a siege eats
 * it, a sack carries it off). Never more than the hub holds; the price
 * answers at once. Returns the world and what was actually taken.
 */
export function drawStock(world: WorldState, provinceId: string, good: GoodId, units: number): { readonly world: WorldState; readonly taken: number } {
  const have = stockIn(world, provinceId, good);
  const taken = Math.max(0, Math.min(have, Math.floor(units)));
  if (taken <= 0) return { world, taken: 0 };
  return { world: withEntry(world, provinceId, good, (entry) => ({ ...entry, stock: entry.stock - taken })), taken };
}

/** Put units of a good into a province's market (a cargo landed, captives brought in). */
export function addStock(world: WorldState, provinceId: string, good: GoodId, units: number): WorldState {
  if (units <= 0) return world;
  return withEntry(world, provinceId, good, (entry) => {
    const room = Math.max(entry.stock, Math.round(MAX_STOCK_MONTHS * Math.max(1, entry.demand)));
    return { ...entry, stock: Math.min(room, entry.stock + Math.floor(units)) };
  });
}

/**
 * Prisoners taken in a war and brought to market: a sack or a storming puts
 * slaves on the hub's market, so the price of slaves falls where armies win.
 * A share of those who were killed or sold (`people`) is sold.
 */
export const CAPTIVE_SHARE = 0.5;
export function takeCaptives(world: WorldState, provinceId: string, people: number): WorldState {
  return addStock(world, provinceId, "slaves", Math.round(people * CAPTIVE_SHARE));
}

/**
 * Part of a province's market destroyed, plundered or carried off by whoever
 * took the place: the given share of every good a hub holds, and of the grain
 * most of all. Used by a sack of the hub itself.
 */
export function plunderMarket(world: WorldState, provinceId: string, share: number): WorldState {
  let next = world;
  for (const spec of GOODS) {
    if (spec.id === "slaves") continue;
    const held = stockIn(next, provinceId, spec.id);
    if (held <= 0) continue;
    next = drawStock(next, provinceId, spec.id, held * share * (spec.id === "grain" ? 1 : 0.6)).world;
  }
  return next;
}

/** The share of a hub's stock a sack of the hub itself carries off or burns; a sack of a province in its country takes a seventh of that. */
export const SACK_PLUNDER_OF_HUB = 0.35;
export const SACK_PLUNDER_OF_COUNTRY = 0.05;

/**
 * What a sack does to the market the sacked place belongs to: a share of its
 * stock is plundered or burned (all the grain it can lay hands on, more than
 * the rest), and the people who were put to the sword or sold are partly sold,
 * which puts slaves on the market where the army's side sells them. `share`
 * scales it for a place only partly sacked (a city stormed in a province of
 * several).
 */
export function sackTheMarket(world: WorldState, provinceId: string, people: number, share = 1): WorldState {
  const hub = hubOf(world, provinceId);
  if (hub === null) return world;
  const plundered = plunderMarket(world, provinceId, (hub === provinceId ? SACK_PLUNDER_OF_HUB : SACK_PLUNDER_OF_COUNTRY) * Math.max(0, Math.min(1, share)));
  return takeCaptives(plundered, provinceId, Math.max(0, people));
}

/** The units used in a month at a hub, by good, summed over its country. */
export function hubFlows(world: Pick<WorldState, "map" | "material">): Map<string, { demand: number[]; supply: number[] }> {
  const geography = marketGeography(world);
  const grounds = provinceGrounds(world);
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  const flows = new Map<string, { demand: number[]; supply: number[] }>(geography.hubs.map((hub) => [hub, { demand: [...cache0], supply: [...cache0] }]));
  for (const row of world.material.provinceMaterial) {
    const hub = geography.hubOf.get(row.provinceId);
    const province = provinces.get(row.provinceId);
    const ground = grounds.get(row.provinceId);
    if (hub === undefined || province === undefined || ground === undefined) continue;
    const into = flows.get(hub)!;
    addFlows(row, province, ground, into.demand, into.supply);
  }
  return flows;
}

/**
 * A market's opening: what each hub's country uses a month, and a stock of it
 * to match. Grain opens with the months until the next harvest plus a
 * reserve (`GRAIN_OPENING_RESERVE_MONTHS`); the rest with their target.
 * Prices open at the base. Deterministic and the same for every caller.
 */
export function openingMarkets(world: Pick<WorldState, "map" | "material">, monthsToHarvest: number): MarketHub[] {
  const flows = hubFlows(world);
  const geography = marketGeography(world);
  return geography.hubs.map((hubId) => {
    const flow = flows.get(hubId)!;
    return {
      hubId,
      goods: GOODS.map((spec, index) => {
        const demand = Math.round(flow.demand[index]!);
        const months = index === GRAIN ? monthsToHarvest + GRAIN_OPENING_RESERVE_MONTHS : spec.targetMonths;
        const target = index === GRAIN ? Math.round((monthsToHarvest + GRAIN_RESERVE_MONTHS) * demand) : Math.round(spec.targetMonths * demand);
        const stock = Math.round(months * demand);
        return { good: spec.id, stock, target, demand, priceBps: priceBpsFrom(spec, stock, target) };
      }),
    };
  });
}
