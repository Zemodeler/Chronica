import { test } from "@playwright/test";
import { enterTheWorld, placeTab, waitForTheOffice } from "./fixture";

/** Not an assertion: pictures of the room, so somebody can look at it. */
test("what the room looks like", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterTheWorld(page, "consul");
  await waitForTheOffice(page);
  // The room's contents are a fetch; wait for the room to finish furnishing.
  await page.locator('[data-object="forces"]').waitFor({ timeout: 60_000 });
  await page.screenshot({ path: "shots/office-consul.png" });

  await page.locator('[data-object="forces"]').click();
  await page.locator(".muster__force").first().waitFor({ timeout: 60_000 });
  await page.screenshot({ path: "shots/office-forces.png" });
  await page.locator("aside.sim-panel").getByRole("button", { name: /close/i }).first().click();

  await page.locator('[data-object="standing"]').click();
  await page.locator(".standing__section").first().waitFor({ timeout: 60_000 });
  await page.screenshot({ path: "shots/office-standing.png" });
  await page.locator("aside.sim-panel").getByRole("button", { name: /close/i }).first().click();

  await placeTab(page, "The Map").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "shots/map-with-order-bar.png" });

  const citizen = await page.context().newPage();
  await citizen.setViewportSize({ width: 1440, height: 900 });
  await enterTheWorld(citizen, "citizen");
  await waitForTheOffice(citizen);
  await citizen.waitForTimeout(3000);
  await citizen.screenshot({ path: "shots/office-citizen.png" });
});
