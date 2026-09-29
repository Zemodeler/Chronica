import { expect, test, type Page } from "@playwright/test";
import { aConfirmedCharacter, enterTheWorld, placeTab, waitForTheOffice } from "./fixture";
import { seededWorlds } from "./paths";

/**
 * Notes across the Office: Matters in hand behind the date, a note for every
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
  test("the date opens Matters in hand, which pins and has notes of its own", async ({ page }) => {
    await inTheOffice(page);
    await page.locator(".calendar-line__next").hover();
    const notes = page.locator(".tip");
    await expect(notes.first()).toContainText("Matters in hand");
    await expect(notes.first()).toHaveClass(/is-locked/, { timeout: 3_000 });
    await expect(notes.first().locator(".matters h3").first()).toBeVisible();

    const inner = notes.first().locator(".matters .tip-term").first();
    await inner.hover();
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(1)).toHaveClass(/is-locked/, { timeout: 3_000 });
    await page.screenshot({ path: `${DIR}/1-matters-nested.png` });

    await page.keyboard.press("Escape");
    await expect(notes).toHaveCount(1);
    await page.mouse.move(5, 500);
    await expect(notes).toHaveCount(0, { timeout: 3_000 });
  });

  test("a thread can be followed from Matters in hand, and shows beside the date", async ({ page }) => {
    await inTheOffice(page);
    // A click pins a note at once; holding still is the first test's business.
    await page.locator(".calendar-line__next").click();
    const matters = page.locator(".tip").first();
    await expect(matters).toHaveClass(/is-locked/);
    await matters.locator(".matters .tip-term", { hasText: "Rhegium and the Campanian Legion" }).click();
    const note = page.locator(".tip").nth(1);
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
    await sheet.locator(".standing__offices .tip-term", { hasText: "Manius Curius Dentatus" }).first().hover();
    const note = page.locator(".tip").first();
    await expect(note).toContainText("Compared with you");
    await expect(note.locator(".tip__source")).toContainText(/rolls of office/);
    await page.screenshot({ path: `${DIR}/3-person.png` });
  });

  test("the men's mood says why, and what pay does to it", async ({ page }) => {
    await inTheOffice(page);
    await page.locator('[data-object="forces"]').click({ timeout: 60_000 });
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
    await sheet.getByRole("tab", { name: /the state/i }).click();
    await expect(sheet.locator("h3", { hasText: /is governed/ })).toBeVisible();
    await expect(sheet.locator(".standing__offices li.is-yours").first()).toContainText("(you)");
    await page.screenshot({ path: `${DIR}/5-governed.png` });
    await sheet.locator(".standing__offices .tip-term", { hasText: "Roman consul" }).first().click();
    await expect(page.locator(".tip").first().locator(".tip__explained")).toContainText("A magistracy");
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
    const matters = page.locator(".tip").first();
    await expect(matters).toHaveClass(/is-locked/);
    await matters.locator(".matters li small", { hasText: "The war is" }).locator(".tip-term").first().click();
    const war = page.locator(".tip").nth(1);
    await expect(war).toContainText("How the war goes");
    await expect(war.locator(".why li").first()).toBeVisible();
    await expect(war.locator(".tip__trail")).toContainText("Matters in hand");
    await page.screenshot({ path: `${DIR}/6-war.png` });
    // Back along the trail: the note above goes, Matters in hand stays.
    await war.locator(".tip__crumb", { hasText: "Matters in hand" }).click();
    await expect(page.locator(".tip")).toHaveCount(1);
    await page.mouse.move(1100, 150);
    await expect(page.locator(".tip")).toHaveCount(1);
  });

  test("an elected office says who could be next", async ({ page }) => {
    await inTheOffice(page);
    await page.locator('[data-object="standing"]').click({ timeout: 60_000 });
    const sheet = page.getByRole("dialog", { name: /your standing/i });
    await sheet.getByRole("tab", { name: /the state/i }).click();
    await sheet.locator(".standing__offices .tip-term", { hasText: "Roman consul" }).first().click();
    const note = page.locator(".tip").first();
    await expect(note).toContainText("Who could be next");
    await page.screenshot({ path: `${DIR}/7-next.png` });
  });

  test("the letter tray can ask after anyone the player could know of", async ({ page }) => {
    await aConfirmedCharacter(seededWorlds().consul, "gaius-genucius", "Gaius Genucius Clepsina", "Roman");
    await inTheOffice(page);
    await page.locator('[data-object="people"]').click({ timeout: 90_000 });
    const tray = page.locator(".sheet--letters");
    // The tray's people and the room's notes are both fetched; wait for them.
    await expect(tray.locator(".letters__person").first()).toBeVisible({ timeout: 60_000 });
    await tray.locator("#letters-search").fill("rheg");
    const asked = tray.locator(".letters__ask .tip-term").first();
    await expect(asked).toBeVisible({ timeout: 30_000 });
    await asked.click();
    await expect(page.locator(".tip").first()).toContainText(/Rhegium/);
    await page.screenshot({ path: `${DIR}/8-ask-after.png` });
  });
});
