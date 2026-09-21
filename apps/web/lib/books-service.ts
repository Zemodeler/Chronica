import "server-only";

import { readTheBooks, type Books } from "@chronica/shared";
import { withPlayerWorld } from "./player-world";

/**
 * What a ruler could find out by asking his own quaestor.
 *
 * VISION §7 opens with a worked monthly statement and says ordinary
 * accounting is deterministic and no model should be asked for it. The engine
 * has computed all of it since the economy existed and the web client showed
 * none of it: a map, a Council, a Chronicle and a character sheet, and a
 * player who wanted to know whether he could afford a war had to guess from a
 * balance.
 */
export interface BooksView extends Books {
  readonly currencyName: string;
}

export async function getTheBooks(gameId: string): Promise<BooksView | null> {
  // Through withPlayerWorld, which projects a declared character into the
  // world before reading it. Without that, a consul who opened the Treasury
  // before giving his first order was shown a private citizen's books: until
  // the first burst commits, the stored world is the scenario's authored one
  // and has never heard of him.
  return withPlayerWorld(gameId, ({ world, characterId, view }) => ({
    ...readTheBooks(world, characterId, view.scenarioGovernment?.offices ?? []),
    currencyName: world.material.currency.name,
  }));
}
