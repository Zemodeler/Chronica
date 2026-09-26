import "server-only";

import { ordersUnderWay, type UnderWayItem } from "@chronica/shared";
import { withPlayerWorld } from "./player-world";

/** What the player's orders are doing (`ordersUnderWay`), for the desk. */
export async function getOrdersUnderWay(gameId: string): Promise<readonly UnderWayItem[] | null> {
  return withPlayerWorld(gameId, ({ world, characterId, view }) =>
    ordersUnderWay(world, characterId, view.scenarioGovernment?.offices ?? [], view.scenarioClock));
}
