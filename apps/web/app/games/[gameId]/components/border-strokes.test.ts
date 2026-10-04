import { describe, expect, it } from "vitest";
import { derivePoliticalMapState, type PoliticalOverlayInput } from "./political-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";
import { syntheticProvinceMap } from "./synthetic-province-map";
import { detachedFragmentProvinces, enclosedGapBorders, MIN_OUTLINE_PROVINCES, provinceLineStyle, strokeGroupOf, type StrokeGroup } from "./border-strokes";
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
  const enclosedGaps = enclosedGapBorders(world, state);
  return { state, fragments, groupOf: (segment: (typeof state.borderSegments)[number]): StrokeGroup => strokeGroupOf(segment, state.ownerByProvince, fragments, enclosedGaps) };
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

  it("outlines a power beside unclaimed land, with a fainter line between unclaimed provinces", () => {
    const { state, groupOf } = groups(() => true);
    expect(between(state, idAt(8, 3), idAt(9, 3)).every((segment) => groupOf(segment) === "outline")).toBe(true);
    expect(between(state, idAt(9, 3), idAt(10, 3)).every((segment) => groupOf(segment) === "unclaimed")).toBe(true);
  });

  it("outlines both a shore and the edge of missing land geometry", () => {
    const shore = groups(() => true);
    const empty = groups(() => false);
    const edge = (g: ReturnType<typeof groups>) => g.state.borderSegments.filter((segment) => segment.provinceB === null && segment.provinceA === idAt(0, 5));
    expect(edge(shore).length).toBeGreaterThan(0);
    expect(edge(shore).every((segment) => segment.classification === "coast" && shore.groupOf(segment) === "outline")).toBe(true);
    expect(edge(empty).every((segment) => segment.classification === "void" && empty.groupOf(segment) === "outline")).toBe(true);
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

  it("hides an enclosed unclaimed hole while keeping a detached three-province island quiet", () => {
    const { state, groupOf } = groups(() => true);
    const hole = [idAt(3, 4), idAt(4, 4)];
    const island = [idAt(11, 0), idAt(11, 1), idAt(11, 2)];
    for (const segment of state.borderSegments) {
      const sides = [segment.provinceA, segment.provinceB];
      if (sides.some((id) => id !== null && island.includes(id))) expect(groupOf(segment)).not.toBe("outline");
      if (sides.some((id) => id !== null && hole.includes(id)) && sides.some((id) => id !== null && !hole.includes(id))) expect(groupOf(segment)).toBe("none");
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

describe("missing geometry inside and outside a country", () => {
  function missingCells(removed: ReadonlySet<string>) {
    const source = syntheticProvinceMap({ columns: 8, rows: 8, pointsPerEdge: 3 });
    const geometry = prepareStaticWorldGeometry({ ...source, features: source.features.filter((feature) => !removed.has(feature.id)) });
    const political = derivePoliticalMapState(geometry, {
      polities: [{ polityId: "rome", name: "Rome" }],
      provinces: geometry.provinces.map((province) => ({ provinceId: province.id, controllerPolityId: "rome", controlFirmnessBps: 5000, terrainId: "plain" })),
    }, null, undefined, () => false);
    return { geometry, political, hidden: enclosedGapBorders(geometry, political) };
  }
  const cell = (column: number, row: number) => `synthetic-${String(row * 8 + column).padStart(5, "0")}`;

  it("hides a hole with no province geometry and retains the outer perimeter", () => {
    const { political, hidden } = missingCells(new Set([cell(3, 3), cell(4, 3)]));
    expect(hidden.size).toBeGreaterThan(0);
    expect([...hidden].every((edge) => edge.classification === "void")).toBe(true);
    const exterior = political.borderSegments.filter((edge) => edge.provinceA === cell(0, 0) && edge.provinceB === null);
    expect(exterior.length).toBeGreaterThan(0);
    for (const edge of exterior) expect(strokeGroupOf(edge, political.ownerByProvince, new Set(), hidden)).toBe("outline");
    for (const edge of hidden) expect(strokeGroupOf(edge, political.ownerByProvince, new Set(), hidden)).toBe("none");
  });

  it("keeps the outline along a missing corridor that opens to the outside", () => {
    const { political, hidden } = missingCells(new Set([0, 1, 2, 3, 4].map((column) => cell(column, 3))));
    expect(hidden.size).toBe(0);
    const facingGap = political.borderSegments.filter((edge) => edge.provinceA === cell(3, 2) && edge.provinceB === null);
    expect(facingGap.length).toBeGreaterThan(0);
    expect(facingGap.every((edge) => strokeGroupOf(edge, political.ownerByProvince, new Set(), hidden) === "outline")).toBe(true);
  });

  it("keeps a border around another nation's enclave", () => {
    const { state, groupOf } = groups(() => false);
    const enclave = between(state, idAt(6, 6), idAt(6, 7));
    expect(enclave.length).toBeGreaterThan(0);
    expect(enclave.every((edge) => groupOf(edge) === "outline")).toBe(true);
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
