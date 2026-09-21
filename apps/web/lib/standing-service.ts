import "server-only";

import { readYourStanding, type Standing } from "@chronica/shared";
import { withPlayerWorld } from "./player-world";

/**
 * What a person holds: the offices, the powers, and the land.
 *
 * describeAuthority has produced these phrases since the authority index was
 * written and only ever written them into prompts. The player could see the
 * name of their office and never what it let them do.
 */
export async function getYourStanding(gameId: string): Promise<Standing | null> {
  return withPlayerWorld(gameId, ({ world, characterId, view }) =>
    readYourStanding(world, characterId, view.scenarioGovernment?.offices ?? [], view.scenarioClock));
}
