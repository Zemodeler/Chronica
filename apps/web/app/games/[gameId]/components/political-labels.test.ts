import { describe, expect, it } from "vitest";
import type { DynamicMapOverlay, GeoJsonMap } from "@chronica/shared";
import { derivePoliticalLabels } from "./political-labels";
import { derivePoliticalMapState, deriveWarBorderPaths, politicalColourFromId } from "./political-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";

const map: GeoJsonMap = { type: "FeatureCollection", features: [
  { type: "Feature", id: "west", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, properties: { kind: "province", name: "West" } },
  { type: "Feature", id: "east", geometry: { type: "Polygon", coordinates: [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]] }, properties: { kind: "province", name: "East" } },
  { type: "Feature", id: "nearby", geometry: { type: "Polygon", coordinates: [[[4.1, 0], [5.1, 0], [5.1, 1], [4.1, 1], [4.1, 0]]] }, properties: { kind: "province", name: "Nearby" } },
  { type: "Feature", id: "island", geometry: { type: "Polygon", coordinates: [[[20, 0], [21, 0], [21, 1], [20, 1], [20, 0]]] }, properties: { kind: "province", name: "Island" } },
] };
function overlay(provinces: DynamicMapOverlay["provinces"]): DynamicMapOverlay { return { revision: 1, polities: [{ polityId: "rome", name: "Roman Republic" }], politicalRelations: [], provinces, settlements: [], forces: [], conflicts: { battles: [], sieges: [], wars: [] } }; }
function expectMutedHsl(colour: string) {
  const [, saturation, lightness] = colour.match(/^hsl\([^ ]+ ([\d.]+)% ([\d.]+)%\)$/) ?? [];
  expect(colour).toMatch(/^hsl\(/);
  expect(Number(saturation)).toBeGreaterThanOrEqual(34);
  expect(Number(saturation)).toBeLessThanOrEqual(65);
  expect(Number(lightness)).toBeGreaterThanOrEqual(36);
  expect(Number(lightness)).toBeLessThanOrEqual(62);
}

describe("political map derivation", () => {
  it("uses a saturated red for Roman territory", () => {
    expect(politicalColourFromId("rome")).toBe("#b21f2d");
  });
  it("uses the Carthaginian blue-grey for territory", () => {
    expect(politicalColourFromId("carthage")).toBe("#2e245f");
    expect(politicalColourFromId("syracuse")).toBe("#80512f");
  });
  it("gives minor polities distinct shades within their cultural palette", () => {
    const arverni = politicalColourFromId("gaul-arverni");
    const aedui = politicalColourFromId("gaul-aedui");
    expectMutedHsl(arverni);
    expectMutedHsl(aedui);
    expect(aedui).not.toBe(arverni);
    expectMutedHsl(politicalColourFromId("boii"));
    expectMutedHsl(politicalColourFromId("iberia-celtiberians"));
    expectMutedHsl(politicalColourFromId("germania-suebi"));
  });
  it("assigns consolidated neighbouring realms distinct curated palette slots", () => {
    const groups = [
      ["gaul-aedui", "gaul-arverni", "gaul-sequani", "gaul-belgae"],
      ["germania-suebi", "germania-chatti", "germania-cherusci", "germania-chauci"],
      ["iberia-vaccei", "iberia-vettones", "iberia-carpetani", "iberia-celtiberi"],
      ["thrace-dacian-highland-communities", "thrace-getae", "thrace-eastern-carpathian-communities"],
    ] as const;
    for (const polityIds of groups) {
      const colours = polityIds.map(politicalColourFromId);
      expect(new Set(colours).size).toBe(colours.length);
      for (const colour of colours) expectMutedHsl(colour);
    }
  });
  it("gives Hungarian, Czech, and Polish polities distinct muted lineage shades", () => {
    const hungarian = politicalColourFromId("kingdom-of-hungary");
    const czech = politicalColourFromId("kingdom-of-bohemia");
    const polish = politicalColourFromId("kingdom-of-poland");
    expect(new Set([hungarian, czech, polish]).size).toBe(3);
    for (const colour of [hungarian, czech, polish]) expectMutedHsl(colour);
  });
  it("keeps major nations visually distinct from their cultural group", () => {
    expect(politicalColourFromId("macedon")).toBe("#355f91");
    expect(politicalColourFromId("macedon")).not.toBe(politicalColourFromId("athens"));
  });
  it("builds static adjacency and shared boundaries once", () => {
    const world = prepareStaticWorldGeometry(map);
    expect(world.provinceById.get("west")?.neighborIds).toEqual(["east"]);
    expect(world.provinceById.get("island")?.neighborIds).toEqual([]);
    expect(world.provinceById.get("east")?.labelNeighborIds).toEqual(["nearby", "west"]);
    expect(world.sharedBoundaries.some((boundary) => boundary.provinceA === "west" && boundary.provinceB === "east")).toBe(true);
  });
  it("keeps disconnected holdings out of the primary label territory", () => {
    const state = derivePoliticalMapState(prepareStaticWorldGeometry(map), overlay([
      { provinceId: "west", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
      { provinceId: "east", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
      { provinceId: "island", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "far" },
    ]));
    expect(state.territories[0]?.components).toHaveLength(2);
    expect(state.territories[0]?.primaryComponent.provinceIds).toEqual(["east", "west"]);
    expect(state.territories[0]?.label.anchor[0]).toBeLessThan(5);
    expect(derivePoliticalLabels(state).filter((label) => label.polityId === "rome")).toHaveLength(2);
  });
  it("uses one label for holdings separated only by a small map gap", () => {
    const state = derivePoliticalMapState(prepareStaticWorldGeometry(map), overlay([
      { provinceId: "east", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
      { provinceId: "nearby", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
    ]));
    expect(state.territories[0]?.components).toHaveLength(1);
    expect(derivePoliticalLabels(state).filter((label) => label.polityId === "rome")).toHaveLength(1);
  });
  it("classifies owner changes as country borders", () => {
    const state = derivePoliticalMapState(prepareStaticWorldGeometry(map), overlay([
      { provinceId: "west", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
      { provinceId: "east", controllerPolityId: null, controlFirmnessBps: 0, terrainId: "plain", tier: "focus" },
    ]));
    expect(state.borderSegments.some((border) => border.classification === "country_border")).toBe(true);
    expect(deriveWarBorderPaths(state, [])).toBe("");
  });
  it("draws only borders shared by active war pairs", () => {
    const state = derivePoliticalMapState(prepareStaticWorldGeometry(map), {
      polities: [{ polityId: "carthage", name: "Carthage" }, { polityId: "rome", name: "Rome" }],
      provinces: [
        { provinceId: "west", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
        { provinceId: "east", controllerPolityId: "carthage", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
      ],
    });
    expect(deriveWarBorderPaths(state, [])).toBe("");
    expect(deriveWarBorderPaths(state, [{ polityAId: "carthage", polityBId: "rome" }])).not.toBe("");
  });
  it("fits every component label to 85 percent of its selected path", () => {
    const state = derivePoliticalMapState(prepareStaticWorldGeometry(map), overlay([{ provinceId: "west", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" }]));
    const label = derivePoliticalLabels(state)[0];
    expect(label?.name).toBe("Roman Republic");
    expect(label?.usableLength).toBeCloseTo((label?.pathLength ?? 0) * .85);
    expect(label?.fontSize).toBeGreaterThan(0);
    const [start, , end] = label?.pathPoints ?? [[0, 0], [0, 0], [0, 0]];
    expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeGreaterThan(2.7);
  });
});
