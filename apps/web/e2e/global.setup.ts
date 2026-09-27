import fs from "node:fs";
import { expect, test as setup } from "@playwright/test";
import { beThisCharacter, CARTHAGINIAN, CONSUL, extractGameId, PRIVATE_CITIZEN } from "./fixture";
import { STATE_FILE, WORLDS_FILE, type SeededWorlds } from "./paths";

/**
 * One account, two saves, once for the whole suite.
 *
 * Signing up and creating a Punic Wars save per test cost more than the test
 * itself: against `next dev` every route compiles on its first hit, and the
 * scenario's world is not small. Doing it fourteen times ran the suite into
 * its own timeouts.
 *
 * So it happens once here, through the real UI, and the specs navigate
 * straight to a world that already exists. The character declaration is
 * AI-driven and out of scope, so it is written into Postgres directly -- the
 * same shortcut the spec that used to live here took.
 */

setup("sign up once and seed two worlds", async ({ page }) => {
  setup.setTimeout(300_000);

  const username = `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const password = "correct-horse-battery-staple";

  await page.goto("/sign-up");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#passwordConfirmation").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account/, { timeout: 60_000 });

  const startASave = async (): Promise<string> => {
    await page.goto("/worlds");
    const card = page.locator(".world-card", { hasText: "Punic Wars" });
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole("link", { name: "Begin scenario" }).click();
    await expect(page).toHaveURL(/\/games\/new/, { timeout: 60_000 });
    await page.getByRole("button", { name: "Start and enter map" }).click();
    await page.waitForURL(/\/games\/[0-9a-fA-F-]{36}/, { timeout: 120_000 });
    return extractGameId(page.url());
  };

  const consul = await startASave();
  await beThisCharacter(consul, CONSUL);

  const citizen = await startASave();
  await beThisCharacter(citizen, PRIVATE_CITIZEN);

  const carthaginian = await startASave();
  await beThisCharacter(carthaginian, CARTHAGINIAN);

  fs.writeFileSync(WORLDS_FILE, JSON.stringify({ consul, citizen, carthaginian } satisfies SeededWorlds), "utf8");
  await page.context().storageState({ path: STATE_FILE });

  // Warm the routes the specs open.
  //
  // `next dev` compiles a route the first time it is asked for, and the
  // Office opens six of its own. Paid inside a spec that has 120 seconds for
  // everything, a cold compile is the whole budget -- which is what a run
  // against a cleared .next/cache spends it on, failing tests that are not
  // wrong about anything. Paid here once, it costs the setup and nobody else.
  for (const route of ["room", "forces", "standing", "books", "people", "simulate"]) {
    await page.request.get(`/api/games/${consul}/${route}`, { timeout: 180_000 }).catch(() => undefined);
  }
  // Renaming an army is a POST; a GET is refused, but compiles the route.
  await page.request.get(`/api/games/${consul}/forces/none`, { timeout: 180_000 }).catch(() => undefined);
  await page.goto(`/games/${consul}`);
  await page.locator(".office-object").first().waitFor({ timeout: 180_000 });
});
