import { describe, expect, it } from "vitest";
import { FAR_CAPITAL_LABEL_MIN_IMPORTANCE, settlementLabelShown } from "./map-canvas-entities";

describe("which settlement names are drawn", () => {
  it("names only the great capitals zoomed all the way out, every capital from medium zoom, and every place close in", () => {
    expect(settlementLabelShown(true, 1, FAR_CAPITAL_LABEL_MIN_IMPORTANCE)).toBe(true);
    expect(settlementLabelShown(true, 1, FAR_CAPITAL_LABEL_MIN_IMPORTANCE - 1)).toBe(false);
    expect(settlementLabelShown(true, 2.5, 10)).toBe(true);
    expect(settlementLabelShown(false, 2.5, 100)).toBe(false);
    expect(settlementLabelShown(false, 5, 10)).toBe(true);
  });
});
