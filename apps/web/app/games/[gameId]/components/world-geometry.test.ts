import { describe, expect, it } from "vitest";
import type { GeoJsonMap } from "@chronica/shared";
import { prepareStaticWorldGeometry, provinceAtPoint, provinceContains, provincesInRect } from "./world-geometry";
import { syntheticProvinceMap } from "./synthetic-province-map";

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
    const edges = world.sharedBoundaries.reduce((sum, boundary) => sum + boundary.points.length - 1, 0);
    expect(edges).toBe(6);
    expect(world.sharedBoundaries.every((boundary) => boundary.provinceB === null)).toBe(true);
  });
});

describe("a dense map", () => {
  const map = syntheticProvinceMap({ columns: 24, rows: 18, pointsPerEdge: 4 });
  const world = prepareStaticWorldGeometry(map);
  const edgesIn = (boundaries: readonly { readonly points: readonly unknown[] }[]) => boundaries.reduce((sum, boundary) => sum + boundary.points.length - 1, 0);

  it("finds neighbours by shared vertices, symmetrically", () => {
    expect(world.provinceById.get("synthetic-00030")!.neighborIds).toHaveLength(4);
    for (const province of world.provinces) for (const id of province.neighborIds) expect(world.provinceById.get(id)!.neighborIds).toContain(province.id);
  });

  it("gives label neighbours exactly what a comparison of every pair finds", () => {
    const gap = 0.22;
    type Province = typeof world.provinces[number];
    const distance = (a: Province, b: Province) => Math.hypot(
      Math.max(0, a.bounds.minX - b.bounds.maxX, b.bounds.minX - a.bounds.maxX),
      Math.max(0, a.bounds.minY - b.bounds.maxY, b.bounds.minY - a.bounds.maxY),
    );
    for (const first of world.provinces) {
      const expected = world.provinces.filter((second) => second !== first && (first.neighborIds.includes(second.id) || distance(first, second) <= gap)).map((second) => second.id).sort();
      expect(first.labelNeighborIds).toEqual(expected);
    }
  });

  it("lists every edge of every border once, as runs, and gives each run to both neighbours", () => {
    const shared = world.sharedBoundaries.filter((boundary) => boundary.provinceB !== null);
    const coast = world.sharedBoundaries.filter((boundary) => boundary.provinceB === null);
    // Five edges to a side: four inner points and a corner.
    expect(edgesIn(shared)).toBe((23 * 18 + 24 * 17) * 5);
    expect(edgesIn(coast)).toBe(2 * (24 + 18) * 5);
    for (const boundary of shared) expect(world.boundariesByProvince.get(boundary.provinceB!)).toContain(boundary);
    expect(shared[0]!.svgPath.startsWith("M")).toBe(true);
    // Each edge is its own subpath, so a dashed stroke restarts on every edge.
    expect((shared[0]!.svgPath.match(/M/g) ?? []).length).toBe(shared[0]!.points.length - 1);
  });

  it("answers a rectangle and a point the way a scan of every province does", () => {
    const rect = { minX: -8.7, minLat: 32.1, maxX: -7.2, maxLat: 33.4 };
    const scanned = world.provinces.filter((p) => p.bounds.minX <= rect.maxX && p.bounds.maxX >= rect.minX && p.bounds.minY <= rect.maxLat && p.bounds.maxY >= rect.minLat);
    expect(scanned.length).toBeGreaterThan(10);
    expect(provincesInRect(world, rect.minX, rect.minLat, rect.maxX, rect.maxLat)).toEqual(scanned);
    for (const province of world.provinces.slice(0, 60)) {
      const point = province.centroid;
      expect(provinceAtPoint(world, point)?.id).toBe([...world.provinces].reverse().find((candidate) => provinceContains(candidate, point))?.id);
      expect(provinceAtPoint(world, point, "first")?.id).toBe(world.provinces.find((candidate) => provinceContains(candidate, point))?.id);
    }
    expect(provinceAtPoint(world, [100, 0])).toBeUndefined();
  });

  it("builds a path string only when it is read", () => {
    const province = prepareStaticWorldGeometry(map).provinces[5]!;
    expect(province.svgPath.startsWith("M")).toBe(true);
    expect(province.svgPath).toBe(province.svgPath);
    expect(province.exteriorSvgPath.length).toBeGreaterThan(0);
  });
});

describe("the atlas at four thousand provinces", () => {
  // Wall-clock is not asserted: the pairwise build took 2.6 s here and this one
  // 0.6 s on an idle machine, but a busy one triples either. What is asserted is
  // that the build finishes and finds the right structure at the full size.
  it("prepares 4,410 provinces of about 84 vertices each", () => {
    const built = prepareStaticWorldGeometry(syntheticProvinceMap({ columns: 70, rows: 63 }));
    expect(built.provinces).toHaveLength(4410);
    expect(built.provinces[100]!.neighborIds).toHaveLength(4);
    expect(built.settlements).toHaveLength(4410);
    expect(built.sharedBoundaries.length).toBeLessThan(built.provinces.length * 4);
  }, 60_000);
});
