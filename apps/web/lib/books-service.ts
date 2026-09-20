import "server-only";

import { createDatabase, getWorldView } from "@chronica/db";
import { readTheBooks, type Books } from "@chronica/shared";
import { and, eq } from "drizzle-orm";
import { schema } from "@chronica/db";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { requiredDatabaseUrl } from "./database-url";
import { headers } from "next/headers";

/**
 * What a ruler could find out by asking his own quaestor.
 *
 * VISION §7 opens with a worked monthly statement and says ordinary accounting
 * is deterministic and no model should be asked for it. The engine has
 * computed all of it since the economy existed and the web client showed none
 * of it: a map, a Council, a Chronicle and a character sheet, and a player who
 * wanted to know whether he could afford a war had to guess from a balance.
 */
export interface BooksView extends Books {
  readonly currencyName: string;
}

export async function getTheBooks(gameId: string): Promise<BooksView | null> {
  if (!isAuthenticationConfigured()) return null;
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? null;
  if (userId === null) return null;

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const [player] = await db
      .select({ characterId: schema.players.characterId })
      .from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active")))
      .limit(1);
    const view = await getWorldView(db, gameId);
    if (view === undefined) return null;

    const books = readTheBooks(view.world, player?.characterId ?? null, view.scenarioGovernment?.offices ?? []);
    return {
      ...books,
      currencyName: view.world.material.currency.name,
    };
  } finally {
    await close();
  }
}
