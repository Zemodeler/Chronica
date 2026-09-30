import type { Force } from "../material-state";
import type { WorldState } from "../world/world-state";
import { atWar, mayEnterWithoutLeave, sameConfederation } from "../world/agreements";
import { adjacentTo, provinceOf } from "../world/movement";
import { REFERENCE_PROVINCE_KM } from "../world/travel";
import { isWaterCrossing } from "./sea";

/**
 * Where a beaten army goes.
 *
 * The resolver sent every retreating army to the alphabetically first
 * neighbour of the field -- both sides of it, to the same province -- so a
 * Roman legion beaten in Sicily could fall back into Carthage's own ground and
 * the Carthaginians it had just fled could follow it there. An army falls back
 * toward its own: its own power's ground first, then a friend's, then ground
 * nobody is fighting over; toward its depots and its walls; away from where
 * the enemy stands. Into the enemy's hands only when every road leads there.
 *
 * A retreat is a march, not a step: it goes on province after province until
 * it has put a reference province's distance between the army and the field,
 * or the next step would be into the enemy's ground. On a map of small
 * provinces a fall back of one is a fall back of a few miles.
 *
 * Over land only: a beaten army does not embark under the enemy's eyes, so a
 * field with no road off it but the sea has no retreat (`null`), and the
 * army stands where it was beaten.
 */
export function retreatRoute(world: WorldState, force: Force, fromProvinceId: string, enemyPolityIds: ReadonlySet<string>, naval = false): string | null {
  const visited = new Set([fromProvinceId]);
  let at = fromProvinceId;
  let walked = 0;
  while (walked < REFERENCE_PROVINCE_KM) {
    const step = nextRetreatStep(world, force, at, visited, enemyPolityIds, naval, at !== fromProvinceId);
    if (step === null) break;
    walked += adjacentTo(world, at).find((next) => next.provinceId === step)?.edge.distance ?? REFERENCE_PROVINCE_KM;
    visited.add(step);
    at = step;
  }
  return at === fromProvinceId ? null : at;
}

/** The best single step from here; on a march already under way, never into the enemy's ground or upon his men. */
function nextRetreatStep(world: WorldState, force: Force, fromProvinceId: string, visited: ReadonlySet<string>, enemyPolityIds: ReadonlySet<string>, naval: boolean, marching: boolean): string | null {
  const agreements = world.polityAgreements;
  const neighbours = new Set<string>();
  for (const next of adjacentTo(world, fromProvinceId)) {
    if (!naval && isWaterCrossing(next.edge.crossing)) continue;
    if (!visited.has(next.provinceId)) neighbours.add(next.provinceId);
  }
  const hostile = (polityId: string | null): boolean =>
    polityId !== null && polityId !== force.polityId && (enemyPolityIds.has(polityId) || atWar(agreements, force.polityId, polityId));
  const enemyHeld = (provinceId: string): boolean =>
    hostile(provinceOf(world, provinceId)?.controllerPolityId ?? null);

  const scored = [...neighbours].flatMap((provinceId) => {
    const province = provinceOf(world, provinceId);
    if (province === undefined) return [];
    const holder = province.controllerPolityId;
    let score = 0;
    if (holder === force.polityId) score += 100;
    else if (holder !== null && sameConfederation(agreements, force.polityId, holder)) score += 70;
    else if (hostile(holder)) score -= 100;
    else if (holder !== null && mayEnterWithoutLeave(agreements, force.polityId, holder)) score += 40;
    else score += 20;
    // Its own depots and walls.
    for (const structure of world.structures) {
      if (structure.provinceId !== provinceId || structure.ownerPolityId !== force.polityId) continue;
      if (structure.supplyRadius > 0) score += 30;
      if (structure.defensiveEffectsBps > 0) score += 20;
    }
    // Away from the enemy: his armies standing there, and his ground beyond it.
    if (world.material.forces.some((other) => other.locationId === provinceId && hostile(other.polityId))) score -= 80;
    for (const { provinceId: beyond } of adjacentTo(world, provinceId)) {
      if (!visited.has(beyond) && enemyHeld(beyond)) score -= 10;
    }
    if (marching && score < 0) return [];
    return [{ provinceId, score }];
  });
  scored.sort((a, b) => b.score - a.score || a.provinceId.localeCompare(b.provinceId));
  return scored[0]?.provinceId ?? null;
}
