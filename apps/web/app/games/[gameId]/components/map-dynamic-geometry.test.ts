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
});
