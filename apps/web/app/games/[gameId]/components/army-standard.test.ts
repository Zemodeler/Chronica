import { describe, expect, it } from "vitest";
import { ARMY_STANDARD_CONFLICT_FRAME_INSET, ARMY_STANDARD_WIDTH, armyStandardBounds, armyStandardHitBounds, fannedStandardCentre } from "./army-standard";

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

describe("fannedStandardCentre", () => {
  it("leaves a lone standard where it stands", () => {
    expect(fannedStandardCentre({ x: 3, y: -4, fan: null }, .18)).toEqual({ x: 3, y: -4 });
  });

  it("puts standards sharing a point side by side, never over each other", () => {
    // Offset 0.015 degrees apart, they covered each other almost exactly and
    // a click on the one on top opened the one beneath.
    const width = .18;
    const centres = [0, 1, 2].map((index) => fannedStandardCentre({ x: 10, y: 0, fan: { index, count: 3 } }, width));
    expect(centres[1]!.x).toBeCloseTo(10);
    for (let index = 1; index < centres.length; index++) {
      expect(centres[index]!.x - centres[index - 1]!.x).toBeGreaterThan(width);
    }
  });
});
