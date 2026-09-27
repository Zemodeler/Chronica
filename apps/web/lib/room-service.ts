import "server-only";

import { buildStation, musterTheForces, readYourStanding, readTheBooks, roomStates, type RoomStates } from "@chronica/shared";
import { withPlayerWorld } from "./player-world";

/**
 * What is in the player's room.
 *
 * An object appears in the Office only when the thing it stands for is true,
 * and only the server can answer that: whether a man commands anyone, holds
 * any office or land, or has books anybody keeps. The shell was guessing from
 * "does this player hold a character at all", which is true of everybody and
 * put an arms rack in a private citizen's room.
 *
 * Four booleans rather than the panels' own payloads, because the room only
 * needs to know what to draw; opening a thing is what fetches it.
 */
export interface RoomContents {
  readonly forces: boolean;
  readonly standing: boolean;
  readonly books: boolean;
  readonly purse: boolean;
  /** What each object says about itself now, and whether it wants the player's word (`roomStates`). */
  readonly states: RoomStates;
}

export async function getRoomContents(gameId: string): Promise<RoomContents | null> {
  return withPlayerWorld(gameId, ({ world, characterId, view }) => {
    if (characterId === null) return { forces: false, standing: false, books: false, purse: false, states: {} };
    const offices = view.scenarioGovernment?.offices ?? [];
    const station = buildStation({ world, characterId, offices });
    const books = readTheBooks(world, characterId, offices);
    const standing = readYourStanding(world, characterId, offices, view.scenarioClock);
    return {
      forces: musterTheForces(world, characterId, offices).forces.length > 0,
      standing: standing.nothing === null,
      books: books.income.length > 0 || books.expenditure.length > 0,
      purse: station.accountIds.size > 0,
      states: roomStates(world, characterId, offices, view.scenarioClock),
    };
  });
}
