import "server-only";

import { correspondenceOf, lettersAwaitingYou, lettersDirectory, readTradeDesk, type AwaitingLetter, type Correspondence, type DirectoryGroup, type TradeDesk } from "@chronica/shared";
import { getContactsView } from "./dialogue-service";
import { withPlayerWorld } from "./player-world";

/**
 * Everyone the letter tray lists (`lettersDirectory`), the letters waiting on
 * the player's answer (`lettersAwaitingYou`), and every correspondence the
 * player has had with a person (`correspondenceOf`).
 */
export interface DirectoryView {
  readonly groups: readonly DirectoryGroup[];
  readonly letters: readonly AwaitingLetter[];
  readonly correspondence: readonly Correspondence[];
  /** What may be proposed to each power in a letter, and to whom it goes (`readTradeDesk`). */
  readonly trade?: TradeDesk;
}

export async function getLettersDirectory(gameId: string): Promise<DirectoryView | null> {
  return withPlayerWorld(gameId, async ({ world, characterId, playerId, view, db }) => {
    if (characterId === null) return { groups: [], letters: [], correspondence: [] };
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
      correspondence: correspondenceOf(world, characterId, view.scenarioClock),
      trade: readTradeDesk(world, characterId, offices),
    };
  });
}
