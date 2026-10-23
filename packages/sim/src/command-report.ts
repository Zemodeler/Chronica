import { formatWorldDate, type ScenarioClock, type WorldState } from "@chronica/shared";
import { hostile } from "./engagements";

/**
 * A force's name without the place it was raised at. A levy is named "Levy of Kingdom of Epirus at Coast of the Athamania" the day it is
 * raised, and went on being called that on the far side of Acarnania ("... at Coast of the Athamania at Acarnania on the Inachos"):
 * the place it stands in is said beside it, not in it.
 */
export function forceNameWithoutBirthplace(world: WorldState, name: string): string {
  const at = name.lastIndexOf(" at ");
  if (at <= 0) return name;
  const tail = name.slice(at + 4);
  return world.map.provinces.some((province) => province.name === tail) ? name.slice(0, at) : name;
}

/**
 * What a commander reads of his own command without leaving the table (round 5, H2): who stands in the province with his army,
 * what is in the army's chest and his own purse, and how long the bread lasts. The burst output gave only men fit and morale; the
 * order prompt and the web page's force card gave the rest, so a player of the script could not tell why an order was refused or
 * what to buy.
 */
export function commandReport(world: WorldState, playerId: string, clock?: ScenarioClock): string[] {
  const lines: string[] = [];
  const dateOf = (day: number): string => (clock === undefined ? `day ${day}` : formatWorldDate({ day, minute: 0 }, clock));
  const fit = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, row) => sum + row.fit, 0);
  const placeName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const mine = world.material.forces.filter((force) => force.commanderCharacterId === playerId);
  for (const force of mine) {
    const left = force.provisionedThroughStep - world.elapsedStep;
    lines.push(`  bread: ${forceNameWithoutBirthplace(world, force.name)} ${left <= 0 ? "has no bread left" : `has bread until about ${dateOf(force.provisionedThroughStep)} (${left} days)`}`);
    const chest = world.material.accounts.find((account) => account.owner.kind === "force" && account.owner.id === force.id);
    if (chest !== undefined) lines.push(`  chest: the war chest of ${forceNameWithoutBirthplace(world, force.name)} holds ${Math.round(chest.balance)}`);
    const here = world.material.forces.filter((other) => other.id !== force.id && other.locationId === force.locationId && hostile(world, force, other));
    const bySide = new Map<string, { names: string[]; men: number }>();
    for (const enemy of here) {
      const entry = bySide.get(enemy.polityId) ?? { names: [], men: 0 };
      entry.names.push(enemy.name);
      entry.men += fit(enemy);
      bySide.set(enemy.polityId, entry);
    }
    for (const [polityId, entry] of bySide) {
      const polity = world.map.polities.find((candidate) => candidate.id === polityId)?.name ?? polityId;
      lines.push(`  enemy in ${placeName(force.locationId)}: ${polity}, about ${Math.max(100, Math.round(entry.men / 100) * 100)} men (${entry.names.join(", ")})`);
    }
  }
  const me = world.characters.find((character) => character.id === playerId);
  const purse = me?.personalAccountId == null ? undefined : world.material.accounts.find((account) => account.id === me.personalAccountId);
  if (purse !== undefined) lines.push(`  purse: ${Math.round(purse.balance)}`);
  return lines;
}
