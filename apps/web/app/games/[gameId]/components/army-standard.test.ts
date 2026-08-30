import { describe, expect, it } from "vitest";
import { ARMY_STANDARD_HIT_INSET, ARMY_STANDARD_WIDTH, armyStandardBounds, armyStandardHitBounds } from "./army-standard";

describe("army standard hit bounds", () => {
  it("matches the painted flag dimensions and has no allowance for the conflict outline", () => {
    expect(armyStandardBounds({ url: "/flag.png", aspectRatio: 4 / 3 }, 10, 20)).toEqual({
      x: 10 - ARMY_STANDARD_WIDTH / 2,
      y: 20 - (ARMY_STANDARD_WIDTH / (4 / 3)) / 2,
      width: ARMY_STANDARD_WIDTH,
      height: ARMY_STANDARD_WIDTH / (4 / 3),
    });
  });

  it("excludes the combat or siege frame from the clickable area", () => {
    const flag = armyStandardBounds({ url: "/flag.png", aspectRatio: 1 }, 10, 20);
    expect(armyStandardHitBounds({ url: "/flag.png", aspectRatio: 1 }, 10, 20)).toEqual({
      x: flag.x + ARMY_STANDARD_HIT_INSET,
      y: flag.y + ARMY_STANDARD_HIT_INSET,
      width: flag.width - ARMY_STANDARD_HIT_INSET * 2,
      height: flag.height - ARMY_STANDARD_HIT_INSET * 2,
    });
  });
});
