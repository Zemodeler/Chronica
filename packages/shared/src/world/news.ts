import type { Fact } from "./facts";
import type { WorldInstant } from "./instant";
import type { CrossingType, ProvinceEdge } from "./map";
import type { OrderPartyRef } from "./party-ref";
import type { WorldState } from "./world-state";

/**
 * How long word takes to get from where a thing happened to where somebody is.
 *
 * News did not travel. `knowableAtInstant` was one instant for the whole world,
 * and the model set it or nobody did, so a battle in Sicily was known in Rome,
 * in Carthage and on the Rhône the hour it was fought -- and a letter reached
 * Syracuse the day it was written in Latium. This is the road instead: the
 * province graph, walked at a courier's pace, from the places a fact names to
 * the place its reader is.
 *
 * One rule, read in one place (`newsArrivesAt`), by everything that asks what a
 * person knows: `factsKnownTo`, the station's narrowing of it, the Chronicle,
 * the attention router and the map.
 */

/** The part of the world the road is read from. */
export type NewsWorld = Pick<WorldState, "map" | "characters" | "material">;

/**
 * Days a rider or a boat takes over one border. A province here is a region --
 * Latium, Bruttium, western Sicily -- and a courier on the roads makes one in
 * about two days; a strait is a morning's crossing, an open sea lane two days'
 * sail; a mountain pass is slower than the plain.
 */
export const NEWS_DAYS_BY_CROSSING: Readonly<Record<CrossingType, number>> = {
  land: 2,
  river: 2,
  pass: 3,
  strait: 1,
  sea_lane: 2,
};

/**
 * However far, word gets there within a month. Beyond that the graph is
 * measuring the map's gaps -- Athens is twenty borders from Rome by land
 * because the map has no sea lane over the Ionian -- not the road.
 */
export const MAX_NEWS_DAYS = 30;

const MINUTES_PER_DAY = 1440;
const sortKeyOf = (instant: WorldInstant): number => instant.day * MINUTES_PER_DAY + instant.minute;

// The graph changes only when a map is rebuilt, so what is walked once is kept
// for as long as that edge list lives: a slice asks for hundreds of facts
// read from a handful of places.
const adjacencyByEdges = new WeakMap<readonly ProvinceEdge[], Map<string, { readonly to: string; readonly days: number }[]>>();
const daysByEdges = new WeakMap<readonly ProvinceEdge[], Map<string, ReadonlyMap<string, number>>>();

function adjacencyOf(edges: readonly ProvinceEdge[]): Map<string, { readonly to: string; readonly days: number }[]> {
  const cached = adjacencyByEdges.get(edges);
  if (cached !== undefined) return cached;
  const adjacency = new Map<string, { to: string; days: number }[]>();
  for (const edge of edges) {
    const days = NEWS_DAYS_BY_CROSSING[edge.crossing];
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), { to: edge.to, days }]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), { to: edge.from, days }]);
  }
  adjacencyByEdges.set(edges, adjacency);
  return adjacency;
}

/** Days by road from one province to every province there is a road to. */
function newsDaysFrom(world: NewsWorld, fromProvinceId: string): ReadonlyMap<string, number> {
  const edges = world.map.edges;
  let bySource = daysByEdges.get(edges);
  if (bySource === undefined) {
    bySource = new Map();
    daysByEdges.set(edges, bySource);
  }
  const cached = bySource.get(fromProvinceId);
  if (cached !== undefined) return cached;
  // Crossings cost whole days, so a bucket per day is an exact Dijkstra.
  const adjacency = adjacencyOf(edges);
  const days = new Map<string, number>([[fromProvinceId, 0]]);
  const buckets: string[][] = [[fromProvinceId]];
  for (let day = 0; day < buckets.length; day += 1) {
    for (const provinceId of buckets[day] ?? []) {
      if (days.get(provinceId) !== day) continue;
      for (const next of adjacency.get(provinceId) ?? []) {
        const arrives = day + next.days;
        if (arrives >= (days.get(next.to) ?? Infinity)) continue;
        days.set(next.to, arrives);
        (buckets[arrives] ??= []).push(next.to);
      }
    }
  }
  bySource.set(fromProvinceId, days);
  return days;
}

/**
 * Days word takes between two provinces, never more than `MAX_NEWS_DAYS`.
 *
 * Where the map has no road between them at all it cannot say how far they
 * are, and holds nothing back: a scenario drawn without borders is not a world
 * in which nobody hears anything for a month.
 */
export function newsDaysBetween(world: NewsWorld, fromProvinceId: string, toProvinceId: string): number {
  if (fromProvinceId === toProvinceId) return 0;
  return Math.min(MAX_NEWS_DAYS, newsDaysFrom(world, fromProvinceId).get(toProvinceId) ?? 0);
}

interface Whereabouts {
  readonly provinceIds: ReadonlySet<string>;
  readonly ofCharacter: ReadonlyMap<string, string>;
  readonly ofForce: ReadonlyMap<string, string>;
  readonly ofSettlement: ReadonlyMap<string, string>;
  readonly ofCapital: ReadonlyMap<string, string>;
}

const whereaboutsByWorld = new WeakMap<NewsWorld, Whereabouts>();

function whereaboutsOf(world: NewsWorld): Whereabouts {
  const cached = whereaboutsByWorld.get(world);
  if (cached !== undefined) return cached;
  const ofSettlement = new Map(world.map.provinces.flatMap((province) => province.settlements.map((settlement) => [settlement.id, province.id] as const)));
  const ofCapital = new Map(world.map.polities.flatMap((polity) => {
    const provinceId = polity.capitalSettlementId === null ? undefined : ofSettlement.get(polity.capitalSettlementId);
    return provinceId === undefined ? [] : [[polity.id, provinceId] as const];
  }));
  const whereabouts: Whereabouts = {
    provinceIds: new Set(world.map.provinces.map((province) => province.id)),
    ofCharacter: new Map(world.characters.map((character) => [character.id, character.locationProvinceId])),
    ofForce: new Map(world.material.forces.map((force) => [force.id, force.locationId])),
    ofSettlement,
    ofCapital,
  };
  whereaboutsByWorld.set(world, whereabouts);
  return whereabouts;
}

/**
 * Where a thing happened: the places it names, the ground its armies and
 * people stand on. A fact naming only powers happened at the first one's seat
 * -- the acting power is the one a fact names first -- and a fact naming
 * nothing with a place happened nowhere in particular, and is everywhere at once.
 */
export function whereItHappened(world: NewsWorld, fact: Pick<Fact, "affectedEntities">): string[] {
  const where = whereaboutsOf(world);
  const places = new Set<string>();
  for (const entity of fact.affectedEntities) {
    const provinceId = entity.kind === "province" ? (where.provinceIds.has(entity.id) ? entity.id : undefined)
      : entity.kind === "force" ? where.ofForce.get(entity.id)
        : entity.kind === "character" ? where.ofCharacter.get(entity.id)
          : entity.kind === "settlement" ? where.ofSettlement.get(entity.id)
            : undefined;
    if (provinceId !== undefined) places.add(provinceId);
  }
  if (places.size > 0) return [...places];
  const firstPower = fact.affectedEntities.find((entity) => entity.kind === "polity");
  const seat = firstPower === undefined ? undefined : where.ofCapital.get(firstPower.id);
  return seat === undefined ? [] : [seat];
}

/** Where somebody hears things: where a person stands, a power's capital, an army's camp. */
export function whereTheyHear(world: NewsWorld, observer: OrderPartyRef): string | null {
  const where = whereaboutsOf(world);
  switch (observer.kind) {
    case "character": return where.ofCharacter.get(observer.id) ?? null;
    case "polity": return where.ofCapital.get(observer.id) ?? null;
    case "force": return where.ofForce.get(observer.id) ?? null;
    case "province": return where.provinceIds.has(observer.id) ? observer.id : null;
    case "settlement": return where.ofSettlement.get(observer.id) ?? null;
    default: return null;
  }
}

/**
 * When word of this fact reaches this observer, as a sort key.
 *
 * The road from the nearest place it names to where they are, and never
 * before the fact's own `knowableAtInstant` -- which is the model's or the
 * engine's word that something travels slower than the road: a secret out,
 * a rumour spreading. Without a world there is no road, and the fact's own
 * instant is all there is.
 */
export function newsArrivesAt(world: NewsWorld | undefined, fact: Pick<Fact, "time" | "discovery" | "affectedEntities">, observer: OrderPartyRef): number {
  const happened = sortKeyOf(fact.time);
  const floor = fact.discovery.knowableAtInstant === null ? happened : Math.max(happened, sortKeyOf(fact.discovery.knowableAtInstant));
  if (world === undefined) return floor;
  const seat = whereTheyHear(world, observer);
  if (seat === null) return floor;
  const places = whereItHappened(world, fact);
  if (places.length === 0) return floor;
  const days = Math.min(...places.map((place) => newsDaysBetween(world, place, seat)));
  return Math.max(floor, happened + days * MINUTES_PER_DAY);
}

/** Whether word of this fact has reached this observer by then. */
export function newsHasReached(world: NewsWorld | undefined, fact: Pick<Fact, "time" | "discovery" | "affectedEntities">, observer: OrderPartyRef, atInstant: WorldInstant): boolean {
  const at = sortKeyOf(atInstant);
  // Old news is everywhere: nothing takes longer than a month and the floor.
  const happened = sortKeyOf(fact.time);
  const knowable = fact.discovery.knowableAtInstant === null ? happened : sortKeyOf(fact.discovery.knowableAtInstant);
  if (happened + MAX_NEWS_DAYS * MINUTES_PER_DAY <= at && knowable <= at) return true;
  return newsArrivesAt(world, fact, observer) <= at;
}

/**
 * The days word of this fact reaches any of these places, as sort keys, first
 * first. A burst's calendar has to stop on them: a battle in Sicily is Rome's
 * business the day the rider comes in, not the day it was fought, and a burst
 * that only knew the day it was fought had already walked past it -- the
 * reader woke to nothing, and the next chain took it for old news.
 */
export function newsArrivalsAt(world: NewsWorld, fact: Pick<Fact, "time" | "discovery" | "affectedEntities">, seats: Iterable<string>): number[] {
  const happened = sortKeyOf(fact.time);
  const floor = fact.discovery.knowableAtInstant === null ? happened : Math.max(happened, sortKeyOf(fact.discovery.knowableAtInstant));
  const places = whereItHappened(world, fact);
  if (places.length === 0) return [floor];
  const keys = new Set<number>();
  for (const seat of seats) {
    const days = Math.min(...places.map((place) => newsDaysBetween(world, place, seat)));
    keys.add(Math.max(floor, happened + days * MINUTES_PER_DAY));
  }
  if (keys.size === 0) keys.add(floor);
  return [...keys].sort((a, b) => a - b);
}
