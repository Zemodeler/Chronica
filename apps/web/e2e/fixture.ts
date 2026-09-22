import { expect, type Page } from "@playwright/test";
import { createDatabase, schema } from "@chronica/db";
import { and, eq } from "drizzle-orm";
import { seededWorlds } from "./paths";

/**
 * A signed-in player, in a real save, at a real world.
 *
 * Everything here goes through the actual UI except the character
 * declaration, which is AI-driven and out of scope for a test about the
 * Office. That one step is written straight into Postgres, the same way the
 * spec that used to live here did it.
 */

const DATABASE_URL = process.env.DATABASE_URL?.trim() || "postgres://chronica:chronica@localhost:5432/chronica";

/** The scenario's seated consul: an office, an army, and a treasury to draw on. */
export const CONSUL = "gaius-genucius";
/** A man with no office, no command and no land. His room is nearly bare. */
export const PRIVATE_CITIZEN = "manius-curius";
/** Carthage's commander, for the room that is not the Roman one. */
export const CARTHAGINIAN = "hanno-carthage";

export const extractGameId = (url: string): string => {
  const match = /\/games\/([0-9a-fA-F-]{36})/.exec(url);
  if (match === null) throw new Error(`No gameId in URL: ${url}`);
  return match[1]!;
};

/**
 * Put the player in a character the scenario already holds, and fund the
 * wallet the coin gate checks even in mock mode.
 */
export async function beThisCharacter(gameId: string, characterId: string): Promise<void> {
  const { db, close } = createDatabase(DATABASE_URL);
  try {
    const [player] = await db
      .select({ id: schema.players.id, userId: schema.players.userId })
      .from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), eq(schema.players.status, "active")))
      .limit(1);
    if (player === undefined || player.userId === null) throw new Error(`No active player for game ${gameId}`);
    await db.update(schema.players).set({ characterId }).where(eq(schema.players.id, player.id));

    // Every AI operation is coin-gated even in mock mode, and a fresh account
    // has nothing. Dev bookkeeping, not a purchase.
    await db.insert(schema.creditWallets).values({ userId: player.userId }).onConflictDoNothing({ target: schema.creditWallets.userId });
    const [wallet] = await db
      .select({ id: schema.creditWallets.id })
      .from(schema.creditWallets)
      .where(eq(schema.creditWallets.userId, player.userId))
      .limit(1);
    if (wallet === undefined) throw new Error("No coin wallet for the test user.");
    const grant = 100_000_000n;
    await db.update(schema.creditWallets).set({ availableMicrocredits: grant }).where(eq(schema.creditWallets.id, wallet.id));
  } finally {
    await close();
  }
}

/**
 * Go to a world the suite has already seeded.
 *
 * The signing-up and save-making happen once, in global.setup.ts: doing them
 * per test cost more than the tests did.
 */
export async function enterTheWorld(page: Page, who: "consul" | "citizen" | "carthaginian" = "consul"): Promise<string> {
  const gameId = seededWorlds()[who];
  await page.goto(`/games/${gameId}`);
  await expect(page).toHaveURL(new RegExp(`/games/${gameId}$`), { timeout: 60_000 });
  return gameId;
}

export const theMap = (page: Page) => page.locator("#place-map");
export const theOffice = (page: Page) => page.locator("#place-office");
export const placeTab = (page: Page, which: "The Map" | "The Office") =>
  page.getByRole("tab", { name: new RegExp(`^${which}`) });

/** Wait for the room to be there, rather than for a fixed time. */
export async function waitForTheOffice(page: Page) {
  await expect(theOffice(page)).toBeVisible();
  await expect(page.locator(".office-object").first()).toBeVisible();
}
