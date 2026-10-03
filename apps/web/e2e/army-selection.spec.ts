import { expect, test, type Page } from "@playwright/test";
import type { DynamicMapOverlay, GeoJsonMap } from "@chronica/shared";
import { armyStandardWidthForZoom, fannedStandardCentre } from "../app/games/[gameId]/components/army-standard";
import { computeViewBox } from "../app/games/[gameId]/components/geo-projection";
import { resolveMapForcePlacements } from "../app/games/[gameId]/components/map-dynamic-geometry";
import { prepareStaticWorldGeometry } from "../app/games/[gameId]/components/world-geometry";
import { enterTheWorld, placeTab, theMap, waitForTheOffice } from "./fixture";

/**
 * Clicking an army opens that army, and only where one is drawn.
 *
 * Province clicks had a spec; army clicks had none, and four faults stacked
 * up unseen: flags that were not drawn at the opening zoom could still be
 * clicked, a flag gave no sign it was clickable, the army on top of a stack
 * opened the one beneath it, and a standard chosen for an army was kept only
 * by the browser tab.
 *
 * Where a flag is on screen is worked out with the map's own geometry code,
 * from the same map and overlay the page was given.
 */

type Geometry = { readonly viewBox: string; readonly placements: ReturnType<typeof resolveMapForcePlacements> };

async function loadGeometry(page: Page, gameId: string): Promise<Geometry> {
  const { map, overlay } = await page.evaluate(async (id): Promise<{ map: GeoJsonMap; overlay: DynamicMapOverlay }> => {
    const [map, overlay] = await Promise.all([
      fetch(`/api/games/${id}/map`).then((response) => response.json() as Promise<GeoJsonMap>),
      fetch(`/api/games/${id}/overlay`).then((response) => response.json() as Promise<{ mapOverlay: DynamicMapOverlay }>),
    ]);
    return { map, overlay: overlay.mapOverlay };
  }, gameId);
  const world = prepareStaticWorldGeometry(map);
  return { viewBox: computeViewBox(map), placements: resolveMapForcePlacements(overlay.forces, world, overlay) };
}

/** Where this force's standard is drawn right now, in page pixels. */
async function standardOnScreen(page: Page, geometry: Geometry, forceId: string): Promise<{ x: number; y: number }> {
  const placement = geometry.placements.find((candidate) => candidate.forceId === forceId);
  if (placement === undefined) throw new Error(`No placement for ${forceId}`);
  const rect = (await theMap(page).locator(".map-frame").boundingBox())!;
  const transform = await theMap(page).locator(".map-frame > div").first().evaluate((el) => (el as HTMLElement).style.transform);
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(transform);
  const [tx, ty, scale] = match === null ? [0, 0, 1] : [Number(match[1]), Number(match[2]), Number(match[3])];
  const [vx, vy, vw, vh] = geometry.viewBox.split(" ").map(Number) as [number, number, number, number];
  const sf = Math.min(rect.width / vw, rect.height / vh);
  const ox = (rect.width - vw * sf) / 2;
  const oy = (rect.height - vh * sf) / 2;
  const m = sf * scale;
  const centre = fannedStandardCentre(placement, armyStandardWidthForZoom(m));
  return {
    x: rect.x + (ox - vx * sf) * scale + tx + centre.x * m,
    y: rect.y + (oy - vy * sf) * scale + ty + centre.y * m,
  };
}

const currentScale = async (page: Page) => Number(await theMap(page).getAttribute("data-scale"));

/** Wheel in over this force until the map draws armies, keeping it under the pointer. */
async function zoomOnto(page: Page, geometry: Geometry, forceId: string, toScale = 5) {
  for (let turn = 0; turn < 40 && (await currentScale(page)) < toScale; turn++) {
    const { x, y } = await standardOnScreen(page, geometry, forceId);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
  await expect.poll(() => currentScale(page)).toBeGreaterThanOrEqual(toScale);
  // Let the wheel settle, so the transform read next is the one drawn.
  await page.waitForTimeout(400);
}

const details = (page: Page) => page.locator(".map-force-details");

async function openTheMap(page: Page, who: "consul" | "carthaginian") {
  const gameId = await enterTheWorld(page, who);
  try {
    await waitForTheOffice(page);
  } catch (error) {
    // The first map fetch can race the dev server's initial route compilation.
    // The page retries on focus; exercise that path when it shows its empty state.
    if (!await page.getByText("No map data available for this scenario.").isVisible()) throw error;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await waitForTheOffice(page);
  }
  await placeTab(page, "The Map").click();
  await theMap(page).locator(".geo-map").waitFor();
  await page.waitForTimeout(1500);
  return gameId;
}

test.describe("selecting an army", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(240_000);
    // Narrower than the ~1290px at which the order bar used to cover the
    // army panel's buttons.
    await page.setViewportSize({ width: 1200, height: 810 });
  });

  test("at the opening zoom, where no army is drawn, a click picks the province", async ({ page }) => {
    const gameId = await openTheMap(page, "consul");
    const geometry = await loadGeometry(page, gameId);
    const latium = await standardOnScreen(page, geometry, "roman-field-army");
    await page.mouse.click(latium.x, latium.y);
    await expect(theMap(page)).toHaveAttribute("data-selected-province", /.+/);
    await expect(details(page)).toHaveCount(0);
  });

  test("a flag says it can be clicked, and a click opens its army", async ({ page }) => {
    const gameId = await openTheMap(page, "consul");
    const geometry = await loadGeometry(page, gameId);
    await zoomOnto(page, geometry, "roman-field-army");

    const flag = await standardOnScreen(page, geometry, "roman-field-army");
    await page.mouse.move(flag.x, flag.y);
    await expect(theMap(page).locator(".geo-map")).toHaveAttribute("data-over-force", "");
    await expect(page.locator(".map-tooltip")).toHaveText("Roman field army");

    await page.mouse.click(flag.x, flag.y);
    await expect(details(page)).toContainText("Roman field army");
    await expect(theMap(page)).not.toHaveAttribute("data-selected-province", /.*/);

    // Above the order bar, so its buttons can be pressed.
    await details(page).getByRole("button", { name: "Change standard" }).click();
    await expect(page.getByRole("dialog", { name: /army standards/ })).toBeVisible();
  });

  test("armies sharing a province each open themselves", async ({ page }) => {
    // The Campanian legion and the Allied Greek hulls start in the same
    // province; they used to be drawn almost exactly on top of each other.
    const gameId = await openTheMap(page, "consul");
    const geometry = await loadGeometry(page, gameId);
    await zoomOnto(page, geometry, "campanian-legion");

    for (const [forceId, name] of [["campanian-legion", "Campanian legion of Rhegium"], ["allied-greek-hulls", "Allied Greek hulls"]] as const) {
      const flag = await standardOnScreen(page, geometry, forceId);
      await page.mouse.click(flag.x, flag.y);
      await expect(details(page).locator("h2")).toHaveText(name);
    }
    // Not his: the Campanians answer to Decius Vibellius.
    await expect(details(page).getByRole("button", { name: "Rename" })).toHaveCount(1);
    const campanians = await standardOnScreen(page, geometry, "campanian-legion");
    await page.mouse.click(campanians.x, campanians.y);
    await expect(details(page).getByRole("button", { name: "Rename" })).toHaveCount(0);
  });

  test("a commander's new name and standard are kept by the world", async ({ page }) => {
    // The Carthaginian world, so the Chronicle entries this writes are nobody
    // else's spec's business.
    const gameId = await openTheMap(page, "carthaginian");
    const geometry = await loadGeometry(page, gameId);
    await zoomOnto(page, geometry, "carthaginian-garrison");

    const flag = await standardOnScreen(page, geometry, "carthaginian-garrison");
    await page.mouse.click(flag.x, flag.y);
    await expect(details(page)).toContainText("Carthaginian field force");

    await details(page).getByRole("button", { name: "Rename" }).click();
    await details(page).getByLabel("New name").fill("Sacred Band of Tunis");
    await details(page).getByRole("button", { name: "Save" }).click();
    await expect(details(page).locator("h2")).toHaveText("Sacred Band of Tunis", { timeout: 60_000 });

    await details(page).getByRole("button", { name: "Change standard" }).click();
    await page.getByRole("dialog", { name: /army standards/ }).getByRole("button", { name: /Punic elephant/ }).click();
    await expect(page.getByRole("dialog", { name: /army standards/ })).toHaveCount(0);

    // Not the tab's memory: the world's.
    const saved = await page.evaluate(async (id) => ((await (await fetch(`/api/games/${id}/overlay`)).json()) as { mapOverlay: DynamicMapOverlay }).mapOverlay.forces, gameId);
    const garrison = saved.find((force) => force.forceId === "carthaginian-garrison")!;
    expect(garrison.name).toBe("Sacred Band of Tunis");
    expect(garrison.flagAssetId).toBe("carthage-elephant");

    // And nobody may re-flag an army that is not theirs.
    const refused = await page.evaluate(async (id) => (await fetch(`/api/games/${id}/forces/roman-field-army`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ standardId: "merchant-ship" }),
    })).status, gameId);
    expect(refused).toBe(403);
  });

  test("a fleet takes a navy standard and refuses an army standard", async ({ page }) => {
    const gameId = await openTheMap(page, "consul");
    const geometry = await loadGeometry(page, gameId);
    await zoomOnto(page, geometry, "allied-greek-hulls");
    const flag = await standardOnScreen(page, geometry, "allied-greek-hulls");
    await page.mouse.click(flag.x, flag.y);
    await expect(details(page).locator("h2")).toHaveText("Allied Greek hulls");

    await details(page).getByRole("button", { name: "Change standard" }).click();
    const picker = page.getByRole("dialog", { name: /navy standards/ });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: /Corvus quinquereme/ })).toBeVisible();
    await expect(picker.getByRole("button", { name: /Wolf signum/ })).toHaveCount(0);
    await picker.getByRole("button", { name: /Corvus quinquereme/ }).click();
    await expect(picker).toHaveCount(0);

    const saved = await page.evaluate(async (id) => ((await (await fetch(`/api/games/${id}/overlay`)).json()) as { mapOverlay: DynamicMapOverlay }).mapOverlay.forces, gameId);
    expect(saved.find((force) => force.forceId === "allied-greek-hulls")?.flagAssetId).toBe("navy-roman-corvus");

    const refused = await page.evaluate(async (id) => {
      const response = await fetch(`/api/games/${id}/forces/allied-greek-hulls`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ standardId: "roman-wolf" }),
      });
      return { status: response.status, body: await response.json() as { error?: string } };
    }, gameId);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/not one .* may carry/);
  });
});
