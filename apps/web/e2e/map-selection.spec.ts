import { expect, test, type Page } from "@playwright/test";
import { punicWarsScenario } from "@chronica/db";
import type { GeoJsonMapFeature, GeoJsonPosition } from "@chronica/shared";
import { computeViewBox } from "../app/games/[gameId]/components/geo-projection";
import { PUNIC_WARS_MAP_ASSET_ID, builtInScenarioMap } from "../lib/built-in-scenario-maps";
import { enterTheWorld, placeTab, theMap, waitForTheOffice } from "./fixture";

/**
 * Clicking a province selects it; dragging the map does not.
 *
 * The viewport used to capture every pointer on press. Captured to the map
 * frame, the click that ended the press went to the frame instead of the
 * map's interaction layer, so no province was ever selected -- and nothing
 * but a real browser could show it.
 */

const terrain = (page: Page) => theMap(page).locator("canvas").first();

/** Keep the canvas as it stands, to measure later frames against. */
const rememberCanvas = (page: Page) =>
  terrain(page).evaluate((canvas: HTMLCanvasElement) => {
    (window as unknown as { __before: Uint8ClampedArray }).__before =
      canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  });

/**
 * Pixels gone gold since the remembered frame. Hover draws a white outline,
 * selection a gold one (#f4cf68) over the same border, so going gold shows as
 * the blue channel falling while red holds.
 */
const pixelsGoneGold = (page: Page) =>
  terrain(page).evaluate((canvas: HTMLCanvasElement) => {
    const before = (window as unknown as { __before: Uint8ClampedArray }).__before;
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (before[i + 2]! - data[i + 2]! > 20 && data[i]! >= before[i]! - 10) count++;
    }
    return count;
  });

const inside = (rings: readonly (readonly GeoJsonPosition[])[], x: number, y: number) => {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
};

/**
 * A point well inside the largest province the Gaetuli hold, big enough that
 * its outline is plainly more than a few stray pixels. Read from the scenario
 * and the map, so no province id or name is spelt here.
 */
function gaetuliGround(): { provinceId: string; lon: number; lat: number } {
  const map = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID)!;
  const held = new Set(punicWarsScenario.initialWorld.map.provinces.filter((province) => province.controllerPolityId === "gaetuli").map((province) => province.id));
  let best: { provinceId: string; lon: number; lat: number; area: number } | undefined;
  for (const feature of map.features as GeoJsonMapFeature[]) {
    if (feature.properties.kind !== "province" || !held.has(String(feature.id))) continue;
    const g = feature.geometry;
    const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const rings of polygons) {
      const xs = rings[0]!.map((p) => p[0]); const ys = rings[0]!.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const area = (x1 - x0) * (y1 - y0);
      if (best !== undefined && area <= best.area) continue;
      // The grid point nearest the middle of the bounding box that is really inside.
      let pick: [number, number] | undefined; let nearest = Infinity;
      for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) {
        const x = x0 + ((x1 - x0) * i) / 30; const y = y0 + ((y1 - y0) * j) / 30;
        const d = Math.hypot(x - (x0 + x1) / 2, y - (y0 + y1) / 2);
        if (d < nearest && inside(rings, x, y)) { nearest = d; pick = [x, y]; }
      }
      if (pick !== undefined) best = { provinceId: String(feature.id), lon: pick[0], lat: pick[1], area };
    }
  }
  if (best === undefined) throw new Error("The scenario gives the Gaetuli no province on the map");
  return best;
}

/** That ground on the screen at the opening view: the map's own pointer maths, run backwards. */
async function inGaetuli(page: Page) {
  const ground = gaetuliGround();
  const [vx, vy, vw, vh] = computeViewBox(builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID)!).split(" ").map(Number) as [number, number, number, number];
  const frame = (await theMap(page).locator(".map-frame").boundingBox())!;
  const css = await theMap(page).locator(".map-frame > div").first().evaluate((el) => (el as HTMLElement).style.transform);
  const [, tx, ty, scale] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(css)!.map(Number) as [number, number, number, number];
  const sf = Math.min(frame.width / vw, frame.height / vh);
  const ox = (frame.width - vw * sf) / 2; const oy = (frame.height - vh * sf) / 2;
  return {
    x: frame.x + (ox - vx * sf) * scale + tx + ground.lon * sf * scale,
    y: frame.y + (oy - vy * sf) * scale + ty - ground.lat * sf * scale,
    provinceId: ground.provinceId,
  };
}

test.describe("selecting a province", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 810 });
    await enterTheWorld(page);
    await waitForTheOffice(page);
    await placeTab(page, "The Map").click();
    await theMap(page).locator(".geo-map").waitFor();
    // The terrain's first paint waits on its base images.
    await page.waitForTimeout(1500);
  });

  test("a click selects it in gold, and a second click lets it go", async ({ page }) => {
    const { x, y, provinceId } = await inGaetuli(page);
    await page.mouse.move(x, y);
    await page.waitForTimeout(300);
    await rememberCanvas(page);

    await page.mouse.click(x, y);
    await expect(theMap(page)).toHaveAttribute("data-selected-province", provinceId);
    await expect.poll(() => pixelsGoneGold(page)).toBeGreaterThan(200);

    await page.mouse.click(x, y);
    await expect(theMap(page)).not.toHaveAttribute("data-selected-province", /.*/);
    await expect.poll(() => pixelsGoneGold(page)).toBeLessThan(10);
  });

  test("a hand's tremor during the click still selects", async ({ page }) => {
    const { x, y } = await inGaetuli(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y + 1);
    await page.mouse.up();
    await expect(theMap(page)).toHaveAttribute("data-selected-province", /.+/);
  });

  test("a drag pans the map and selects nothing", async ({ page }) => {
    const { x, y } = await inGaetuli(page);
    const transformOf = () => theMap(page).locator(".map-frame > div").first().evaluate((el) => (el as HTMLElement).style.transform);
    const start = await transformOf();

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 30, { steps: 8 });
    await page.mouse.move(x + 150, y + 60, { steps: 8 });
    await page.mouse.up();

    expect(await transformOf()).not.toBe(start);
    await page.waitForTimeout(300);
    await expect(theMap(page)).not.toHaveAttribute("data-selected-province", /.*/);
  });
});
