import { expect, test, type Page } from "@playwright/test";
import { createDatabase, schema } from "@chronica/db";
import type { WorldState } from "@chronica/shared";
import { eq } from "drizzle-orm";
import { aConfirmedCharacter, enterTheWorld, waitForTheOffice } from "./fixture";
import { seededWorlds } from "./paths";

/**
 * The letter tray: speaking is for the room, letters for everybody else.
 *
 * A letter from another power could be answered only at the desk, as an
 * order, and anybody listed could be spoken with at once however far off.
 * Now the consul in Latium speaks with the senators beside him and writes to
 * Decius Vibellius in Rhegium, and Hanno in Carthage writes to Hannibal Gisco
 * and answers a letter from him in the tray. Nothing here calls a model: a
 * letter is a burst of its own, answered when the world next moves.
 */

const DATABASE_URL = process.env.DATABASE_URL?.trim() || "postgres://chronica:chronica@localhost:5432/chronica";

test.beforeAll(async () => {
  const worlds = seededWorlds();
  await aConfirmedCharacter(worlds.consul, "gaius-genucius", "Gaius Genucius Clepsina", "Roman");
  await aConfirmedCharacter(worlds.carthaginian, "hanno-carthage", "Hanno of Carthage", "Carthaginian");
});

async function openTheLetters(page: Page) {
  await waitForTheOffice(page);
  // The room's objects are a fetch, compiled on its first hit under `next dev`.
  await page.locator('[data-object="people"]').click({ timeout: 90_000 });
  await expect(page.locator(".sheet--letters")).toBeVisible({ timeout: 30_000 });
}

const person = (page: Page, name: string) => page.locator(".letters__people .letters__person", { hasText: name }).first();

/** A letter from Hannibal Gisco to Hanno, put straight into the world, as a burst would leave it. */
async function aLetterFromGisco(gameId: string): Promise<{ giscoId: string }> {
  const { db, close } = createDatabase(DATABASE_URL);
  try {
    const [row] = await db.select({ world: schema.gameWorlds.world }).from(schema.gameWorlds).where(eq(schema.gameWorlds.gameId, gameId)).limit(1);
    const world = row!.world as WorldState;
    const gisco = world.characters.find((character) => character.name === "Hannibal Gisco")!;
    const hanno = world.characters.find((character) => character.id === "hanno-carthage")!;
    const letter = {
      id: "e2e-letter-from-gisco",
      kind: "letter",
      fromPolityId: gisco.polityId,
      fromCharacterId: gisco.id,
      toPolityId: hanno.polityId,
      toCharacterId: hanno.id,
      subject: "The garrison at Lilybaeum",
      terms: "The men have not been paid since the spring. Send silver, or tell me what to tell them.",
      sentAtStep: world.elapsedStep,
      replyDueByStep: null,
      status: "awaiting_reply",
      answer: null,
      answerText: null,
      answeredAtStep: null,
      inReplyToMessageId: null,
      visibility: "private",
    };
    const diplomacy = world.diplomacy.filter((message) => message.id !== letter.id);
    await db.update(schema.gameWorlds).set({ world: { ...world, diplomacy: [...diplomacy, letter] } }).where(eq(schema.gameWorlds.gameId, gameId));
    return { giscoId: gisco.id };
  } finally {
    await close();
  }
}

test.setTimeout(240_000);

test("the consul speaks with those beside him, and writes to those who are not", async ({ page }) => {
  await enterTheWorld(page, "consul");
  await openTheLetters(page);

  await person(page, "Tiberius Coruncanius").click();
  await expect(page.getByRole("button", { name: "Speak with Tiberius Coruncanius" })).toBeVisible();
  await expect(page.locator("#letters-write")).toHaveCount(0);

  await person(page, "Decius Vibellius").click();
  await expect(page.getByText("Not here: written to, and answering when the world next moves.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Speak with|Write to/ })).toHaveCount(0);
  await expect(page.locator("#letters-write")).toBeVisible();
});

test("Hanno writes to Hannibal Gisco, and answers his letter in the tray", async ({ page }) => {
  const gameId = seededWorlds().carthaginian;
  await aLetterFromGisco(gameId);
  await enterTheWorld(page, "carthaginian");
  await openTheLetters(page);

  // The letter waiting on him is answered here, not at the desk.
  await page.locator(".letters__person--letter", { hasText: "Hannibal Gisco" }).click();
  await expect(page.getByText("The garrison at Lilybaeum")).toBeVisible();
  await expect(page.getByRole("button", { name: "Answer at the desk" })).toHaveCount(0);
  await page.locator("#letters-answer").fill("Silver goes by the next ship. Tell them Carthage has not forgotten them.");
  await page.getByRole("button", { name: "Send your letter" }).click();
  await expect(page.getByText(/Your answer is on its way/)).toBeVisible({ timeout: 60_000 });

  // His answer and the letter carrying it read as one page, awaiting Gisco.
  const thread = page.locator(".letters__transcript");
  await expect(thread.locator(".letters__page")).toHaveCount(2);
  await expect(thread.locator(".letters__page.is-yours")).toContainText("Silver goes by the next ship.");
  await expect(thread.getByText("Not yet answered. The answer comes when the world next moves.")).toBeVisible();
  await expect(page.locator(".letters__person--letter", { hasText: "Hannibal Gisco" })).toHaveCount(0);

  // And a letter of his own, written first.
  await page.locator("#letters-write").fill("One more thing: hold the harbour whatever the Mamertines do.");
  await page.getByRole("button", { name: "Send the letter" }).click();
  await expect(page.getByText("Your letter is on its way to Hannibal Gisco. They will answer when the world next moves.")).toBeVisible({ timeout: 60_000 });
  await expect(thread.locator(".letters__page")).toHaveCount(3);
  await expect(person(page, "Hannibal Gisco")).toContainText("Awaiting their answer");

  // The world kept both.
  const { db, close } = createDatabase(DATABASE_URL);
  try {
    const [row] = await db.select({ world: schema.gameWorlds.world }).from(schema.gameWorlds).where(eq(schema.gameWorlds.gameId, gameId)).limit(1);
    const world = row!.world as WorldState;
    expect(world.diplomacy.find((message) => message.id === "e2e-letter-from-gisco")).toMatchObject({ status: "answered", answer: "countered" });
    expect(world.diplomacy.filter((message) => message.fromCharacterId === "hanno-carthage" && message.status === "awaiting_reply")).toHaveLength(2);
  } finally {
    await close();
  }
});
