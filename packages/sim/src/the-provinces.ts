import { enemiesOf, fitStrengthOf, stableHash, type Character, type Force, type WorldState } from "@chronica/shared";

/**
 * The Senate assigns the provinces (docs/plans/government.md, "H6 as built").
 *
 * When the year's magistrates take office, the Senate says which consul goes to which army and which front (*provinciae*), by agreement between the colleagues,
 * by lot (*sortitio*), or, where the war is grave, by decree naming the abler man to the graver front. Before this the first colleague without an army was sent
 * to the first army that waited, whoever he was. Here a front is graver by the enemy standing in its province and the men the army has; with two fronts and two
 * colleagues the graver goes by decree to the better soldier (his skill at arms and his name) and the other by lot; with one front the colleagues draw lots
 * for it; where only one man is free, the Senate sends him. A power the player rules is left to him (`command-tenure.ts` does as it did there): the Senate
 * assigns for the powers it governs by rule.
 *
 * The praetor of the courts keeps his province, the city's justice, whatever is allotted. Nothing here asks a decision of the player; deterministic by `stableHash`.
 */

/** One front: an outgoing commander and the armies he holds. */
export interface Front {
  readonly outgoingId: string;
  readonly forces: readonly Force[];
}

/** What was allotted: who goes to take over from whom, and how it was settled. */
export interface Allotment {
  readonly outgoingId: string;
  readonly successorId: string;
  readonly how: "decree" | "lot" | "alone";
  readonly front: string;
  readonly forceIds: readonly string[];
}

/** How grave a front is: the enemy standing in its province, twice over, and the men the army itself has. */
export function graveness(world: WorldState, polityId: string, front: Front): number {
  const enemies = new Set(enemiesOf(world.polityAgreements, polityId));
  const places = new Set(front.forces.map((force) => force.locationId));
  const against = world.material.forces.filter((force) => enemies.has(force.polityId) && places.has(force.locationId)).reduce((sum, force) => sum + fitStrengthOf(force), 0);
  return 2 * against + front.forces.reduce((sum, force) => sum + fitStrengthOf(force), 0);
}

/** How good a soldier a man is thought: his skill at arms and his name. */
export const soldierOf = (man: Character): number => man.skills.martial + man.prestigeBps / 200;

/**
 * The allotment for one power's year: each outgoing commander's front to one of the colleagues who is free, graver fronts first. Returns what is settled; a front with
 * nobody left to send stays unallotted (the old rule takes it).
 */
export function allotTheProvinces(world: WorldState, input: { readonly polityId: string; readonly fronts: readonly Front[]; readonly candidates: readonly Character[]; readonly day: number; readonly gameId: string }): Allotment[] {
  const out: Allotment[] = [];
  if (input.fronts.length === 0 || input.candidates.length === 0) return out;
  const fronts = [...input.fronts].map((front) => ({ front, grave: graveness(world, input.polityId, front) })).sort((a, b) => b.grave - a.grave || a.front.outgoingId.localeCompare(b.front.outgoingId));
  const free = [...input.candidates].sort((a, b) => a.id.localeCompare(b.id));
  const nameOf = (front: Front): string => world.map.provinces.find((province) => province.id === front.forces[0]?.locationId)?.name ?? "the field";
  const year = String(Math.floor(input.day / 360));
  const draw = (front: Front, men: readonly Character[]): Character => [...men].sort((a, b) => stableHash([input.gameId, "sortitio", input.polityId, year, front.outgoingId, a.id]) - stableHash([input.gameId, "sortitio", input.polityId, year, front.outgoingId, b.id]) || a.id.localeCompare(b.id))[0]!;
  for (const [index, { front }] of fronts.entries()) {
    if (free.length === 0) break;
    const graver = index === 0 && fronts.length >= 2 && free.length >= 2;
    const chosen = free.length === 1 ? free[0]! : graver ? [...free].sort((a, b) => soldierOf(b) - soldierOf(a) || a.id.localeCompare(b.id))[0]! : draw(front, free);
    free.splice(free.indexOf(chosen), 1);
    out.push({ outgoingId: front.outgoingId, successorId: chosen.id, how: input.candidates.length === 1 ? "alone" : graver ? "decree" : "lot", front: nameOf(front), forceIds: front.forces.map((force) => force.id) });
  }
  return out;
}

/** The Senate's words for what it settled. */
export function allotmentInWords(world: WorldState, allotments: readonly Allotment[]): string {
  const name = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? "a consul";
  return allotments.map((entry) => `${name(entry.successorId)} to the army in ${entry.front}, ${entry.how === "decree" ? "by decree of the Senate" : entry.how === "lot" ? "by lot" : "the other being held"}`).join("; ");
}
