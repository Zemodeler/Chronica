import type { ForceFlagAsset } from "./geo-map";

// The conflict treatment is deliberately excluded: this is the exact painted
// flag rectangle, which is the only pointer target that may open army details.
export const ARMY_STANDARD_WIDTH = .18;
/** Keeps the pulsing combat/siege frame outside the clickable flag area. */
export const ARMY_STANDARD_HIT_INSET = .012;

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

export function armyStandardHitBounds(asset: ForceFlagAsset, centreX: number, centreY: number): ArmyStandardBounds {
  const flag = armyStandardBounds(asset, centreX, centreY);
  return {
    x: flag.x + ARMY_STANDARD_HIT_INSET,
    y: flag.y + ARMY_STANDARD_HIT_INSET,
    width: flag.width - ARMY_STANDARD_HIT_INSET * 2,
    height: flag.height - ARMY_STANDARD_HIT_INSET * 2,
  };
}
