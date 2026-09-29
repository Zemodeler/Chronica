import type { CrossingType, Province, ProvinceEdge } from "./map";
import type { WorldState } from "./world-state";
import { isWaterCrossing } from "../warfare/sea";
import { MAX_ROUTE_KM } from "./travel";

/**
 * Whether an army can get there from here (VISION §3's "army continuity").
 *
 * The map graph has been fully specified since the scenario was written --
 * edges carry a crossing type and a distance, terrains declare which crossings
 * they admit, and `map.ts` states the rule that an edge is legal only when both
 * sides admit its crossing. None of it was ever read. `force_modify` checked
 * that the destination province existed and nothing else, so an army could move
 * from Latium to Carthage in a single delta, and the discipline that stopped it
 * was a paragraph of prompt asking the model to make long marches into projects.
 *
 * A rule the engine enforces is worth more than a rule the model remembers.
 */

export type MovementRefusal =
  | { readonly kind: "unknown_province" }
  | { readonly kind: "not_adjacent"; readonly km: number | null }
  | { readonly kind: "crossing_not_admitted"; readonly crossing: CrossingType };

export type MovementVerdict =
  | { readonly allowed: true; readonly edge: ProvinceEdge }
  | { readonly allowed: false; readonly refusal: MovementRefusal };

/** The part of a world the road is read from. */
export type MapWorld = Pick<WorldState, "map">;

export interface Neighbour {
  readonly provinceId: string;
  readonly edge: ProvinceEdge;
}

// The graph changes only when a map is rebuilt, so what is indexed once is kept
// for as long as that list lives. Filtering the whole edge list per visited
// province made a search O(provinces x edges), which a map of thousands cannot
// afford.
const adjacencyByEdges = new WeakMap<readonly ProvinceEdge[], Map<string, Neighbour[]>>();

function adjacencyOf(edges: readonly ProvinceEdge[]): Map<string, Neighbour[]> {
  const cached = adjacencyByEdges.get(edges);
  if (cached !== undefined) return cached;
  const adjacency = new Map<string, Neighbour[]>();
  const push = (from: string, provinceId: string, edge: ProvinceEdge): void => {
    const list = adjacency.get(from);
    if (list === undefined) adjacency.set(from, [{ provinceId, edge }]);
    else list.push({ provinceId, edge });
  };
  for (const edge of edges) {
    push(edge.from, edge.to, edge);
    push(edge.to, edge.from, edge);
  }
  adjacencyByEdges.set(edges, adjacency);
  return adjacency;
}

const NO_NEIGHBOURS: readonly Neighbour[] = [];

/** Every province sharing an edge with this one, with the edge, in edge order. */
export function adjacentTo(world: MapWorld, provinceId: string): readonly Neighbour[] {
  return adjacencyOf(world.map.edges).get(provinceId) ?? NO_NEIGHBOURS;
}

const provincesByList = new WeakMap<readonly Province[], Map<string, Province>>();

/** A province by id, from an index built once per province list. */
export function provinceOf(world: MapWorld, provinceId: string): Province | undefined {
  let index = provincesByList.get(world.map.provinces);
  if (index === undefined) {
    index = new Map(world.map.provinces.map((province) => [province.id, province]));
    provincesByList.set(world.map.provinces, index);
  }
  return index.get(provinceId);
}

type Terrains = readonly { readonly id: string; readonly allowedCrossings: readonly CrossingType[] }[];
const crossingsByTerrains = new WeakMap<Terrains, Map<string, readonly CrossingType[]>>();

/**
 * Whether both sides of an edge admit the way across it.
 *
 * Scenario data rather than a hardcoded table: a period that models sea lanes
 * and one that models mountain passes should not need different game code.
 */
export function crossingAdmitted(world: MapWorld, edge: ProvinceEdge, terrains: Terrains): boolean {
  let byId = crossingsByTerrains.get(terrains);
  if (byId === undefined) {
    byId = new Map(terrains.map((terrain) => [terrain.id, terrain.allowedCrossings]));
    crossingsByTerrains.set(terrains, byId);
  }
  const terrainOf = (provinceId: string): readonly CrossingType[] | undefined => {
    const terrainId = provinceOf(world, provinceId)?.terrainId;
    return terrainId === undefined ? undefined : byId.get(terrainId);
  };
  const from = terrainOf(edge.from);
  const to = terrainOf(edge.to);
  // A scenario that declares no terrains has no opinion, and an engine that
  // invented one would refuse moves the map plainly allows.
  if (from === undefined || to === undefined) return true;
  return from.includes(edge.crossing) && to.includes(edge.crossing);
}

/** A binary min-heap of (cost, province) pairs. */
class RouteHeap {
  private readonly costs: number[] = [];
  private readonly ids: string[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(cost: number, id: string): void {
    let at = this.ids.length;
    this.costs.push(cost);
    this.ids.push(id);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.costs[parent]! <= cost) break;
      this.costs[at] = this.costs[parent]!;
      this.ids[at] = this.ids[parent]!;
      at = parent;
    }
    this.costs[at] = cost;
    this.ids[at] = id;
  }

  pop(): { cost: number; id: string } {
    const cost = this.costs[0]!;
    const id = this.ids[0]!;
    const lastCost = this.costs.pop()!;
    const lastId = this.ids.pop()!;
    const size = this.ids.length;
    if (size > 0) {
      let at = 0;
      for (;;) {
        let child = 2 * at + 1;
        if (child >= size) break;
        if (child + 1 < size && this.costs[child + 1]! < this.costs[child]!) child += 1;
        if (this.costs[child]! >= lastCost) break;
        this.costs[at] = this.costs[child]!;
        this.ids[at] = this.ids[child]!;
        at = child;
      }
      this.costs[at] = lastCost;
      this.ids[at] = lastId;
    }
    return { cost, id };
  }
}

export interface RouteOptions {
  /** The furthest a route may run, in kilometres (or in the units of `cost`). Beyond it, there is no route. */
  readonly budgetKm?: number;
  /** Which edges may be used. All, by default. */
  readonly passable?: (edge: ProvinceEdge) => boolean;
  /** What an edge costs. Its `distance` in kilometres, by default; news costs it in days. */
  readonly cost?: (edge: ProvinceEdge) => number;
  /** Stop as soon as this province is settled. */
  readonly target?: string;
}

/**
 * The shortest route, in kilometres, from any of these provinces to every
 * province within reach: Dijkstra over the cached adjacency, bounded by a
 * kilometre budget. A province absent from the result is out of reach.
 */
export function kmFromAny(world: MapWorld, sources: Iterable<string>, options: RouteOptions = {}): Map<string, number> {
  const budget = options.budgetKm ?? MAX_ROUTE_KM;
  const passable = options.passable;
  const costOf = options.cost ?? ((edge: ProvinceEdge) => edge.distance);
  const adjacency = adjacencyOf(world.map.edges);
  const settled = new Map<string, number>();
  const best = new Map<string, number>();
  const heap = new RouteHeap();
  for (const source of sources) {
    best.set(source, 0);
    heap.push(0, source);
  }
  while (heap.size > 0) {
    const { cost, id } = heap.pop();
    if (settled.has(id)) continue;
    settled.set(id, cost);
    if (id === options.target) break;
    for (const next of adjacency.get(id) ?? NO_NEIGHBOURS) {
      if (passable !== undefined && !passable(next.edge)) continue;
      const total = cost + costOf(next.edge);
      if (total > budget || total >= (best.get(next.provinceId) ?? Infinity)) continue;
      best.set(next.provinceId, total);
      heap.push(total, next.provinceId);
    }
  }
  return settled;
}

/** Kilometres from one province to every province within reach. */
export function kmFrom(world: MapWorld, fromProvinceId: string, options: RouteOptions = {}): Map<string, number> {
  return kmFromAny(world, [fromProvinceId], options);
}

function routeKm(world: MapWorld, fromProvinceId: string, toProvinceId: string, options: RouteOptions): number | null {
  if (fromProvinceId === toProvinceId) return 0;
  return kmFromAny(world, [fromProvinceId], { ...options, target: toProvinceId }).get(toProvinceId) ?? null;
}

/**
 * How far off, in kilometres, by the shortest way over anything that is a road
 * or a sea lane. Null when there is no way within the budget.
 */
export function kmBetween(world: MapWorld, fromProvinceId: string, toProvinceId: string, budgetKm = MAX_ROUTE_KM): number | null {
  return routeKm(world, fromProvinceId, toProvinceId, { budgetKm });
}

/**
 * How far off on foot: no strait, no sea lane. Null when the only ways there
 * are over water.
 *
 * A march was allowed wherever a path was found, and the path from Latium to
 * Messana runs over the strait -- so "Transport Legio I across the strait"
 * completed with no ship in it, Syracuse having refused to lend one.
 */
export function landKmBetween(world: MapWorld, fromProvinceId: string, toProvinceId: string, budgetKm = MAX_ROUTE_KM): number | null {
  return routeKm(world, fromProvinceId, toProvinceId, { budgetKm, passable: (edge) => !isWaterCrossing(edge.crossing) });
}

/** How far off using only crossings this admits. Null when there is no such way. */
export function strictKmBetween(world: MapWorld, fromProvinceId: string, toProvinceId: string, admits: (crossing: CrossingType) => boolean, budgetKm = MAX_ROUTE_KM): number | null {
  return routeKm(world, fromProvinceId, toProvinceId, { budgetKm, passable: (edge) => admits(edge.crossing) });
}

/**
 * Can this force step to that province now?
 *
 * One step, deliberately. A journey of several provinces is a project with a
 * `force_move` outcome and a date -- that is what makes a march take as long as
 * the road is, instead of as long as the model guessed.
 */
export function canMoveTo(
  world: MapWorld,
  fromProvinceId: string,
  toProvinceId: string,
  terrains: readonly { readonly id: string; readonly allowedCrossings: readonly CrossingType[] }[] = [],
): MovementVerdict {
  if (provinceOf(world, toProvinceId) === undefined) {
    return { allowed: false, refusal: { kind: "unknown_province" } };
  }
  const edge = adjacentTo(world, fromProvinceId).find((candidate) => candidate.provinceId === toProvinceId)?.edge;
  if (edge === undefined) {
    return { allowed: false, refusal: { kind: "not_adjacent", km: kmBetween(world, fromProvinceId, toProvinceId) } };
  }
  if (!crossingAdmitted(world, edge, terrains)) {
    return { allowed: false, refusal: { kind: "crossing_not_admitted", crossing: edge.crossing } };
  }
  return { allowed: true, edge };
}
