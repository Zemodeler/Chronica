/**
 * Where the sea is, read from the base raster (blue oceans), so a province edge
 * with no neighbour can be told apart: shore, or the edge of ground the map has
 * left empty (a desert or a massif). The geometry alone cannot say.
 */
export type SeaTest = (longitude: number, latitude: number) => boolean;

/** Whether an RGBA pixel is ocean or lake blue rather than land. */
export function isWaterPixel(r: number, g: number, b: number): boolean {
  return b > g + 8 && b > r + 30;
}

/** A test over a raster that spans -180..180 by 90..-90, from its RGBA pixels. */
export function seaMaskFromPixels(data: Uint8ClampedArray | Uint8Array, width: number, height: number): SeaTest {
  const water = new Uint8Array(width * height);
  for (let index = 0; index < water.length; index++) water[index] = isWaterPixel(data[index * 4]!, data[index * 4 + 1]!, data[index * 4 + 2]!) ? 1 : 0;
  return (longitude, latitude) => {
    const x = Math.floor((longitude + 180) / 360 * width);
    const y = Math.floor((90 - latitude) / 180 * height);
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return water[y * width + x] === 1;
  };
}

const MASK_WIDTH = 3600;
const MASK_HEIGHT = 1800;

/** Reads the mask from a decoded raster; null where the platform cannot. */
export async function seaMaskFromImage(image: HTMLImageElement): Promise<SeaTest | null> {
  if (typeof OffscreenCanvas === "undefined") return null;
  const bitmap = await createImageBitmap(image, { resizeWidth: MASK_WIDTH, resizeHeight: MASK_HEIGHT, resizeQuality: "medium" });
  const canvas = new OffscreenCanvas(MASK_WIDTH, MASK_HEIGHT);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) { bitmap.close(); return null; }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT);
  return seaMaskFromPixels(pixels.data, MASK_WIDTH, MASK_HEIGHT);
}
