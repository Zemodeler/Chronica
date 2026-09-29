/**
 * The map's display unit: how much larger than a laptop's map the current one
 * is, as one number every fixed on-screen size is multiplied by.
 *
 * Marker radii, label floors, gaps and the army standard's width are set in
 * CSS pixels. Held fixed, they read as tiny on a large monitor and crowded on
 * a small window. The unit is the shorter side of the map's container over
 * 1000 CSS px, clamped and quantised to tenths, so a 1440 by 800 map is 0.8
 * and a 2560 by 1300 map is 1.3. Tenths keep the label cache small (it is
 * part of the cache key; see map-canvas-labels.ts), and a window being
 * dragged a few pixels wider does not re-lay-out every label.
 */
export const MIN_DISPLAY_UNIT = .75;
export const MAX_DISPLAY_UNIT = 1.6;
const DISPLAY_UNIT_REFERENCE_PX = 1000;
const DISPLAY_UNIT_STEPS = 10;

export function displayUnit(containerW: number, containerH: number): number {
  const shorter = Math.min(containerW, containerH);
  if (!Number.isFinite(shorter) || shorter <= 0) return 1;
  const raw = Math.min(MAX_DISPLAY_UNIT, Math.max(MIN_DISPLAY_UNIT, shorter / DISPLAY_UNIT_REFERENCE_PX));
  // Round to tenths, then clamp again: 0.75 rounds up to 0.8, which is fine,
  // but the result must never leave the clamp.
  const stepped = Math.round(raw * DISPLAY_UNIT_STEPS) / DISPLAY_UNIT_STEPS;
  return Math.min(MAX_DISPLAY_UNIT, Math.max(MIN_DISPLAY_UNIT, stepped));
}

/** Below this zoom (MapViewport's "far" band) the map shows the whole world. */
export const FAR_ZOOM_SCALE = 2.5;
