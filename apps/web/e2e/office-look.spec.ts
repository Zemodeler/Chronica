import { test } from "@playwright/test";
import { enterTheWorld, placeTab, waitForTheOffice } from "./fixture";

/** Not an assertion: pictures of the room, so somebody can look at it. */
test("what the room looks like", async ({ page }) => {
  // Five screenshots across three worlds, each opening a panel whose route
  // compiles on its first hit.
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 810 });

  await enterTheWorld(page, "consul");
  await waitForTheOffice(page);
  // The room's contents are a fetch; wait for it to finish furnishing.
  await page.locator('[data-object="forces"]').waitFor({ timeout: 60_000 });
  await page.screenshot({ path: "shots/office-consul.png" });

  // Pointing at a thing.
  await page.locator('[data-object="council"]').hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/office-hover-desk.png" });
  await page.locator('[data-object="forces"]').hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/office-hover-arms.png" });

  // A panel open over the room.
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

  // A man with nothing: the same room, far barer.
  const citizen = await page.context().newPage();
  await citizen.setViewportSize({ width: 1440, height: 810 });
  await enterTheWorld(citizen, "citizen");
  await waitForTheOffice(citizen);
  await citizen.waitForTimeout(3000);
  await citizen.screenshot({ path: "shots/office-citizen.png" });

  // A different culture furnishes a different room.
  const punic = await page.context().newPage();
  await punic.setViewportSize({ width: 1440, height: 810 });
  await enterTheWorld(punic, "carthaginian");
  await waitForTheOffice(punic);
  await punic.waitForTimeout(3000);
  await punic.screenshot({ path: "shots/office-carthaginian.png" });
});
