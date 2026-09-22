import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { enterTheWorld, waitForTheOffice } from "./fixture";

/**
 * The room is a drawing over a list of real controls, and the controls are
 * the part that has to work. Everything here is done without a mouse.
 */
test.describe("the room", () => {
  /** Every surface the room opens: an aside for the working panels, a dialog for the rest. */
  const anyPanel = (page: Page) => page.locator('aside[class$="-panel"], aside.sim-panel, dialog[open]').first();

  test("opens every object from the keyboard, and gives focus back", async ({ page }) => {
    await enterTheWorld(page, "consul");
    await waitForTheOffice(page);

    const ids = await page.locator(".office-object").evaluateAll(
      (nodes) => nodes.map((node) => node.getAttribute("data-object") ?? ""),
    );
    expect(ids.length).toBeGreaterThan(2);

    for (const id of ids) {
      if (id === "window") continue;
      const object = page.locator(`[data-object="${id}"]`);
      await object.focus();
      await expect(object).toBeFocused();
      await page.keyboard.press("Enter");

      // Generous: each route and panel compiles on its first hit under dev.
      await expect(anyPanel(page), `${id} opened nothing`).toBeVisible({ timeout: 60_000 });

      const dialog = page.locator("dialog[open]");
      if (await dialog.count() > 0) {
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      } else {
        await page.locator('aside[class$="-panel"], aside.sim-panel').first()
          .getByRole("button", { name: /close/i }).first().click();
      }
      await expect(anyPanel(page)).toHaveCount(0);
      // The room gives focus back to the thing that was picked up.
      await expect(object).toBeFocused();
    }
  });

  test("says what each thing is for", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);
    for (const object of await page.locator(".office-object").all()) {
      await expect(object.locator(".office-object__name")).not.toBeEmpty();
      await expect(object.locator(".office-object__does")).not.toBeEmpty();
    }
  });

  test("gives a private citizen a nearly bare room", async ({ page }) => {
    // An object appears only when the thing it stands for is true. This man
    // holds no office, commands nobody and owns no land.
    await enterTheWorld(page, "citizen");
    await waitForTheOffice(page);
    await expect(page.locator('[data-object="forces"]')).toHaveCount(0);
    await expect(page.locator('[data-object="standing"]')).toHaveCount(0);
    // A window and a way to read are anyone's.
    await expect(page.locator('[data-object="window"]')).toHaveCount(1);
    await expect(page.locator('[data-object="chronicle"]')).toHaveCount(1);
  });

  test("gives a consul the things a consul has", async ({ page }) => {
    await enterTheWorld(page, "consul");
    await waitForTheOffice(page);
    await expect(page.locator('[data-object="council"]')).toHaveCount(1);
    await expect(page.locator('[data-object="forces"]')).toHaveCount(1);
    await expect(page.locator('[data-object="standing"]')).toHaveCount(1);
  });

  test("has no accessibility violations, room or panels", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);

    const room = await new AxeBuilder({ page })
      .include("#place-office")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(room.violations, JSON.stringify(room.violations.map((v) => v.id))).toEqual([]);

    for (const id of ["council", "chronicle", "books", "forces", "standing"]) {
      const object = page.locator(`[data-object="${id}"]`);
      if (await object.count() === 0) continue;
      await object.click();
      const panel = page.locator('aside[class$="-panel"], aside.sim-panel').first();
      await expect(panel).toBeVisible({ timeout: 60_000 });
      // WCAG A and AA. The page's own landmark structure -- a global header
      // and the shell's own, which axe counts as two banners -- predates the
      // Office by a long way and is a best-practice note, not a failure.
      const result = await new AxeBuilder({ page })
        .include("aside")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(result.violations, `${id}: ${JSON.stringify(result.violations.map((v) => v.id))}`).toEqual([]);
      await panel.getByRole("button", { name: /close/i }).first().click();
    }
  });
});
