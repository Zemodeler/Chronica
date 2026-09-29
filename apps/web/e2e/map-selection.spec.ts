import { expect, test, type Page } from "@playwright/test";
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

/**
 * Inside Gaetuli at the opening view (an Algerian province, id dza-...): where
 * the fault was found,
 * and big enough that its outline is plainly more than a few stray pixels.
 */
async function inGaetuli(page: Page) {
  const box = (await theMap(page).locator(".geo-map").boundingBox())!;
  return { x: box.x + box.width * 0.32, y: box.y + box.height * 0.75 };
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
    const { x, y } = await inGaetuli(page);
    await page.mouse.move(x, y);
    await page.waitForTimeout(300);
    await rememberCanvas(page);

    await page.mouse.click(x, y);
    await expect(theMap(page)).toHaveAttribute("data-selected-province", /^dza-/);
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
