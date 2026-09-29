import { mayEnterWithoutLeave, type Force, type WorldState } from "@chronica/shared";

/**
 * An army on somebody else's ground without their leave.
 *
 * Borders never stopped an army in this engine and still do not: the map says
 * what ground can be crossed, not whose it is, and a march refused at a border
 * would be the engine deciding a diplomatic question. What changes is that the
 * host now finds out. Before, "ask the Illyrians for passage and pay them gold"
 * and "march through Illyria" came to exactly the same thing, so the letter was
 * decoration; now one of them is a wrong the Illyrians were done, told as news
 * the world's people react to, and the other is not.
 *
 * Null when there is nothing to tell: one's own ground, unclaimed ground, or a
 * host at war with the mover, allied to it, bound to it by protection, or
 * having granted it passage.
 */
export function trespassOf(
  world: WorldState,
  force: Pick<Force, "name" | "polityId">,
  provinceId: string,
): { readonly hostPolityId: string; readonly summary: string } | null {
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  const hostPolityId = province?.controllerPolityId ?? null;
  if (province === undefined || hostPolityId === null) return null;
  if (mayEnterWithoutLeave(world.polityAgreements, force.polityId, hostPolityId)) return null;
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  return {
    hostPolityId,
    summary: `${force.name}, an army of ${name(force.polityId)}, entered ${province.name} without leave from ${name(hostPolityId)}, whose land it is.`,
  };
}
