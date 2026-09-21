import "server-only";

import { musterTheForces, type Muster } from "@chronica/shared";
import { withPlayerWorld } from "./player-world";

/**
 * The muster, as the man responsible for it can read it.
 *
 * The only army a player could inspect was one whose standard they clicked on
 * the map, and what it told them was the establishment on paper. Everything
 * here is arithmetic the engine already did.
 */
export interface MusterView extends Muster {
  readonly currencyName: string;
}

export async function getTheMuster(gameId: string): Promise<MusterView | null> {
  return withPlayerWorld(gameId, ({ world, characterId, view }) => ({
    ...musterTheForces(
      world,
      characterId,
      view.scenarioGovernment?.offices ?? [],
      view.scenarioClock,
      view.scenarioWarfare,
    ),
    currencyName: world.material.currency.name,
  }));
}
