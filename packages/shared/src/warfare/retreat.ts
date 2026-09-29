import type { Force } from "../material-state";
import type { WorldState } from "../world/world-state";
import { atWar, mayEnterWithoutLeave, sameConfederation } from "../world/agreements";
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
 * Over land only: a beaten army does not embark under the enemy's eyes, so a
 * field with no road off it but the sea has no retreat (`null`), and the
 * army stands where it was beaten.
 */
export function retreatRoute(world: WorldState, force: Force, fromProvinceId: string, enemyPolityIds: ReadonlySet<string>, naval = false): string | null {
  const agreements = world.polityAgreements;
  const neighbours = new Set<string>();
  for (const edge of world.map.edges) {
    if (!naval && isWaterCrossing(edge.crossing)) continue;
    if (edge.from === fromProvinceId) neighbours.add(edge.to);
    else if (edge.to === fromProvinceId) neighbours.add(edge.from);
  }
  const hostile = (polityId: string | null): boolean =>
    polityId !== null && polityId !== force.polityId && (enemyPolityIds.has(polityId) || atWar(agreements, force.polityId, polityId));
  const enemyHeld = (provinceId: string): boolean =>
    hostile(world.map.provinces.find((province) => province.id === provinceId)?.controllerPolityId ?? null);

  const scored = [...neighbours].flatMap((provinceId) => {
    const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
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
    for (const edge of world.map.edges) {
      const beyond = edge.from === provinceId ? edge.to : edge.to === provinceId ? edge.from : null;
      if (beyond !== null && beyond !== fromProvinceId && enemyHeld(beyond)) score -= 10;
    }
    return [{ provinceId, score }];
  });
  scored.sort((a, b) => b.score - a.score || a.provinceId.localeCompare(b.provinceId));
  return scored[0]?.provinceId ?? null;
}
