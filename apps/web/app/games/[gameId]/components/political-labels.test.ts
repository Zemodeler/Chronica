import { describe, expect, it } from "vitest";
import type { DynamicMapOverlay, GeoJsonMap } from "@chronica/shared";
import { derivePoliticalLabels } from "./political-labels";
import { derivePoliticalMapState } from "./political-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";

const map: GeoJsonMap = { type: "FeatureCollection", features: [
  { type: "Feature", id: "west", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, properties: { kind: "province", name: "West" } },
  { type: "Feature", id: "east", geometry: { type: "Polygon", coordinates: [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]] }, properties: { kind: "province", name: "East" } },
  { type: "Feature", id: "island", geometry: { type: "Polygon", coordinates: [[[20, 0], [21, 0], [21, 1], [20, 1], [20, 0]]] }, properties: { kind: "province", name: "Island" } },
] };
function overlay(provinces: DynamicMapOverlay["provinces"]): DynamicMapOverlay { return { revision: 1, polities: [{ polityId: "rome", name: "Roman Republic" }], provinces, settlements: [], forces: [], hostileBorders: [] }; }

describe("political map derivation", () => {
  it("builds static adjacency and shared boundaries once", () => {
    const world = prepareStaticWorldGeometry(map);
    expect(world.provinceById.get("west")?.neighborIds).toEqual(["east"]);
    expect(world.provinceById.get("island")?.neighborIds).toEqual([]);
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
  });
  it("classifies owner changes as country borders", () => {
    const state = derivePoliticalMapState(prepareStaticWorldGeometry(map), overlay([
      { provinceId: "west", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" },
      { provinceId: "east", controllerPolityId: null, controlFirmnessBps: 0, terrainId: "plain", tier: "focus" },
    ]));
    expect(state.borderSegments.some((border) => border.classification === "country_border")).toBe(true);
  });
  it("keeps compact territory labels horizontal and applies LOD", () => {
    const state = derivePoliticalMapState(prepareStaticWorldGeometry(map), overlay([{ provinceId: "west", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "plain", tier: "focus" }]));
    expect(state.territories[0]?.label.angle).toBe(0);
    expect(derivePoliticalLabels(state, "close")[0]?.name).toBe("Roman Republic");
  });
});
