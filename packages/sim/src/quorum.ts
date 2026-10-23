import { fitStrengthOf, stableHash, type GovernmentInstitution, type WorldState } from "@chronica/shared";

/**
 * A body needs its quorum, and the men who are away do not sit (docs/plans/government.md, "H6 as built").
 *
 * A consul with an army in Sicily was not in the Senate, nor a legate with the fleet; and when the legions were out the people who voted in the centuries were
 * the men who had stayed behind. A member of a chamber who leads an army in the field away from his city, or stands in the country of another power, is away: his
 * seat gives no vote on the day, and a chamber whose present members fall short of its quorum cannot decide (`countVote`: "could not muster a quorum"). A
 * chamber of the people is thinned by the share of its citizens under arms: the more of the men are in the field, the fewer of them the assembly counts.
 *
 * Read off the forces (`Force.commanderCharacterId`, `locationId`) and where each man stands (`Character.locationProvinceId`); nothing is stored.
 */

/** The most of an assembly's unnamed seats that service abroad takes from it. */
export const MOST_AWAY_SHARE = 0.35;
/** The share of a people that can bear arms, as a share of the whole: what the men in the field are counted against. */
export const MEN_OF_ARMS_SHARE = 0.2;

/** The province a power's chambers sit in: that of its capital, else nowhere in particular. */
function cityOf(world: WorldState, polityId: string): string | null {
  const capital = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
  if (capital === null) return null;
  return world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id ?? null;
}

/** The men of a power who are away from its city: at the head of an army in the field elsewhere, or in a land that is another power's. */
export function awayFromTheCity(world: WorldState, polityId: string): ReadonlySet<string> {
  const city = cityOf(world, polityId);
  const away = new Set<string>();
  if (city === null) return away;
  const controller = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  for (const force of world.material.forces) {
    if (force.polityId !== polityId || force.outlaw === true || fitStrengthOf(force) <= 0 || force.locationId === city) continue;
    for (const id of [force.commanderCharacterId, force.controllerCharacterId]) if (typeof id === "string") away.add(id);
  }
  for (const character of world.characters) {
    if (!character.alive || character.polityId !== polityId || away.has(character.id)) continue;
    const place = character.locationProvinceId;
    const holder = place === null ? undefined : controller.get(place);
    if (holder !== undefined && holder !== null && holder !== polityId && place !== city) away.add(character.id);
  }
  return away;
}

/** The share of an assembly's citizens that are under arms away from the city: men in the field against the men who could bear arms. */
export function underArmsShare(world: WorldState, polityId: string): number {
  const city = cityOf(world, polityId);
  if (city === null) return 0;
  let fielded = 0;
  for (const force of world.material.forces) if (force.polityId === polityId && force.outlaw !== true && force.locationId !== city) fielded += fitStrengthOf(force);
  if (fielded <= 0) return 0;
  const held = new Set(world.map.provinces.filter((province) => province.controllerPolityId === polityId).map((province) => province.id));
  let people = 0;
  for (const row of world.material.provinceMaterial) if (held.has(row.provinceId)) people += row.population;
  return people <= 0 ? 0 : Math.min(MOST_AWAY_SHARE, fielded / (people * MEN_OF_ARMS_SHARE));
}

/** What keeps members of a chamber from its sitting today: the named men away, and the share of its unnamed seats under arms (an assembly of the people only). */
export interface Absence {
  readonly named: ReadonlySet<string>;
  readonly unnamedShare: number;
}

const NONE: Absence = { named: new Set(), unnamedShare: 0 };

export function absenceFrom(world: WorldState, institution: GovernmentInstitution): Absence {
  if (world.material.forces.length === 0) return NONE;
  const named = awayFromTheCity(world, institution.polityId);
  const people = institution.franchise === "citizens" || institution.franchise === "soldiers";
  const unnamedShare = people ? underArmsShare(world, institution.polityId) : 0;
  return named.size === 0 && unnamedShare === 0 ? NONE : { named, unnamedShare };
}

/** Whether a seat is empty today: its man is away, or (an unnamed seat of an assembly) its citizen is under arms; the same answer for the same question every time. */
export function seatIsEmpty(absence: Absence, seat: { readonly id: string; readonly characterId: string | null }, questionId: string): boolean {
  if (seat.characterId !== null) return absence.named.has(seat.characterId);
  return absence.unnamedShare > 0 && stableHash([seat.id, questionId, "away"]) % 10_000 < absence.unnamedShare * 10_000;
}
