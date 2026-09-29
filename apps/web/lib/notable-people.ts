import { allOffices, type Office, type WorldState } from "@chronica/shared";

/** Someone of the scenario a player could choose to be. */
export interface NotablePerson {
  readonly name: string;
  /** The highest office they hold, as the world names it: "Roman consul". */
  readonly role: string | null;
  readonly polity: string | null;
}

/**
 * The people of a world the player could step into, for character creation.
 *
 * "Play anyone" is easier to believe when the page shows who is there. This
 * lists the living people the scenario brought, office-holders first by rank
 * and then by standing, at most `perPolity` of any one power so the list is
 * not all Romans. People the world invented in play, and anyone a player
 * already is, are left out.
 */
export function notablePeople(
  world: WorldState,
  scenarioOffices: readonly Office[],
  taken: ReadonlySet<string>,
  { limit = 8, perPolity = 2 }: { readonly limit?: number; readonly perPolity?: number } = {},
): readonly NotablePerson[] {
  const offices = new Map(allOffices(world, scenarioOffices).map((office) => [office.id, office]));
  const held = new Map<string, Office>();
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null || seat.holderCharacterId === undefined) continue;
    const office = offices.get(seat.officeId);
    const before = held.get(seat.holderCharacterId);
    if (office !== undefined && (before === undefined || (office.rank ?? 0) > (before.rank ?? 0))) held.set(seat.holderCharacterId, office);
  }
  const polityName = new Map(world.map.polities.map((polity) => [polity.id, polity.name]));

  const ranked = world.characters
    .filter((character) => character.alive
      && character.legalStatus === "free"
      && character.createdByDirector !== true
      && !character.id.startsWith("declared-")
      && !taken.has(character.id))
    .map((character) => ({
      character,
      office: held.get(character.id) ?? (character.officeId === null ? undefined : offices.get(character.officeId)),
    }))
    .sort((a, b) => (b.office?.rank ?? -1) - (a.office?.rank ?? -1)
      || b.character.prestigeBps - a.character.prestigeBps
      || a.character.id.localeCompare(b.character.id));

  const chosen: NotablePerson[] = [];
  const fromPolity = new Map<string, number>();
  for (const { character, office } of ranked) {
    if (chosen.length >= limit) break;
    const key = character.polityId ?? "";
    const count = fromPolity.get(key) ?? 0;
    if (count >= perPolity) continue;
    fromPolity.set(key, count + 1);
    chosen.push({
      name: character.name,
      role: office?.label ?? null,
      polity: character.polityId === null ? null : polityName.get(character.polityId) ?? null,
    });
  }
  return chosen;
}
