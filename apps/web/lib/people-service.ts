import "server-only";

import { peopleYouKnow, readPerson, type PersonReading } from "@chronica/shared";
import { getContactsView } from "./dialogue-service";
import { withPlayerWorld } from "./player-world";

/**
 * Everyone the player knows, and what they know of them.
 *
 * Two lists that never consulted each other are joined here: world state
 * knows who you have had dealings with, the dialogue layer knows who you have
 * written to. A person reachable by only one of those routes was invisible to
 * the other.
 *
 * Everything crossing this boundary is hearsay by construction -- see
 * `acquaintance.ts`, which is where the rules about what may and may not be
 * said about somebody else live.
 */
export interface PeopleView {
  readonly people: readonly PersonReading[];
}

export async function getPeopleYouKnow(gameId: string): Promise<PeopleView | null> {
  return withPlayerWorld(gameId, async ({ world, characterId, playerId, view, db }) => {
    if (characterId === null) return { people: [] };
    const contacts = playerId === null ? [] : await getContactsView(db, gameId, playerId).catch(() => []);
    return {
      people: peopleYouKnow({
        world,
        viewerId: characterId,
        conversationPartnerIds: contacts.map((contact) => contact.npcCharacterId).filter((id) => id.length > 0),
        offices: view.scenarioGovernment?.offices ?? [],
        clock: view.scenarioClock,
      }),
    };
  });
}

/** One person, for the detail view. Null when the viewer has no business seeing them. */
export async function getPerson(gameId: string, subjectId: string): Promise<PersonReading | null> {
  return withPlayerWorld(gameId, async ({ world, characterId, playerId, view, db }) => {
    if (characterId === null) return null;
    const contacts = playerId === null ? [] : await getContactsView(db, gameId, playerId).catch(() => []);
    const partnerIds = contacts.map((contact) => contact.npcCharacterId).filter((id) => id.length > 0);
    // Gated on the same membership the list uses: a detail route that reads
    // anybody by id would be a way round the whole epistemic layer.
    const known = peopleYouKnow({ world, viewerId: characterId, conversationPartnerIds: partnerIds, offices: view.scenarioGovernment?.offices ?? [], clock: view.scenarioClock });
    if (!known.some((person) => person.id === subjectId)) return null;
    return readPerson({
      world, viewerId: characterId, subjectId,
      conversationPartnerIds: partnerIds,
      offices: view.scenarioGovernment?.offices ?? [],
      clock: view.scenarioClock,
    });
  }).then((result) => result ?? null);
}
