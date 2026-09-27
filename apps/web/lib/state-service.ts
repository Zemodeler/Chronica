import "server-only";

import { readTheState, type StateReading } from "@chronica/shared";
import { withPlayerWorld } from "./player-world";

/** The state the player serves (`readTheState`), for the seal case. */
export async function getTheState(gameId: string): Promise<StateReading | null> {
  return withPlayerWorld(gameId, ({ world, characterId, view }) =>
    readTheState(world, characterId, view.scenarioGovernment?.offices ?? [], view.scenarioClock));
}
