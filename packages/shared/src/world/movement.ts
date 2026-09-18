import type { ProvinceEdge, CrossingType } from "./map";
import type { WorldState } from "./world-state";

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
  | { readonly kind: "not_adjacent"; readonly hops: number | null }
  | { readonly kind: "crossing_not_admitted"; readonly crossing: CrossingType };

export type MovementVerdict =
  | { readonly allowed: true; readonly edge: ProvinceEdge }
  | { readonly allowed: false; readonly refusal: MovementRefusal };

const edgesOf = (world: WorldState, provinceId: string): ProvinceEdge[] =>
  world.map.edges.filter((edge) => edge.from === provinceId || edge.to === provinceId);

const otherEnd = (edge: ProvinceEdge, provinceId: string): string => (edge.from === provinceId ? edge.to : edge.from);

/**
 * Whether both sides of an edge admit the way across it.
 *
 * Scenario data rather than a hardcoded table: a period that models sea lanes
 * and one that models mountain passes should not need different game code.
 */
export function crossingAdmitted(world: WorldState, edge: ProvinceEdge, terrains: readonly { readonly id: string; readonly allowedCrossings: readonly CrossingType[] }[]): boolean {
  const terrainOf = (provinceId: string): readonly CrossingType[] | undefined =>
    terrains.find((terrain) => terrain.id === world.map.provinces.find((province) => province.id === provinceId)?.terrainId)?.allowedCrossings;
  const from = terrainOf(edge.from);
  const to = terrainOf(edge.to);
  // A scenario that declares no terrains has no opinion, and an engine that
  // invented one would refuse moves the map plainly allows.
  if (from === undefined || to === undefined) return true;
  return from.includes(edge.crossing) && to.includes(edge.crossing);
}

/** How many edges away, up to a bound. Null when there is no path at all. */
export function hopsBetween(world: WorldState, fromProvinceId: string, toProvinceId: string, limit = 12): number | null {
  if (fromProvinceId === toProvinceId) return 0;
  let frontier = [fromProvinceId];
  const seen = new Set(frontier);
  for (let depth = 1; depth <= limit; depth += 1) {
    const next: string[] = [];
    for (const provinceId of frontier) {
      for (const edge of edgesOf(world, provinceId)) {
        const neighbour = otherEnd(edge, provinceId);
        if (seen.has(neighbour)) continue;
        if (neighbour === toProvinceId) return depth;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    if (next.length === 0) return null;
    frontier = next;
  }
  return null;
}

/**
 * Can this force step to that province now?
 *
 * One step, deliberately. A journey of several provinces is a project with a
 * `force_move` outcome and a date -- that is what makes a march take as long as
 * the road is, instead of as long as the model guessed.
 */
export function canMoveTo(
  world: WorldState,
  fromProvinceId: string,
  toProvinceId: string,
  terrains: readonly { readonly id: string; readonly allowedCrossings: readonly CrossingType[] }[] = [],
): MovementVerdict {
  if (!world.map.provinces.some((province) => province.id === toProvinceId)) {
    return { allowed: false, refusal: { kind: "unknown_province" } };
  }
  const edge = edgesOf(world, fromProvinceId).find((candidate) => otherEnd(candidate, fromProvinceId) === toProvinceId);
  if (edge === undefined) {
    return { allowed: false, refusal: { kind: "not_adjacent", hops: hopsBetween(world, fromProvinceId, toProvinceId) } };
  }
  if (!crossingAdmitted(world, edge, terrains)) {
    return { allowed: false, refusal: { kind: "crossing_not_admitted", crossing: edge.crossing } };
  }
  return { allowed: true, edge };
}
