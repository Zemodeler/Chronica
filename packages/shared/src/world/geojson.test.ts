import { describe, expect, it } from "vitest";
import { GeoJsonMapSchema } from "./geojson";

const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
const region = { type: "Feature", id: "A", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: "region", name: "A", terrainId: "land", tier: "focus", controllerPolityId: null, controlFirmnessBps: 0, neighbours: [] } };

describe("GeoJSON map contract", () => {
  it("accepts region, city, and army features in one map", () => {
    expect(GeoJsonMapSchema.safeParse({ type: "FeatureCollection", features: [region, { type: "Feature", id: "city-a", geometry: { type: "Point", coordinates: [0.5, 0.5] }, properties: { kind: "city", name: "A city", regionId: "A", controllerPolityId: null } }, { type: "Feature", id: "army-a", geometry: { type: "Point", coordinates: [0.6, 0.5] }, properties: { kind: "army", name: "A army", regionId: "A", controllerPolityId: null, strengthLabel: "100 people" } }] }).success).toBe(true);
  });

  it("accepts immutable settlement anchors and vector river and road layers", () => {
    const result = GeoJsonMapSchema.safeParse({
      type: "FeatureCollection",
      features: [
        region,
        {
          type: "Feature",
          id: "settlement-anchor-a",
          geometry: { type: "Point", coordinates: [0.5, 0.5] },
          properties: {
            kind: "settlement_anchor",
            settlementId: "settlement-a",
            regionId: "A",
            name: "A city",
            settlementKind: "city",
            cultureStyleId: "roman",
            importance: 80,
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

  it("keeps legacy city and army points valid while enforcing new feature geometry", () => {
    expect(GeoJsonMapSchema.safeParse({
      type: "FeatureCollection",
      features: [
        region,
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
        region,
        {
          type: "Feature",
          id: "settlement-missing",
          geometry: { type: "Point", coordinates: [0.5, 0.5] },
          properties: {
            kind: "settlement_anchor",
            settlementId: "settlement-missing",
            regionId: "missing",
            name: "Nowhere",
            settlementKind: "village",
          },
        },
      ],
    }).success).toBe(false);
  });

  it("rejects broken rings, duplicate ids, and markers outside regions", () => {
    expect(GeoJsonMapSchema.safeParse({ type: "FeatureCollection", features: [{ ...region, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [2, 2]]] } }] }).success).toBe(false);
    expect(GeoJsonMapSchema.safeParse({ type: "FeatureCollection", features: [region, { ...region }] }).success).toBe(false);
    expect(GeoJsonMapSchema.safeParse({ type: "FeatureCollection", features: [region, { type: "Feature", id: "city-b", geometry: { type: "Point", coordinates: [0.5, 0.5] }, properties: { kind: "city", name: "B", regionId: "missing", controllerPolityId: null } }] }).success).toBe(false);
  });
});
