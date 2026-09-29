export interface ForceFlagAsset {
  readonly url: string;
  readonly aspectRatio: number;
  readonly contentBounds?: Readonly<{ x: number; y: number; width: number; height: number }>;
}

/** Drawn for a force whose standard has not been resolved yet. */
export const FALLBACK_FORCE_FLAG: ForceFlagAsset = { url: "/maps/generic-merchant-ship-standard.png", aspectRatio: 3 / 2 };

// The conflict treatment is deliberately excluded: this is the exact painted
// flag rectangle, which is the only pointer target that may open army details.
export const ARMY_STANDARD_WIDTH = .18;
/** The interaction area starts just inside the painted combat/siege frame. */
export const ARMY_STANDARD_CONFLICT_FRAME_INSET = .004;

// Held to an on-screen-pixel window regardless of zoom: below MIN it would
// shrink to an unusably small click target when zoomed out; above MAX (a
// fixed world-space width scaling unboundedly with zoom-in) it would balloon
// into an oversized blob at high zoom. The canvas draw (map-canvas-entities.ts)
// and the SVG hit target (geo-map.tsx) both call this so the clickable area
// always matches what's actually painted. Both pixel limits are multiplied by
// the display unit (map-display-unit.ts), so a standard keeps its share of the
// map on a large monitor.
const MIN_ARMY_STANDARD_PIXEL_WIDTH = 16;
const MAX_ARMY_STANDARD_PIXEL_WIDTH = 120;

/** World-space army standard width for the current zoom, held to an on-screen-pixel range scaled by the display unit. */
export function armyStandardWidthForZoom(pixelsPerDegree: number, unit = 1): number {
  const pixels = Math.min(Math.max(ARMY_STANDARD_WIDTH * pixelsPerDegree, MIN_ARMY_STANDARD_PIXEL_WIDTH * unit), MAX_ARMY_STANDARD_PIXEL_WIDTH * unit);
  return pixels / pixelsPerDegree;
}

export interface ArmyStandardBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function armyStandardBounds(asset: ForceFlagAsset, centreX: number, centreY: number, width: number = ARMY_STANDARD_WIDTH): ArmyStandardBounds {
  const height = width / asset.aspectRatio;
  return {
    x: centreX - width / 2,
    y: centreY - height / 2,
    width,
    height,
  };
}

export function armyStandardHitBounds(asset: ForceFlagAsset, centreX: number, centreY: number, useConflictFrame: boolean, width: number = ARMY_STANDARD_WIDTH): ArmyStandardBounds {
  const flag = armyStandardBounds(asset, centreX, centreY, width);
  if (useConflictFrame) {
    return {
      x: flag.x + ARMY_STANDARD_CONFLICT_FRAME_INSET,
      y: flag.y + ARMY_STANDARD_CONFLICT_FRAME_INSET,
      width: flag.width - ARMY_STANDARD_CONFLICT_FRAME_INSET * 2,
      height: flag.height - ARMY_STANDARD_CONFLICT_FRAME_INSET * 2,
    };
  }
  const content = asset.contentBounds ?? { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: flag.x + flag.width * content.x,
    y: flag.y + flag.height * content.y,
    width: flag.width * content.width,
    height: flag.height * content.height,
  };
}

/** Space between neighbouring standards in a row, as a share of a standard's width. */
const FAN_GAP = .12;

/**
 * Where a standard is drawn once forces sharing a point are put side by side:
 * a row centred on the point, one standard width and a gap apart, so none of
 * them covers another at any zoom.
 */
export function fannedStandardCentre(
  placement: Readonly<{ x: number; y: number; fan: { readonly index: number; readonly count: number } | null }>,
  width: number,
): { x: number; y: number } {
  if (placement.fan === null) return { x: placement.x, y: placement.y };
  const step = width * (1 + FAN_GAP);
  return { x: placement.x + (placement.fan.index - (placement.fan.count - 1) / 2) * step, y: placement.y };
}

/** Below this zoom the map draws no forces, so none may be hovered or clicked. */
export const FORCES_VISIBLE_FROM_SCALE = 2.5;

/** Extra reach around a standard's painted edge, in screen pixels (times the display unit), so a small flag is not a fiddly target. */
export const ARMY_STANDARD_HIT_SLOP_PIXELS = 4;
