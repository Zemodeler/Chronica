import { expect, test } from "@playwright/test";
import { enterTheWorld, placeTab, theMap, waitForTheOffice } from "./fixture";

/**
 * The game is two places, and moving between them must cost nothing.
 *
 * The map deliberately never unmounts: its pan and zoom live in the shell and
 * its political geometry is memoised against a ref a remount would throw
 * away. That decision is invisible from the outside, so `data-scale` on the
 * map panel makes it assertable rather than merely asserted.
 */
test.describe("the two places", () => {
  test("lands in the Office, because that is where the work is", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);
    await expect(placeTab(page, "The Office")).toHaveAttribute("aria-selected", "true");
    await expect(placeTab(page, "The Map")).toHaveAttribute("aria-selected", "false");
  });

  test("keeps the map exactly where the player left it", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);

    await placeTab(page, "The Map").click();
    await expect(theMap(page)).toBeVisible();

    const zoomIn = page.getByRole("button", { name: /zoom in/i });
    await zoomIn.click();
    await zoomIn.click();
    const zoomed = await theMap(page).getAttribute("data-scale");
    expect(Number(zoomed)).toBeGreaterThan(1);

    await placeTab(page, "The Office").click();
    await waitForTheOffice(page);
    await placeTab(page, "The Map").click();

    // A remount would reset this to 1.00 and re-run the label-curve search.
    expect(await theMap(page).getAttribute("data-scale")).toBe(zoomed);
  });

  test("takes the hidden place out of the tab order", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);
    // inert is a boolean attribute: present or absent, never a value.
    expect(await theMap(page).getAttribute("inert")).not.toBeNull();

    await placeTab(page, "The Map").click();
    expect(await theMap(page).getAttribute("inert")).toBeNull();
  });

  test("leaves the map by its window, and comes back by the tab", async ({ page }) => {
    await enterTheWorld(page);
    await waitForTheOffice(page);
    await page.locator('[data-object="window"]').click();
    await expect(placeTab(page, "The Map")).toHaveAttribute("aria-selected", "true");
    await placeTab(page, "The Office").click();
    await waitForTheOffice(page);
  });

  test("puts an order bar on the map, so an order does not need a walk indoors", async ({ page }) => {
    await enterTheWorld(page);
    await placeTab(page, "The Map").click();
    const bar = page.locator(".map-order-bar");
    await expect(bar).toBeVisible();
    await expect(bar.locator("#map-order")).toBeVisible();

    // And the door back to the desk for anything longer than a line.
    await bar.getByRole("button", { name: "At the desk…" }).click();
    await expect(placeTab(page, "The Office")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("dialog", { name: /council/i })).toBeVisible();
  });
});
