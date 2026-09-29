import { describe, expect, it } from "vitest";
import { derivePoliticalMapState, type PoliticalOverlayInput } from "./political-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";
import { syntheticProvinceMap } from "./synthetic-province-map";
import { detachedFragmentProvinces, MIN_OUTLINE_PROVINCES, provinceLineStyle, strokeGroupOf, type StrokeGroup } from "./border-strokes";
import { isWaterPixel, seaMaskFromPixels } from "./sea-mask";

const COLUMNS = 12;
const ROWS = 10;
const world = prepareStaticWorldGeometry(syntheticProvinceMap({ columns: COLUMNS, rows: ROWS, pointsPerEdge: 4 }));
const idAt = (column: number, row: number) => `synthetic-${String(row * COLUMNS + column).padStart(5, "0")}`;

/**
 * Rome holds columns 0-8 but for a two-province hole of unclaimed land at (3,4)
 * and (4,4); three provinces at (11,0)-(11,2) are a detached island of Rome, two
 * empty columns away; Carthage is a two-province polity of its own at (6,7) and
 * (7,7); the rest is nobody's.
 */
function ownerAt(column: number, row: number): string | null {
  if ((column === 3 || column === 4) && row === 4) return null;
  if ((column === 6 || column === 7) && row === 7) return "carthage";
  if (column <= 8) return "rome";
  if (column === 11 && row <= 2) return "rome";
  return null;
}
const overlay: PoliticalOverlayInput = {
  polities: [{ polityId: "rome", name: "Rome" }, { polityId: "carthage", name: "Carthage" }],
  provinces: world.provinces.map((province) => {
    const index = Number(province.id.slice(-5));
    return { provinceId: province.id, controllerPolityId: ownerAt(index % COLUMNS, Math.floor(index / COLUMNS)), controlFirmnessBps: 5000, terrainId: "plain" };
  }),
};

function groups(isSea?: (x: number, y: number) => boolean) {
  const state = derivePoliticalMapState(world, overlay, null, undefined, isSea);
  const fragments = detachedFragmentProvinces(state);
  return { state, fragments, groupOf: (segment: (typeof state.borderSegments)[number]): StrokeGroup => strokeGroupOf(segment, state.ownerByProvince, fragments) };
}
const between = (state: ReturnType<typeof groups>["state"], a: string, b: string) => state.borderSegments.filter((segment) => (segment.provinceA === a && segment.provinceB === b) || (segment.provinceA === b && segment.provinceB === a));

describe("which line a border is drawn with", () => {
  it("draws the outline between two powers and a province line between provinces of one", () => {
    const { state, groupOf } = groups(() => true);
    const sameRome = between(state, idAt(1, 1), idAt(2, 1));
    const romeCarthage = between(state, idAt(6, 6), idAt(6, 7));
    expect(sameRome.length).toBeGreaterThan(0);
    expect(sameRome.every((segment) => groupOf(segment) === "internal")).toBe(true);
    expect(romeCarthage.length).toBeGreaterThan(0);
    expect(romeCarthage.every((segment) => groupOf(segment) === "outline")).toBe(true);
  });

  it("draws only a province line where a power meets unclaimed land, and a fainter one between unclaimed provinces", () => {
    const { state, groupOf } = groups(() => true);
    expect(between(state, idAt(8, 3), idAt(9, 3)).every((segment) => groupOf(segment) === "frontier")).toBe(true);
    expect(between(state, idAt(9, 3), idAt(10, 3)).every((segment) => groupOf(segment) === "unclaimed")).toBe(true);
  });

  it("outlines a shore but not the edge of empty ground", () => {
    const shore = groups(() => true);
    const empty = groups(() => false);
    const edge = (g: ReturnType<typeof groups>) => g.state.borderSegments.filter((segment) => segment.provinceB === null && segment.provinceA === idAt(0, 5));
    expect(edge(shore).length).toBeGreaterThan(0);
    expect(edge(shore).every((segment) => segment.classification === "coast" && shore.groupOf(segment) === "outline")).toBe(true);
    expect(edge(empty).every((segment) => segment.classification === "void" && empty.groupOf(segment) === "frontier")).toBe(true);
  });

  it("calls every edge without a neighbour a coast when it cannot tell the sea from empty ground", () => {
    const { state } = groups();
    expect(state.borderSegments.filter((segment) => segment.provinceB === null).every((segment) => segment.classification === "coast")).toBe(true);
  });
});

describe("the outline round small pieces", () => {
  it("counts a power's detached pieces of fewer than the minimum, never its main body or a lone small power", () => {
    const { fragments } = groups(() => true);
    expect(MIN_OUTLINE_PROVINCES).toBe(4);
    for (const row of [0, 1, 2]) expect(fragments.has(idAt(11, row))).toBe(true);
    expect(fragments.has(idAt(1, 1))).toBe(false);
    expect(fragments.has(idAt(6, 7))).toBe(false);
  });

  it("draws no ring round a two-province hole or a three-province island", () => {
    const { state, groupOf } = groups(() => true);
    const hole = [idAt(3, 4), idAt(4, 4)];
    const island = [idAt(11, 0), idAt(11, 1), idAt(11, 2)];
    for (const segment of state.borderSegments) {
      const touches = [segment.provinceA, segment.provinceB].some((id) => id !== null && (hole.includes(id) || island.includes(id)));
      if (touches) expect(groupOf(segment)).not.toBe("outline");
    }
  });

  it("still rings the main body and a small power that has no larger piece", () => {
    const { state, groupOf } = groups(() => true);
    const outlines = state.borderSegments.filter((segment) => groupOf(segment) === "outline");
    expect(outlines.some((segment) => segment.provinceA === idAt(6, 7) || segment.provinceB === idAt(6, 7))).toBe(true);
    expect(outlines.some((segment) => segment.provinceA === idAt(0, 0))).toBe(true);
  });
});

describe("the province lines' strength", () => {
  it("is a faint hairline zoomed out and plain from scale four, in steps rather than continuously", () => {
    const far = provinceLineStyle(1);
    const near = provinceLineStyle(4);
    expect(far.alpha).toBeLessThan(.15);
    expect(near.alpha).toBeGreaterThan(.35);
    expect(far.widthCssPixels).toBeGreaterThanOrEqual(.5);
    expect(near.widthCssPixels).toBeLessThanOrEqual(.8);
    expect(provinceLineStyle(40)).toEqual(near);
    expect(provinceLineStyle(1.01).tier).toBe(far.tier);
  });
});

describe("the sea mask", () => {
  it("tells blue water from land and reads a raster spanning the world", () => {
    expect(isWaterPixel(110, 170, 215)).toBe(true);
    expect(isWaterPixel(150, 160, 110)).toBe(false);
    const data = new Uint8ClampedArray([110, 170, 215, 255, 150, 160, 110, 255, 150, 160, 110, 255, 110, 170, 215, 255]);
    const isSea = seaMaskFromPixels(data, 2, 2);
    expect(isSea(-90, 45)).toBe(true);
    expect(isSea(90, 45)).toBe(false);
    expect(isSea(-90, -45)).toBe(false);
    expect(isSea(90, -45)).toBe(true);
    expect(isSea(200, 0)).toBe(false);
  });
});
