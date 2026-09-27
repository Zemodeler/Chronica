import "server-only";

import { whatComesNext, type CalendarItem } from "@chronica/shared";
import { withPlayerWorld } from "./player-world";

/**
 * What is coming, as this player could know it (`whatComesNext`): the next
 * few dated things in their world, for the line beside the date.
 */
export async function getWhatComesNext(gameId: string): Promise<readonly CalendarItem[] | null> {
  return withPlayerWorld(gameId, ({ world, characterId, view }) =>
    whatComesNext(world, characterId, view.scenarioGovernment?.offices ?? [], view.scenarioClock));
}
