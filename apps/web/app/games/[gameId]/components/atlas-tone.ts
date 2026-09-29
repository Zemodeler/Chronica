import { ATLAS } from "../../../../lib/palette";

/**
 * Tones a satellite relief into an engraved plate, in place.
 *
 * Sea becomes one flat ink-teal; land keeps its relief as light and shade
 * but loses its greens and browns to a single sepia ramp. It runs once per
 * raster, when the image loads (see atlas-tone.worker.ts), never per frame:
 * the map blits the toned bitmap exactly as it blitted the raw one.
 *
 * Natural Earth's oceans are unmistakably blue, and nothing on land is: blue
 * clearly above red, and not below green, is water. How far above decides
 * how much, so a coastline pixel that is half sea is half ink -- a hard
 * threshold made staircases of every coast once the map was zoomed.
 */
export function toneAtlas(pixels: Uint8ClampedArray): void {
  const water = hex(ATLAS.water);
  const [lr, lg, lb] = ATLAS.sepiaLight;
  const [dr, dg, db] = ATLAS.sepiaDark;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const sea = b >= g - 4 ? Math.min(1, Math.max(0, (b - r - 6) / 22)) : 0;
    // Luminance, with the midtones pulled apart a little so the relief's
    // shading survives the loss of its colour.
    const flat = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    const luminance = Math.min(1, Math.max(0, (flat - 0.5) * 1.15 + 0.52));
    const land = 1 - sea;
    pixels[i] = (dr + (lr - dr) * luminance) * land + water[0] * sea;
    pixels[i + 1] = (dg + (lg - dg) * luminance) * land + water[1] * sea;
    pixels[i + 2] = (db + (lb - db) * luminance) * land + water[2] * sea;
  }
}

function hex(colour: string): readonly [number, number, number] {
  const value = Number.parseInt(colour.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
