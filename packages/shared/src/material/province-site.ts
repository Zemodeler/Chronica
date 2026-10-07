import type { Province } from "../world/map";
import type { WorldState } from "../world/world-state";
import { RouteHeap } from "../world/movement";
import { GOODS } from "../world/markets";
import { stableHash } from "../determinism";

/**
 * What a province is, about its place, that never changes in a game: why one
 * region grows into a granary and a port and another stays a hamlet in the
 * hills for four centuries. Every piece is derived from the map (terrain, towns,
 * edges, capitals), nothing is stored, and the whole is worked out once per
 * map (`provinceSites`, kept for as long as the province list lives).
 *
 * The permanent ones lift or lower what a province can ever become (its
 * potential, `developmentPotential`): soil, the water and roads about it, the
 * markets and courts near it, what its ground yields beyond its own bread.
 * Others set how quickly it gets there (`soilGrowth`, `agglomeration`,
 * `specialGrowth`, `luck`), and the economy's monthly pass multiplies them with
 * what is not permanent: the tax, the order, the tenure of its holder, how
 * crowded it is, how near a war.
 */
export interface ProvinceSite {
  /** On the sea: a harbour, or a strait or a sea lane to another province. Ships carry a bulk of goods a wagon cannot. */
  readonly coastal: boolean;
  /** No edge to it is open ground: it is reached by passes alone, walled in by mountains. */
  readonly enclosed: boolean;
  /** A crossroads: seven or more ways out and nearly all of them roads. */
  readonly crossroads: boolean;
  /** 0 to 1: how many markets and big towns lie within a few days (saturating); a city lifts its whole neighbourhood. */
  readonly agglomeration: number;
  /** 0 to 1: how near a capital, where a court spends, a garrison buys and officials settle. */
  readonly court: number;
  /** A mine or quarry in the hills, scattered by the luck of the geology. */
  readonly mineral: boolean;
  /** A spring in the desert: a garden among the sands. */
  readonly oasis: boolean;
  /** A desert town on a caravan road, where the camels are watered and the dues taken. */
  readonly caravan: boolean;
  /** What its ground and quays can sell beyond its own needs, in the units of `EXPORT_PREMIUM_BPS` (0 for a place that grows what it eats). */
  readonly exportIndex: number;
  /** How well the soil repays investment, as a multiple of the ordinary rate of building (0.5 to 1.3). */
  readonly soilGrowth: number;
  /** How much a specialisation (a mine, a port's quays, a market's goods) speeds building: 1 to 1.35. */
  readonly specialGrowth: number;
  /** A province's own luck in the speed of building, 0.95 to 1.05, the same every game. */
  readonly luck: number;
  /** Its neighbours' ids in edge order, so the monthly pass looks at them without building a list. */
  readonly neighbours: readonly string[];
}

/** How far a big town's pull reaches in the map's distance units, and how fast it fades (a day or two by road: the fair a farmer walks to). */
const CENTRE_SETTLED_SIZE = 20;
const CENTRE_REACH = 160;
const CENTRE_FADE = 55;
/** A capital's pull is weaker and reaches a little farther: officials, a garrison, a court's spending. */
const COURT_REACH = 240;
const COURT_FADE = 90;
/** Provinces holding a mine, as a share in a hundred of the hills and of the uplands. */
const MINE_IN_HUNDRED: Readonly<Record<string, number>> = { hills: 7, "hills-uplands": 12 };
/** A spring in the desert-steppe, in a hundred. */
const OASIS_IN_HUNDRED = 6;
/** A desert-steppe town at least this big sits on a caravan road. */
const CARAVAN_TOWN_SIZE = 8;
/** The value of what a province can export, in the premium it adds to its potential (bps per unit of `exportIndex`), capped. */
export const EXPORT_PREMIUM_BPS = 200;
export const MAX_EXPORT_PREMIUM_BPS = 450;

/**
 * How well the soil repays building. A plain's fields and a river valley's
 * silt pay back every drachma sunk into drains and orchards; an upland's
 * terraces cost twice the labour for half the crop; the steppe repays
 * almost nothing except at a spring or a caravan town.
 */
const SOIL_GROWTH_BY_TERRAIN: Readonly<Record<string, number>> = {
  "coastal-plain": 1.3,
  hills: 1,
  "hills-uplands": 0.65,
  "mountain-pass": 0.55,
  "desert-steppe": 0.4,
};
const SOIL_GROWTH_OTHERWISE = 0.9;

/**
 * What a terrain's ground yields beyond its own use, in value per head a month
 * (the supply the market gives it for each good above self-sufficiency, times
 * the good's price and use), for the goods that travel: not bread, which is
 * made to be eaten at home, nor slaves, who are the frontier's. Read from the
 * markets' own tables so the premium and the market agree on what a place makes.
 */
function exportIndexOf(province: Pick<Province, "terrainId" | "settlements">): number {
  let index = 0;
  const port = province.settlements.some((settlement) => settlement.kind === "port");
  for (const spec of GOODS) {
    if (spec.id === "grain" || spec.id === "slaves") continue;
    const supply = (spec.supplyByTerrain[province.terrainId] ?? spec.supplyOtherwise) + (port ? spec.portSupply : 0);
    if (supply > 1) index += (supply - 1) * spec.basePrice * spec.perCapitaMonthly;
  }
  return index;
}

/** A bounded multi-source search: for every province, the sum of `weight x exp(-distance / fade)` over the sources within `reach`, then saturating to 0..1. */
function influenceOf(
  provinceIds: readonly string[],
  neighbours: ReadonlyMap<string, readonly { readonly id: string; readonly km: number }[]>,
  sources: ReadonlyMap<string, number>,
  reach: number,
  fade: number,
): Map<string, number> {
  const total = new Map<string, number>();
  for (const [source, weight] of [...sources].sort((a, b) => a[0].localeCompare(b[0]))) {
    const best = new Map<string, number>([[source, 0]]);
    const heap = new RouteHeap();
    heap.push(0, source);
    while (heap.size > 0) {
      const { cost, id } = heap.pop();
      if (cost > (best.get(id) ?? Infinity)) continue;
      total.set(id, (total.get(id) ?? 0) + weight * Math.exp(-cost / fade));
      for (const next of neighbours.get(id) ?? []) {
        const distance = cost + next.km;
        if (distance > reach || distance >= (best.get(next.id) ?? Infinity)) continue;
        best.set(next.id, distance);
        heap.push(distance, next.id);
      }
    }
  }
  const saturated = new Map<string, number>();
  for (const id of provinceIds) saturated.set(id, 1 - Math.exp(-(total.get(id) ?? 0)));
  return saturated;
}

const sitesByProvinces = new WeakMap<readonly Province[], Map<string, ProvinceSite>>();

/** Every province's site, worked out once per map and kept as long as its province list lives. */
export function provinceSites(world: Pick<WorldState, "map">): Map<string, ProvinceSite> {
  const known = sitesByProvinces.get(world.map.provinces);
  if (known !== undefined) return known;
  const provinces = world.map.provinces;
  const ids = provinces.map((province) => province.id);
  const byId = new Map(provinces.map((province) => [province.id, province]));
  const near = new Map<string, { id: string; km: number }[]>();
  const sea = new Set<string>();
  const land = new Map<string, number>();
  const degree = new Map<string, number>();
  for (const edge of world.map.edges) {
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
      const row = near.get(from);
      if (row === undefined) near.set(from, [{ id: to, km: edge.distance }]);
      else row.push({ id: to, km: edge.distance });
      degree.set(from, (degree.get(from) ?? 0) + 1);
      if (edge.crossing === "strait" || edge.crossing === "sea_lane") sea.add(from);
      if (edge.crossing === "land" || edge.crossing === "river") land.set(from, (land.get(from) ?? 0) + 1);
    }
  }
  const sizeOf = (province: Province): number => province.settlements.reduce((total, settlement) => total + settlement.size, 0);
  // Big towns pull with the root of their size (a city of a hundred and fifty draws twice what one of forty does, not four times); courts with the size of the capital town.
  const centres = new Map<string, number>();
  for (const province of provinces) {
    const size = sizeOf(province);
    if (size >= CENTRE_SETTLED_SIZE) centres.set(province.id, Math.min(2, Math.sqrt(size / 40)));
  }
  const homeOf = new Map<string, string>();
  for (const province of provinces) for (const settlement of province.settlements) homeOf.set(settlement.id, province.id);
  const courts = new Map<string, number>();
  for (const polity of world.map.polities) {
    const home = polity.capitalSettlementId == null ? undefined : homeOf.get(polity.capitalSettlementId);
    if (home === undefined) continue;
    const size = sizeOf(byId.get(home)!);
    courts.set(home, Math.max(courts.get(home) ?? 0, Math.max(0.1, Math.min(1, Math.log2(1 + size) / 6))));
  }
  const agglomeration = influenceOf(ids, near, centres, CENTRE_REACH, CENTRE_FADE);
  const court = influenceOf(ids, near, courts, COURT_REACH, COURT_FADE);

  const sites = new Map<string, ProvinceSite>();
  for (const province of provinces) {
    const harbour = province.settlements.some((settlement) => settlement.kind === "port");
    const edges = degree.get(province.id) ?? 0;
    const roads = land.get(province.id) ?? 0;
    const size = sizeOf(province);
    const mineral = stableHash(["deposit", province.id]) % 100 < (MINE_IN_HUNDRED[province.terrainId] ?? 0);
    const desert = province.terrainId === "desert-steppe";
    const oasis = desert && stableHash(["oasis", province.id]) % 100 < OASIS_IN_HUNDRED;
    const caravan = desert && !oasis && size >= CARAVAN_TOWN_SIZE;
    const exportIndex = exportIndexOf(province);
    const soil = oasis ? 1.15 : caravan ? 0.8 : SOIL_GROWTH_BY_TERRAIN[province.terrainId] ?? SOIL_GROWTH_OTHERWISE;
    sites.set(province.id, {
      coastal: harbour || sea.has(province.id),
      enclosed: edges > 0 && roads === 0 && !sea.has(province.id),
      crossroads: edges >= 7 && roads >= 0.85 * edges,
      agglomeration: agglomeration.get(province.id) ?? 0,
      court: court.get(province.id) ?? 0,
      mineral,
      oasis,
      caravan,
      exportIndex,
      soilGrowth: soil,
      specialGrowth: 1 + Math.min(0.35, 0.08 * exportIndex + (mineral ? 0.2 : 0)),
      luck: 0.95 + (stableHash(["growth-luck", province.id]) % 1001) / 10_000,
      neighbours: (near.get(province.id) ?? []).map((other) => other.id),
    });
  }
  sitesByProvinces.set(provinces, sites);
  return sites;
}
