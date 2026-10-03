import { expect, test, type Page } from "@playwright/test";
import { aConfirmedCharacter, enterTheWorld, placeTab, waitForTheOffice } from "./fixture";
import { seededWorlds } from "./paths";

/**
 * Notes across the Office: the agenda behind the date, a note for every
 * name, why notes behind judgement words, threads that can be followed, and
 * what the words mean, said in the note where each is met.
 *
 * Screenshots go to shots/notes/ (gitignored) so the notes can be looked at.
 */
const DIR = "shots/notes";

async function inTheOffice(page: Page, who: "consul" | "citizen" = "consul") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterTheWorld(page, who);
  await waitForTheOffice(page);
}

test.describe("notes in the Office", () => {
  test("the date opens matters in hand as a document", async ({ page }) => {
    await inTheOffice(page);
    await page.locator(".calendar-line__next").click();
    const agenda = page.getByRole("dialog", { name: "matters in hand", exact: true });
    await expect(agenda).toBeVisible();
    await agenda.getByRole("tab", { name: "Ongoing", exact: true }).click();
    await expect(agenda.locator(".matters")).toBeVisible();
    await page.screenshot({ path: `${DIR}/1-matters-nested.png` });
    await page.keyboard.press("Escape");
    await expect(agenda).toHaveCount(0);
  });

  test("a thread can be followed from the agenda, and shows beside the date", async ({ page }) => {
    await inTheOffice(page);
    // A click pins a note at once; holding still is the first test's business.
    await page.locator(".calendar-line__next").click();
    const matters = page.getByRole("dialog", { name: "matters in hand", exact: true });
    await matters.getByRole("tab", { name: "Ongoing", exact: true }).click();
    await matters.locator(".matters .tip-term", { hasText: "Rhegium and the Campanian Legion" }).click();
    const note = page.locator(".tip").first();
    await expect(note).toHaveClass(/is-locked/);
    await expect(note).toContainText(/growing|brewing|at a crisis/i);
    // Its history is the Chronicle's; never the narrator's plan for it.
    await expect(note).not.toContainText(/next development/i);

    // Against `next dev` the route compiles on its first use, which is slow.
    const followed = page.waitForResponse((response) => response.url().endsWith("/threads") && response.request().method() === "POST", { timeout: 90_000 });
    await note.getByRole("button", { name: /follow this thread/i }).click();
    expect((await followed).ok()).toBe(true);
    const mark = page.locator(".thread-mark", { hasText: "Rhegium" });
    await expect(mark).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${DIR}/2-followed.png` });

    // Put it back as it was: the seeded world is shared by every spec.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await mark.click();
    const markNote = page.locator(".tip").first();
    await expect(markNote).toHaveClass(/is-locked/);
    await markNote.getByRole("button", { name: /stop following/i }).click();
    await expect(mark).toHaveCount(0, { timeout: 60_000 });
  });

  test("a name in the seal case opens a person's note, set against you", async ({ page }) => {
    await inTheOffice(page);
    await page.locator('[data-object="standing"]').click({ timeout: 60_000 });
    const sheet = page.getByRole("dialog", { name: /your standing/i });
    await sheet.getByRole("tab", { name: /the state/i }).click();
    await sheet.locator(".office-ledger__name .entity-link", { hasText: "Roman senator" }).click();
    await sheet.locator(".entity-reference .entity-link", { hasText: "Manius Curius Dentatus" }).first().click();
    const note = sheet.locator(".entity-reference");
    await note.locator(".tip-term", { hasText: "More" }).click();
    await expect(page.locator(".tip").first()).toContainText("Compared with you");
    await expect(note.locator(".tip__source")).toContainText(/rolls of office/);
    await page.screenshot({ path: `${DIR}/3-person.png` });
  });

  test("the men's mood says why, and what pay does to it", async ({ page }) => {
    await inTheOffice(page);
    await page.locator('[data-object="forces"]').click({ timeout: 60_000 });
    await page.getByRole("dialog", { name: "your forces", exact: true }).getByRole("button", { name: /Roman field army/ }).click();
    await page.locator("dialog .muster__condition .tip-term").first().hover();
    const why = page.locator(".tip").first();
    await expect(why.locator(".why li").first()).toBeVisible();
    await expect(why.locator(".tip__explained")).toContainText("Soldiers' pay");
    await page.screenshot({ path: `${DIR}/4-why.png` });
  });

  test("the seal case says how the state is governed, and an office note says what kind it is", async ({ page }) => {
    await inTheOffice(page);
    await page.locator('[data-object="standing"]').click({ timeout: 60_000 });
    const sheet = page.getByRole("dialog", { name: /your standing/i });
    const constitution = sheet.getByRole("tab", { name: /constitution/i });
    if (await constitution.count()) {
      await constitution.click();
      await expect(sheet.locator("h3", { hasText: /is governed/ })).toBeVisible();
    } else {
      await sheet.getByRole("tab", { name: /the state/i }).click();
      await expect(sheet.getByRole("heading", { name: "Magistracies", exact: true })).toBeVisible();
    }
    await sheet.getByRole("tab", { name: /the state/i }).click();
    await expect(sheet.locator(".office-ledger__name", { hasText: "Roman consul" })).toContainText("you");
    await page.screenshot({ path: `${DIR}/5-governed.png` });
    await sheet.locator(".office-ledger__name .entity-link", { hasText: "Roman consul" }).click();
    await expect(sheet.locator(".entity-reference")).toContainText("What it may do");
  });

  test("the lookup finds a name and a word, on the Map as in the Office", async ({ page }) => {
    await inTheOffice(page);
    await page.locator(".calendar-line").first().waitFor();
    await page.keyboard.press("/");
    await page.keyboard.type("siege");
    await expect(page.locator(".lookup__hit").first()).toContainText("Sieges");
    await page.locator(".lookup__hit").first().click();
    await expect(page.locator(".tip.is-locked")).toContainText("What the word means");
    await page.screenshot({ path: `${DIR}/9-lookup.png` });

    await placeTab(page, "The Map").click();
    await page.locator(".lookup__input").fill("carth");
    await expect(page.locator(".lookup__hit", { hasText: "Carthage" }).first()).toBeVisible();
    await page.locator(".lookup__input").fill("zzqx");
    await expect(page.locator(".lookup__none")).toHaveText("Nothing you know of by that name.");
  });

  test("a war says how it goes, and a nested note has a trail back", async ({ page }) => {
    await inTheOffice(page);
    await page.locator(".calendar-line__next").click();
    const matters = page.getByRole("dialog", { name: "matters in hand", exact: true });
    await matters.getByRole("tab", { name: "Ongoing", exact: true }).click();
    // A war row opens to say how the war goes.
    await matters.locator(".agenda__item", { has: page.locator(".agenda__status", { hasText: "At war" }) }).first().locator(".agenda__head").click();
    await matters.locator(".agenda__context", { hasText: "The war is" }).locator(".tip-term").first().click();
    const war = page.locator(".tip").first();
    await expect(war).toContainText("How the war goes");
    await expect(war.locator(".why li").first()).toBeVisible();
    await page.screenshot({ path: `${DIR}/6-war.png` });
    await page.keyboard.press("Escape");
    await expect(page.locator(".tip")).toHaveCount(0);
    await expect(matters).toBeVisible();
  });

  test("an elected office says who could be next", async ({ page }) => {
    await inTheOffice(page);
    await page.locator('[data-object="standing"]').click({ timeout: 60_000 });
    const sheet = page.getByRole("dialog", { name: /your standing/i });
    await sheet.getByRole("tab", { name: /the state/i }).click();
    await sheet.locator(".office-ledger__name .entity-link", { hasText: "Roman consul" }).first().click();
    const note = sheet.locator(".entity-reference");
    await expect(note).toContainText("Who could be next");
    await page.screenshot({ path: `${DIR}/7-next.png` });
  });

  test("an office is one ledger line, and a chamber's note names the offices it fills and its voting blocs", async ({ page }) => {
    await inTheOffice(page);
    await page.locator('[data-object="standing"]').click();
    const sheet = page.getByRole("dialog", { name: /your standing/i });
    await sheet.getByRole("tab", { name: /the state/i }).click();
    await expect(sheet.locator(".office-inspector")).toHaveCount(0);
    await sheet.locator(".office-ledger__name .tip-term", { hasText: "Centuriate Assembly" }).click();
    const note = page.locator(".tip.is-locked");
    await expect(note).toContainText("Roman consul");
    await expect(note).toContainText("98 voting weight");
    await page.screenshot({ path: `${DIR}/10-chamber-note.png` });
  });

  test("the letter tray can ask after anyone the player could know of", async ({ page }) => {
    await aConfirmedCharacter(seededWorlds().consul, "gaius-genucius", "Gaius Genucius Clepsina", "Roman");
    await inTheOffice(page);
    await page.locator('[data-object="people"]').click({ timeout: 90_000 });
    const tray = page.locator(".sheet--letters");
    // The tray's people and the room's notes are both fetched; wait for them.
    await expect(tray.locator(".letters__person").first()).toBeVisible({ timeout: 60_000 });
    await tray.locator("#letters-search").fill("rheg");
    const asked = tray.locator(".letters__ask .entity-link").first();
    await expect(asked).toBeVisible({ timeout: 30_000 });
    await asked.click();
    await expect(tray.locator(".entity-reference")).toContainText(/Rhegium/);
    await page.screenshot({ path: `${DIR}/8-ask-after.png` });
  });
});
