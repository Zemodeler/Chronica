import { describe, expect, it } from "vitest";
import { ARMY_STANDARD_CONFLICT_FRAME_INSET, ARMY_STANDARD_WIDTH, armyStandardBounds, armyStandardHitBounds } from "./army-standard";

describe("army standard hit bounds", () => {
  it("matches the painted flag dimensions and has no allowance for the conflict outline", () => {
    expect(armyStandardBounds({ url: "/flag.png", aspectRatio: 4 / 3 }, 10, 20)).toEqual({
      x: 10 - ARMY_STANDARD_WIDTH / 2,
      y: 20 - (ARMY_STANDARD_WIDTH / (4 / 3)) / 2,
      width: ARMY_STANDARD_WIDTH,
      height: ARMY_STANDARD_WIDTH / (4 / 3),
    });
  });

  it("uses the flag artwork's rendered bounds when there is no conflict frame", () => {
    const flag = armyStandardBounds({ url: "/flag.png", aspectRatio: 1 }, 10, 20);
    expect(armyStandardHitBounds({ url: "/flag.png", aspectRatio: 1, contentBounds: { x: .1, y: .2, width: .7, height: .6 } }, 10, 20, false)).toEqual({
      x: flag.x + flag.width * .1,
      y: flag.y + flag.height * .2,
      width: flag.width * .7,
      height: flag.height * .6,
    });
  });

  it("uses only the inside of a combat or siege outline", () => {
    const flag = armyStandardBounds({ url: "/flag.png", aspectRatio: 1 }, 10, 20);
    expect(armyStandardHitBounds({ url: "/flag.png", aspectRatio: 1 }, 10, 20, true)).toEqual({
      x: flag.x + ARMY_STANDARD_CONFLICT_FRAME_INSET,
      y: flag.y + ARMY_STANDARD_CONFLICT_FRAME_INSET,
      width: flag.width - ARMY_STANDARD_CONFLICT_FRAME_INSET * 2,
      height: flag.height - ARMY_STANDARD_CONFLICT_FRAME_INSET * 2,
    });
  });
});
