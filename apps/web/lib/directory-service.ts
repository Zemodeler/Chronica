import "server-only";

import { lettersAwaitingYou, lettersDirectory, type AwaitingLetter, type DirectoryGroup } from "@chronica/shared";
import { getContactsView } from "./dialogue-service";
import { withPlayerWorld } from "./player-world";

/**
 * Everyone the letter tray lists (`lettersDirectory`), and the letters from
 * other powers waiting on the player's answer (`lettersAwaitingYou`).
 */
export interface DirectoryView {
  readonly groups: readonly DirectoryGroup[];
  readonly letters: readonly AwaitingLetter[];
}

export async function getLettersDirectory(gameId: string): Promise<DirectoryView | null> {
  return withPlayerWorld(gameId, async ({ world, characterId, playerId, view, db }) => {
    if (characterId === null) return { groups: [], letters: [] };
    const contacts = playerId === null ? [] : await getContactsView(db, gameId, playerId).catch(() => []);
    const offices = view.scenarioGovernment?.offices ?? [];
    return {
      groups: lettersDirectory({
        world,
        viewerId: characterId,
        conversationPartnerIds: contacts.filter((contact) => !contact.isGroup).map((contact) => contact.npcCharacterId).filter((id) => id.length > 0),
        offices,
        clock: view.scenarioClock,
      }),
      letters: lettersAwaitingYou(world, characterId, offices, view.scenarioClock),
    };
  });
}
