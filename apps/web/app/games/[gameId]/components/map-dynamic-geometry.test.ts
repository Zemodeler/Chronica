import { describe, expect, it } from "vitest";
import type { MapForceOverlay, MapMovementOverlay } from "@chronica/shared";
import { interpolateMovement, resolveForceMapPosition } from "./map-dynamic-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";

const movement: MapMovementOverlay = {
  start: [0, 0],
  destination: [6, 8],
  path: [[0, 0], [3, 0], [3, 4], [6, 8]],
  progressBps: 5_000,
  state: "moving",
};

describe("dynamic map geometry", () => {
  it("interpolates by cumulative segment length and clips the travelled route", () => {
    const result = interpolateMovement(movement);
    expect(result.coordinate).toEqual([3, 3]);
    expect(result.travelledPath).toEqual([[0, 0], [3, 0], [3, 3]]);
  });

  it("uses the supplied retreat direction and handles degenerate paths", () => {
    expect(interpolateMovement({ ...movement, state: "retreating", progressBps: 10_000 }).coordinate).toEqual([6, 8]);
    expect(interpolateMovement({ ...movement, path: [[0, 0], [0, 0]], destination: [0, 0] }).coordinate).toEqual([0, 0]);
  });

  it("prefers movement, then explicit coordinates, then the province centroid", () => {
    const world = prepareStaticWorldGeometry({ type: "FeatureCollection", features: [
      { type: "Feature", id: "province", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, properties: { kind: "province", name: "Province" } },
    ] });
    const force: MapForceOverlay = { forceId: "force", provinceId: "province", coordinate: [9, 9], ownerPolityId: "rome", name: "Force", commanderLabel: null, strengthLabel: "100", relation: "friendly", selected: false, movement };
    expect(resolveForceMapPosition(force, world)?.travelledPath?.at(-1)).toEqual([3, 3]);
    expect(resolveForceMapPosition({ ...force, movement: null }, world)?.x).toBe(9);
    expect(resolveForceMapPosition({ ...force, coordinate: undefined, movement: null }, world)?.x).toBe(1);
  });

  it("keeps an army visible when a legacy location has no polygon", () => {
    const world = prepareStaticWorldGeometry({ type: "FeatureCollection", features: [
      { type: "Feature", id: "rome", geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, properties: { kind: "province", name: "Rome" } },
      { type: "Feature", id: "carthage", geometry: { type: "Polygon", coordinates: [[[4, 0], [6, 0], [6, 2], [4, 2], [4, 0]]] }, properties: { kind: "province", name: "Carthage" } },
    ] });
    const force: MapForceOverlay = { forceId: "lost-legion", provinceId: "retired-location", ownerPolityId: "rome", name: "Lost Legion", commanderLabel: null, strengthLabel: "100", relation: "friendly", selected: false, movement: null };
    const overlay = {
      revision: 1,
      polities: [{ polityId: "rome", name: "Rome" }, { polityId: "carthage", name: "Carthage" }],
      politicalRelations: [],
      provinces: [
        { provinceId: "rome", controllerPolityId: "rome", controlFirmnessBps: 10_000, terrainId: "plain", tier: "focus" as const },
        { provinceId: "carthage", controllerPolityId: "carthage", controlFirmnessBps: 10_000, terrainId: "plain", tier: "focus" as const },
      ],
      settlements: [],
      forces: [force],
      conflicts: { battles: [], sieges: [], wars: [] },
    };

    expect(resolveForceMapPosition(force, world, overlay)?.x).toBe(1);
    expect(resolveForceMapPosition({ ...force, ownerPolityId: "unknown" }, world, overlay)?.x).toBe(1);
  });
});
