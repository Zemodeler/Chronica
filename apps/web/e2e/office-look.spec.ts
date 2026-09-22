import { test } from "@playwright/test";
import { enterTheWorld, placeTab, waitForTheOffice } from "./fixture";

/** Not an assertion: pictures of the room, so somebody can look at it. */
test("what the room looks like", async ({ page }) => {
  // Not an assertion and not quick: five screenshots across two contexts,
  // each opening a panel whose route compiles on its first hit.
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterTheWorld(page, "consul");
  await waitForTheOffice(page);
  // The room's contents are a fetch; wait for the room to finish furnishing.
  await page.locator('[data-object="forces"]').waitFor({ timeout: 60_000 });
  await page.screenshot({ path: "shots/office-consul.png" });

  // What pointing at a cut-out looks like: the edge of the thing, not a box.
  const cutOut = page.locator('[data-object="council"] .office-object__cut-out');
  if (await cutOut.count() > 0) {
    await page.locator('[data-object="council"]').hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "shots/office-hover.png" });
    await page.mouse.move(10, 400);
  }

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
