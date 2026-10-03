import { defaultPositionFor, type Force, type WorldState } from "@chronica/shared";

/**
 * Men taken out of an army, every kind of them in proportion.
 *
 * A detachment of 1,200 from a consular army of legionaries, allied foot and
 * horse was the first 1,200 of the first list -- all legionaries -- so a
 * garrison left at Rhegium took none of the horse and the field army kept it
 * all. Every group gives its share; what rounding leaves over comes from the
 * largest groups, so the total is exactly what was asked.
 */
export function proportionalDraw(personnel: Force["personnel"], men: number): number[] {
  const total = personnel.reduce((sum, group) => sum + Math.max(0, group.fit), 0);
  if (total <= 0 || men <= 0) return personnel.map(() => 0);
  const wanted = Math.min(men, total);
  const shares = personnel.map((group) => Math.floor((Math.max(0, group.fit) * wanted) / total));
  let left = wanted - shares.reduce((sum, share) => sum + share, 0);
  const largestFirst = personnel.map((group, index) => ({ index, fit: group.fit })).sort((a, b) => b.fit - a.fit || a.index - b.index);
  while (left > 0) {
    let moved = false;
    for (const { index } of largestFirst) {
      if (left <= 0) break;
      if (shares[index]! < Math.max(0, personnel[index]!.fit)) {
        shares[index] = shares[index]! + 1;
        left -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return shares;
}

/** Whether the order means men left to hold a place: "garrison Rhegium", "the Rhegium garrison", "praesidium". */
export const isGarrison = (text: string): boolean => /garrison|praesidi|hold the (town|city|walls)|to hold\b/i.test(text);

/**
 * A garrison stands in the town and holds it: on the walls of the province's
 * first settlement, under a standing order not to go looking for a battle.
 * Left in the open, a detachment "garrisoning" Rhegium was only a smaller army
 * camped beside it.
 */
export function asGarrison(world: WorldState, force: Force): Force {
  const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
  if (province === undefined) return { ...force, hold: true };
  return { ...force, positionId: defaultPositionFor(province).id, hold: true };
}
