import { describe, expect, it } from "vitest";
import { MAX_DISPLAY_UNIT, MIN_DISPLAY_UNIT, displayUnit } from "./map-display-unit";
import { settlementLabelPixelFont, settlementLabelShown, settlementPixelRadius } from "./map-canvas-entities";
import { armyStandardWidthForZoom } from "./army-standard";

describe("display unit", () => {
  it("is the shorter side over 1000 CSS px, in tenths", () => {
    expect(displayUnit(1440, 800)).toBe(.8);
    expect(displayUnit(2560, 1300)).toBe(1.3);
    expect(displayUnit(1000, 1000)).toBe(1);
    expect(displayUnit(1234, 1049)).toBe(1);
    expect(displayUnit(1234, 1051)).toBe(1.1);
  });
  it("stays within its clamp", () => {
    expect(displayUnit(400, 300)).toBeGreaterThanOrEqual(MIN_DISPLAY_UNIT);
    expect(displayUnit(400, 300)).toBeLessThanOrEqual(.8);
    expect(displayUnit(8000, 4000)).toBe(MAX_DISPLAY_UNIT);
  });
  it("falls back to 1 for an empty container", () => {
    expect(displayUnit(0, 0)).toBe(1);
  });
});

describe("settlement sizes", () => {
  const laptop = displayUnit(1440, 800);
  const large = displayUnit(2560, 1300);

  it("gives a capital about 7 px on a laptop's map and 12 px on a large monitor's, zoomed out", () => {
    const small = settlementPixelRadius("capital", 1, laptop);
    const big = settlementPixelRadius("capital", 1, large);
    expect(small).toBeGreaterThanOrEqual(6.5);
    expect(small).toBeLessThanOrEqual(7.5);
    expect(big).toBeGreaterThanOrEqual(11);
    expect(big).toBeLessThanOrEqual(12.5);
  });
  it("names a capital at about 11 px on a laptop and 16 px on a large monitor, zoomed out", () => {
    const small = settlementLabelPixelFont("capital", 1, laptop);
    const big = settlementLabelPixelFont("capital", 1, large);
    expect(small).toBeGreaterThanOrEqual(10);
    expect(small).toBeLessThanOrEqual(12);
    expect(big).toBeGreaterThanOrEqual(15);
    expect(big).toBeLessThanOrEqual(17.5);
  });
  it("scales every size in proportion to the unit", () => {
    for (const type of ["capital", "city", "town", "fort", "village"]) {
      expect(settlementPixelRadius(type, 3, 1.2)).toBeCloseTo(settlementPixelRadius(type, 3, 1) * 1.2);
    }
    expect(armyStandardWidthForZoom(10, 1.3)).toBeCloseTo(armyStandardWidthForZoom(10, 1) * 1.3);
  });
  it("grows gently with zoom, with no jump, and stops at a ceiling", () => {
    let previous = settlementPixelRadius("capital", 1, 1);
    let previousLabel = settlementLabelPixelFont("capital", 1, 1);
    for (let step = 1; step <= 8 * Math.log2(80); step++) {
      const scale = 2 ** (step / 8);
      const radius = settlementPixelRadius("capital", scale, 1);
      const label = settlementLabelPixelFont("capital", scale, 1);
      expect(radius).toBeGreaterThanOrEqual(previous);
      expect(radius / previous).toBeLessThan(1.05);
      expect(label).toBeGreaterThanOrEqual(previousLabel);
      expect(label - previousLabel).toBeLessThanOrEqual(.5);
      previous = radius;
      previousLabel = label;
    }
    expect(settlementPixelRadius("capital", 80, 1)).toBe(settlementPixelRadius("capital", 40, 1));
    expect(settlementLabelPixelFont("capital", 80, 1)).toBe(settlementLabelPixelFont("capital", 40, 1));
    expect(settlementPixelRadius("capital", 80, 1)).toBeLessThan(settlementPixelRadius("capital", 1, 1) * 2);
  });
  it("keeps the markers' hierarchy", () => {
    const at = (type: string) => settlementPixelRadius(type, 5, 1);
    expect(at("capital")).toBeGreaterThan(at("port"));
    expect(at("port")).toBeGreaterThan(at("city"));
    expect(at("city")).toBeGreaterThan(at("village"));
    expect(at("village")).toBeGreaterThan(at("town"));
  });
  it("names capitals even zoomed all the way out, other settlements only close", () => {
    expect(settlementLabelShown(true, 1)).toBe(true);
    expect(settlementLabelShown(false, 1)).toBe(false);
    expect(settlementLabelShown(false, 3)).toBe(false);
    expect(settlementLabelShown(false, 5)).toBe(true);
  });
});
