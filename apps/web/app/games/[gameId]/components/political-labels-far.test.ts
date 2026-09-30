import { describe, expect, it } from "vitest";
import type { DynamicMapOverlay, GeoJsonMap } from "@chronica/shared";
import { derivePoliticalLabels, guaranteedLabelCount, type PoliticalLabelLayout } from "./political-labels";
import { derivePoliticalMapState } from "./political-geometry";
import { placeLabelLayouts, placeLabels } from "./map-canvas-labels";
import { prepareStaticWorldGeometry } from "./world-geometry";

type Square = { id: string; x: number; y: number; side: number; owner: string };

function scenario(squares: readonly Square[], names: Record<string, string>) {
  const map: GeoJsonMap = { type: "FeatureCollection", features: squares.map(({ id, x, y, side }) => ({
    type: "Feature", id,
    geometry: { type: "Polygon", coordinates: [[[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]] },
    properties: { kind: "province", name: id },
  })) };
  const overlay: DynamicMapOverlay = {
    revision: 1,
    polities: Object.entries(names).map(([polityId, name]) => ({ polityId, name })),
    politicalRelations: [],
    provinces: squares.map(({ id, owner }) => ({ provinceId: id, controllerPolityId: owner, controlFirmnessBps: 8500, terrainId: "plain" })),
    settlements: [], forces: [], conflicts: { battles: [], sieges: [], wars: [] },
  };
  return derivePoliticalMapState(prepareStaticWorldGeometry(map), overlay);
}

// Fourteen small polities, far apart, largest first; the largest also holds
// a detached island far away.
const polities = Array.from({ length: 14 }, (_, index) => ({ polityId: `p${index}`, side: 3 - index * .15 }));
const world = scenario([
  ...polities.map(({ polityId, side }, index) => ({ id: `${polityId}-home`, x: index * 60, y: 0, side, owner: polityId })),
  { id: "p0-island", x: 0, y: 40, side: 1, owner: "p0" },
], Object.fromEntries(polities.map(({ polityId }) => [polityId, `Kingdom ${polityId}`])));
// Zoomed all the way out: two CSS px to a degree, far below where any of
// these names would fit.
const FAR_PIXELS_PER_DEGREE = 2;

describe("guaranteed polity labels at far zoom", () => {
  it("scales the guaranteed count by the display unit", () => {
    expect(guaranteedLabelCount(1)).toBe(12);
    expect(guaranteedLabelCount(.8)).toBe(10);
    expect(guaranteedLabelCount(1.3)).toBe(16);
  });

  it("hides every one of these names without the guaranteed set", () => {
    expect(derivePoliticalLabels(world, FAR_PIXELS_PER_DEGREE)).toHaveLength(0);
    expect(derivePoliticalLabels(world, FAR_PIXELS_PER_DEGREE, { scale: 3, unit: 1 })).toHaveLength(0);
  });

  it("names the top N polities by total area once each, bypassing the fit thresholds", () => {
    const labels = derivePoliticalLabels(world, FAR_PIXELS_PER_DEGREE, { scale: 1, unit: 1 });
    expect(labels.every((label) => label.guaranteed)).toBe(true);
    expect(labels.map((label) => label.polityId).sort()).toEqual(polities.slice(0, 12).map((p) => p.polityId).sort());
    expect(new Set(labels.map((label) => label.polityId)).size).toBe(labels.length);
    // Too big for a 3-degree square at 11 px: set straight, at the floor.
    for (const label of labels) {
      expect(label.straight).toBe(true);
      expect(label.fontSize * FAR_PIXELS_PER_DEGREE).toBeCloseTo(11);
    }
  });

  it("names fewer polities on a smaller display unit, at a smaller floor", () => {
    const labels = derivePoliticalLabels(world, FAR_PIXELS_PER_DEGREE, { scale: 1, unit: .8 });
    expect(labels).toHaveLength(10);
    for (const label of labels) expect(label.fontSize * FAR_PIXELS_PER_DEGREE).toBeCloseTo(8.8);
  });

  it("labels a polity's detached pieces only once zoomed in", () => {
    const far = derivePoliticalLabels(world, 40, { scale: 1, unit: 1 }).filter((label) => label.polityId === "p0");
    expect(far).toHaveLength(1);
    const near = derivePoliticalLabels(world, 40, { scale: 3, unit: 1 }).filter((label) => label.polityId === "p0");
    expect(near).toHaveLength(2);
    expect(near.every((label) => !label.guaranteed)).toBe(true);
  });

  it("places all of them when they do not collide", () => {
    const placed = placeLabels(world, FAR_PIXELS_PER_DEGREE, 1, 1);
    expect(placed.map((entry) => entry.label.polityId).sort()).toEqual(polities.slice(0, 12).map((p) => p.polityId).sort());
  });
});

describe("guaranteed label collisions", () => {
  const boxOf = (characters: readonly { x: number; y: number }[], fontSize: number) => {
    const half = fontSize * .55;
    return {
      minX: Math.min(...characters.map((c) => c.x)) - half, maxX: Math.max(...characters.map((c) => c.x)) + half,
      minY: Math.min(...characters.map((c) => c.y)) - half, maxY: Math.max(...characters.map((c) => c.y)) + half,
    };
  };

  it("slides a colliding straight label along its line rather than dropping it", () => {
    // At 2 px a degree the 11 px floor is 5.5 degrees. Two short names whose
    // anchors are two font sizes apart overlap where they sit, and clear once
    // one slides.
    const pair = scenario([
      { id: "a", x: 0, y: 0, side: 1, owner: "a" },
      { id: "b", x: 11, y: 0, side: 1, owner: "b" },
    ], { a: "Abc", b: "Def" });
    const placed = placeLabels(pair, FAR_PIXELS_PER_DEGREE, 1, 1);
    expect(placed.map((entry) => entry.label.polityId).sort()).toEqual(["a", "b"]);
    const [first, second] = placed.map((entry) => boxOf(entry.characters, entry.label.fontSize));
    expect(first!.maxX <= second!.minX || second!.maxX <= first!.minX).toBe(true);
    // Without the guaranteed set, neither fits at all.
    expect(placeLabels(pair, FAR_PIXELS_PER_DEGREE)).toHaveLength(0);
  });

  it("steps two colliding guaranteed labels down together before dropping either", () => {
    const layout = (id: string, x: number, priority: number): PoliticalLabelLayout => ({
      id, polityId: id, name: "Abcde", pathPoints: [[x, 0], [x + 5, 0], [x + 10, 0]], pathLength: 10, usableLength: 8,
      fontSize: 2, priority, guaranteed: true, minFontSize: 1, straight: false,
    });
    // A's letters run from 1 to 9, B's from 9 to 17: they touch at full size.
    const placed = placeLabelLayouts([layout("a", 0, 2), layout("b", 8, 1)]);
    expect(placed.map((entry) => entry.label.id)).toEqual(["a", "b"]);
    for (const entry of placed) {
      expect(entry.label.fontSize).toBeLessThan(2);
      expect(entry.label.fontSize).toBeGreaterThanOrEqual(1);
    }
    const [first, second] = placed.map((entry) => boxOf(entry.characters, entry.label.fontSize));
    expect(first!.maxX).toBeLessThanOrEqual(second!.minX);
  });

  it("drops the lower-priority label when neither stepping down nor sliding clears it", () => {
    const layout = (id: string, priority: number): PoliticalLabelLayout => ({
      id, polityId: id, name: "Abcde", pathPoints: [[0, 0], [5, 0], [10, 0]], pathLength: 10, usableLength: 8,
      fontSize: 2, priority, guaranteed: true, minFontSize: 1.5, straight: false,
    });
    expect(placeLabelLayouts([layout("b", 1), layout("a", 2)]).map((entry) => entry.label.id)).toEqual(["a"]);
  });
});

describe("names around settlement markers", () => {
  const layout = (guaranteed: boolean): PoliticalLabelLayout => ({
    id: "a", polityId: "a", name: "Abcde", pathPoints: [[0, 0], [10, 0], [20, 0]], pathLength: 20, usableLength: 8,
    fontSize: 2, priority: 1, guaranteed, minFontSize: 2, straight: false,
  });
  // A marker just left of the middle of the path, where the name would sit.
  const marker = { minX: 9, maxX: 10, minY: -1, maxY: 1 };
  const clearOfMarker = (entry: { characters: readonly { x: number }[]; label: PoliticalLabelLayout }) =>
    entry.characters.every(({ x }) => x - entry.label.fontSize * .55 >= marker.maxX || x + entry.label.fontSize * .55 <= marker.minX);

  it("slides a name along its path to clear a marker", () => {
    for (const guaranteed of [false, true]) {
      const [entry] = placeLabelLayouts([layout(guaranteed)], [marker]);
      expect(entry).toBeDefined();
      expect(clearOfMarker(entry!)).toBe(true);
    }
  });

  it("keeps a guaranteed name even when no slide clears the marker, but drops an ordinary one", () => {
    const wall = { minX: -5, maxX: 25, minY: -1, maxY: 1 };
    expect(placeLabelLayouts([layout(false)], [wall])).toHaveLength(0);
    expect(placeLabelLayouts([layout(true)], [wall])).toHaveLength(1);
  });
});
