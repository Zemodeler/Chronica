import { describe, expect, it } from "vitest";
import type { GeoJsonMap } from "@chronica/shared";
import { prepareStaticWorldGeometry } from "./world-geometry";

describe("territory hover geometry", () => {
  it("draws only the exterior when one territory consists of touching polygons", () => {
    const map = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        id: "joined-territory",
        properties: { kind: "province", name: "Joined territory" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]],
          ],
        },
      }],
    } as GeoJsonMap;

    const world = prepareStaticWorldGeometry(map);
    const territory = world.provinceById.get("joined-territory");

    expect(territory?.svgPath).toContain("L1 0L1 -1");
    expect(territory?.exteriorSvgPath).not.toContain("M1 0L1 -1");
    expect(territory?.exteriorSvgPath).not.toContain("M1 -1L1 0");
    expect(world.sharedBoundaries).toHaveLength(6);
    expect(world.sharedBoundaries.every((boundary) => boundary.provinceB === null)).toBe(true);
  });
});
