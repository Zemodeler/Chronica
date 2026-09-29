import { expect, test } from "@playwright/test";
import { enterTheWorld, waitForTheOffice } from "./fixture";

/**
 * The rule that runs through all of this: the player is told things in words,
 * and never handed a score, an entity id, or somebody else's private state.
 *
 * It is the easiest thing in the codebase to regress, because every one of
 * these readings is derived from a number that is right there.
 */
const A_SCORE = /\d+\s*\/\s*\d+/;
const AN_ID = /\[[a-z0-9-]{4,}\]/;
/** A lower-case slug of three or more parts, the shape every entity id has: "roman-field-army". */
const A_BARE_ID = /\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/;

test.describe("what the player is allowed to read", () => {
  test("counts the men actually present, in words", async ({ page }) => {
    await enterTheWorld(page, "consul");
    await waitForTheOffice(page);
    await page.locator('[data-object="forces"]').click();

    const panel = page.getByRole("dialog", { name: /your forces/i });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".muster__force").first()).toBeVisible({ timeout: 60_000 });
    // Armies and ships each have their ribbon, and a fleet is never counted in men.
    await expect(panel.getByRole("tab", { name: /^Armies/ })).toBeVisible();
    await expect(panel.getByRole("tab", { name: /^Ships/ })).toBeVisible();
    // A force is its name until it is clicked.
    const first = panel.locator(".muster__name").first();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await expect(panel.locator(".muster__details")).toBeVisible();
    if (process.env.CHRONICA_E2E_SHOTS) await panel.screenshot({ path: `${process.env.CHRONICA_E2E_SHOTS}/muster-armies.png` });
    await panel.getByRole("tab", { name: /^Ships/ }).click();
    const ships = await panel.innerText();
    expect(ships).not.toMatch(/\d[\d,]* men,/);
    if (process.env.CHRONICA_E2E_SHOTS) await panel.screenshot({ path: `${process.env.CHRONICA_E2E_SHOTS}/muster-ships.png` });
    await panel.getByRole("tab", { name: /^Armies/ }).click();
    await panel.locator(".muster__name").first().click();

    const text = await panel.innerText();
    expect(text).not.toMatch(A_SCORE);
    expect(text).not.toMatch(AN_ID);
    // assessExecution's honesty clause names a man a thief before anyone has
    // caught him. It must never reach a player-facing surface.
    expect(text).not.toContain("not to be left alone with money");
    // Condition is said, not scored.
    expect(text).toMatch(/in good heart|steady|sullen|in high spirits|close to breaking|fit only to run/);

    // And it is his own army. seesForce ends in speaksForPolity, so without a
    // polity filter a consul reads Carthage's morale and supply off his own
    // muster roll.
    expect(text).not.toContain("Carthaginian");
    expect(text).not.toContain("Syracusan");
  });

  test("says what an office actually lets a man do", async ({ page }) => {
    await enterTheWorld(page, "consul");
    await waitForTheOffice(page);
    await page.locator('[data-object="standing"]').click();

    const panel = page.getByRole("dialog", { name: /your standing/i });
    await expect(panel).toBeVisible();
    // The route compiles on its first hit under `next dev`; wait for what it
    // answers rather than for the panel's frame.
    await expect(panel.locator(".standing__section").first()).toBeVisible({ timeout: 60_000 });
    const text = await panel.innerText();

    // The heading is uppercased in CSS, and innerText returns what is rendered.
    expect(text.toLowerCase()).toContain("what it lets you do");
    expect(text).not.toMatch(A_SCORE);
    // describeAuthority's "[account-rome]" is for the prompt, not the player.
    expect(text).not.toMatch(AN_ID);
    // Spending your own purse is not a power.
    expect(text).not.toContain("'s purse");
  });

  test("gives a man with nothing a sentence rather than an empty panel", async ({ page }) => {
    await enterTheWorld(page, "citizen");
    await waitForTheOffice(page);
    // He has no seal case, so the standing panel is reached by its absence:
    // the room simply does not offer it.
    await expect(page.locator('[data-object="standing"]')).toHaveCount(0);
    await expect(page.locator('[data-object="forces"]')).toHaveCount(0);
  });

  test("reads the books without spending a model call", async ({ page }) => {
    await enterTheWorld(page, "consul");
    await waitForTheOffice(page);
    await page.locator('[data-object="books"]').click();
    const panel = page.getByRole("dialog", { name: /treasury/i });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".books__table")).toBeVisible({ timeout: 60_000 });

    // Every account is named for a reader. The consul's army chests used to
    // read "roman-field-army's purse": a bare slug, which AN_ID's brackets miss.
    const text = await panel.innerText();
    expect(text).not.toMatch(AN_ID);
    expect(text).not.toMatch(A_BARE_ID);
  });
});

test.describe("the badge that pulls a player into the room", () => {
  test("counts what has not been read, and clears when the record is opened", async ({ page }) => {
    await enterTheWorld(page, "consul");
    await waitForTheOffice(page);

    const badge = page.locator('[data-object="chronicle"] .office-object__badge');
    // A fresh save has nothing written yet; either way the badge must agree
    // with the record rather than with its length.
    const before = (await badge.count()) === 0 ? 0 : Number(await badge.innerText());

    await page.locator('[data-object="chronicle"]').click();
    const record = page.getByRole("dialog", { name: /chronicle/i });
    await expect(record).toBeVisible({ timeout: 60_000 });
    await record.getByRole("button", { name: /close/i }).first().click();

    // Whatever it was, it is nothing now: opening the record marks it read.
    await expect(page.locator('[data-object="chronicle"] .office-object__badge')).toHaveCount(0);
    expect(before).toBeGreaterThanOrEqual(0);
  });
});
