import { expect, test, type Page } from "@playwright/test";
import { enterTheWorld, waitForTheOffice } from "./fixture";

/**
 * The seal case's treaties: a card per power, the chosen power's dossier, and
 * notes that open on a held pointer, pin, and open notes of their own.
 *
 * Screenshots go to shots/treaties/ (gitignored) so the sheet can be looked at.
 */
const DIR = "shots/treaties";

async function openTreaties(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterTheWorld(page, "consul");
  await waitForTheOffice(page);
  await page.locator('[data-object="standing"]').click({ timeout: 60_000 });
  const sheet = page.getByRole("dialog", { name: /your standing/i });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("tab", { name: /treaties/i }).click();
  return sheet;
}

test.describe("the treaties in the seal case", () => {
  test("groups the powers, war first, and opens a dossier", async ({ page }) => {
    const sheet = await openTreaties(page);
    const groups = sheet.locator(".treaties__group h3");
    await expect(groups.first()).toHaveText(/at war/i);
    await expect(sheet.locator(".treaties__group--bound_to_us")).toBeVisible();
    // Each power once: the Samnites are no longer in two lists.
    await expect(sheet.locator(".treaty-card__name", { hasText: "Samnites" })).toHaveCount(1);

    await sheet.locator(".treaty-card__name", { hasText: "Samnites" }).click();
    const dossier = sheet.locator(".treaties__dossier");
    await expect(dossier.locator(".dossier__title")).toContainText("Samnites");
    await expect(dossier).toContainText(/bound to Rome by foedus/i);
    await page.screenshot({ path: `${DIR}/1-dossier.png` });
  });

  test("a note pins when held, opens a note inside it, and Escape puts down one", async ({ page }) => {
    const sheet = await openTreaties(page);
    await sheet.locator(".treaty-card__name", { hasText: "Samnites" }).click();

    // Hover the power's name: a note opens, not yet pinned.
    const title = sheet.locator(".dossier__title .tip-term");
    await title.hover();
    const notes = page.locator(".tip");
    await expect(notes).toHaveCount(1);
    await expect(notes.first()).not.toHaveClass(/is-locked/);
    await page.screenshot({ path: `${DIR}/2-arming.png` });

    // Held still, it pins.
    await expect(notes.first()).toHaveClass(/is-locked/, { timeout: 3_000 });

    // Into the note, onto a word of its own.
    const inner = notes.first().locator(".tip-term").first();
    await inner.hover();
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(1)).toHaveClass(/is-locked/, { timeout: 3_000 });
    await page.screenshot({ path: `${DIR}/3-nested.png` });

    // Escape puts down the top note, not the sheet.
    await page.keyboard.press("Escape");
    await expect(notes).toHaveCount(1);
    await expect(sheet).toBeVisible();

    // Leaving the pinned note closes it after a moment.
    await page.mouse.move(5, 5);
    await expect(notes).toHaveCount(0, { timeout: 3_000 });
    await expect(sheet).toBeVisible();
  });

  test("an unpinned note goes as soon as the pointer leaves its word", async ({ page }) => {
    const sheet = await openTreaties(page);
    const kind = sheet.locator(".treaty-card__kinds .tip-term").first();
    await kind.hover();
    await expect(page.locator(".tip")).toHaveCount(1);
    await sheet.locator(".treaties__group h3").first().hover();
    await expect(page.locator(".tip")).toHaveCount(0);
  });
});
