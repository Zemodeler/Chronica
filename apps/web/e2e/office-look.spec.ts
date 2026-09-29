import { test, type BrowserContext, type Page } from "@playwright/test";
import { enterTheWorld, placeTab, waitForTheOffice } from "./fixture";

/**
 * Pictures of every surface, so somebody can look at them. Not an assertion.
 *
 * Off by default: it opens every panel across three worlds, and on a loaded
 * dev server the routes it waits on are slow enough to time out -- a
 * screenshot-taker has no business failing the suite over that. Run it on
 * its own with:
 *
 *   CHRONICA_E2E_SHOTS=1 npx playwright test office-look
 *
 * CHRONICA_SHOTS_DIR names the folder under shots/ (default: "latest"), so a
 * "before" and an "after" set can sit side by side.
 *
 * It knows nothing about how a panel is built: it opens the game in a fresh
 * tab, clicks an object, waits, photographs, and closes the tab. A tab per
 * picture, because each game holds a progress stream open, and a few left
 * open use up the browser's connections to the host until the next page
 * never loads. A picture that cannot be taken is logged and skipped.
 */
test.skip(process.env.CHRONICA_E2E_SHOTS !== "1", "screenshots are taken on request");

const DIR = `shots/${process.env.CHRONICA_SHOTS_DIR?.trim() || "latest"}`;
const VIEWPORT = { width: 1440, height: 810 };
type Who = "consul" | "citizen" | "carthaginian";

const shoot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.png` });

async function furnished(page: Page, who: Who) {
  await waitForTheOffice(page);
  // The room's contents are a fetch; wait for it to finish furnishing.
  if (who !== "citizen") await page.locator('[data-object="council"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
}

/** One picture, in a tab of its own. */
async function picture(context: BrowserContext, who: Who, name: string, act?: (page: Page) => Promise<void>) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  try {
    await enterTheWorld(page, who);
    await furnished(page, who);
    if (act !== undefined) await act(page);
    await shoot(page, name);
  } catch (error) {
    console.warn(`could not photograph ${name}:`, error);
  } finally {
    await page.close();
  }
}

const open = (object: string) => async (page: Page) => {
  await page.locator(`[data-object="${object}"]`).click();
  await page.waitForTimeout(3500);
};

test("what every surface looks like", async ({ page, browser }) => {
  test.setTimeout(1_200_000);
  const context = page.context();

  await picture(context, "consul", "office-consul");
  await picture(context, "consul", "office-hover-desk", async (room) => {
    await room.locator('[data-object="council"]').hover();
    await room.waitForTimeout(400);
  });
  for (const [object, name] of [
    ["council", "desk"],
    ["chronicle", "annals"],
    ["books", "ledger"],
    ["people", "letters"],
    ["forces", "muster"],
    ["standing", "seal-case"],
    ["self", "mirror"],
  ] as const) {
    await picture(context, "consul", name, open(object));
  }
  await picture(context, "consul", "map", async (room) => {
    await placeTab(room, "The Map").click();
    await room.waitForTimeout(3000);
  });

  // A man with nothing: the same room, far barer.
  await picture(context, "citizen", "office-citizen");
  // A different culture furnishes a different room.
  await picture(context, "carthaginian", "office-carthaginian");
  await picture(context, "carthaginian", "annals-carthaginian", open("chronicle"));

  // Outside the game, signed in.
  for (const [path, name] of [
    ["/", "dashboard"],
    ["/worlds", "worlds"],
    ["/account", "account"],
  ] as const) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await shoot(page, name);
  }
  await page.goto("/worlds", { waitUntil: "domcontentloaded" });
  const worldLink = page.locator('a[href*="/games/new"]').first();
  if ((await worldLink.count()) > 0) {
    await worldLink.click();
    await page.waitForTimeout(2500);
    await shoot(page, "new-game");
  }

  // Outside the game, signed out.
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: VIEWPORT });
  const door = await stranger.newPage();
  for (const [path, name] of [
    ["/login", "login"],
    ["/sign-up", "sign-up"],
    ["/forgot-password", "forgot-password"],
  ] as const) {
    await door.goto(path, { waitUntil: "domcontentloaded" });
    await door.waitForTimeout(2000);
    await shoot(door, name);
  }
  await stranger.close();
});
