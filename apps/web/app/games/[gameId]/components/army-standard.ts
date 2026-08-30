import type { ForceFlagAsset } from "./geo-map";

// The conflict treatment is deliberately excluded: this is the exact painted
// flag rectangle, which is the only pointer target that may open army details.
export const ARMY_STANDARD_WIDTH = .18;
/** The interaction area starts just inside the painted combat/siege frame. */
export const ARMY_STANDARD_CONFLICT_FRAME_INSET = .004;

export interface ArmyStandardBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function armyStandardBounds(asset: ForceFlagAsset, centreX: number, centreY: number): ArmyStandardBounds {
  const height = ARMY_STANDARD_WIDTH / asset.aspectRatio;
  return {
    x: centreX - ARMY_STANDARD_WIDTH / 2,
    y: centreY - height / 2,
    width: ARMY_STANDARD_WIDTH,
    height,
  };
}

export function armyStandardHitBounds(asset: ForceFlagAsset, centreX: number, centreY: number, useConflictFrame: boolean): ArmyStandardBounds {
  const flag = armyStandardBounds(asset, centreX, centreY);
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
