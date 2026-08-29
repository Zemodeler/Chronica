import { describe, expect, it } from "vitest";
import { GeoJsonMapSchema } from "./geojson";

const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
const province = { type: "Feature", id: "A", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: "province", name: "A" } };

describe("GeoJSON map contract", () => {
  it("accepts province and settlement features in one map", () => {
    expect(GeoJsonMapSchema.safeParse({ type: "FeatureCollection", features: [province, { type: "Feature", id: "settlement-a", geometry: { type: "Point", coordinates: [0.5, 0.5] }, properties: { kind: "settlement", name: "A city", provinceId: "A", type: "city" } }] }).success).toBe(true);
  });

  it("accepts settlements and vector river and road layers", () => {
    const result = GeoJsonMapSchema.safeParse({
      type: "FeatureCollection",
      features: [
        province,
        {
          type: "Feature",
          id: "settlement-a",
          geometry: { type: "Point", coordinates: [0.5, 0.5] },
          properties: {
            kind: "settlement",
            name: "A city",
            provinceId: "A",
            type: "capital",
          },
        },
        {
          type: "Feature",
          id: "river-a",
          geometry: { type: "LineString", coordinates: [[0, 0], [0.5, 0.5], [1, 1]] },
          properties: { kind: "river", name: "A river", class: "major" },
        },
        {
          type: "Feature",
          id: "road-a",
          geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
          properties: { kind: "road", class: "trade_route" },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts optional terrain and regionId on provinces", () => {
    const result = GeoJsonMapSchema.safeParse({
      type: "FeatureCollection",
      features: [
        { ...province, properties: { kind: "province", name: "B", terrain: "hills", regionId: "group-1" } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects geometry mismatches and missing province references", () => {
    expect(GeoJsonMapSchema.safeParse({
      type: "FeatureCollection",
      features: [
        province,
        {
          type: "Feature",
          id: "river-point",
          geometry: { type: "Point", coordinates: [0.5, 0.5] },
          properties: { kind: "river", class: "major" },
        },
      ],
    }).success).toBe(false);
    expect(GeoJsonMapSchema.safeParse({
      type: "FeatureCollection",
      features: [
        province,
        {
          type: "Feature",
          id: "settlement-missing",
          geometry: { type: "Point", coordinates: [0.5, 0.5] },
          properties: {
            kind: "settlement",
            name: "Nowhere",
            provinceId: "missing",
            type: "village",
          },
        },
      ],
    }).success).toBe(false);
  });

  it("rejects broken rings, duplicate ids, and settlements outside provinces", () => {
    expect(GeoJsonMapSchema.safeParse({ type: "FeatureCollection", features: [{ ...province, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [2, 2]]] } }] }).success).toBe(false);
    expect(GeoJsonMapSchema.safeParse({ type: "FeatureCollection", features: [province, { ...province }] }).success).toBe(false);
    expect(GeoJsonMapSchema.safeParse({ type: "FeatureCollection", features: [province, { type: "Feature", id: "settlement-b", geometry: { type: "Point", coordinates: [0.5, 0.5] }, properties: { kind: "settlement", name: "B", provinceId: "missing", type: "town" } }] }).success).toBe(false);
  });
});
