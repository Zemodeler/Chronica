import { describe, expect, it } from "vitest";
import { PUNIC_IDS, punicWarsScenario, PUNIC_WARS_MAP_ASSET_ID as PUNIC_WARS_MAP_ASSET_ID_IN_DB } from "@chronica/db";
import { isGeoJsonMapDocument, reconcileCapitals, type GeoJsonMap, type WorldState } from "@chronica/shared";
import { NUMIDIAN_DECISION_MAP_ASSET_ID, PUNIC_WARS_MAP_ASSET_ID, builtInScenarioMap, keptMapDocument, mapVersion, mapWireDocument } from "./built-in-scenario-maps";

describe("built-in scenario maps", () => {
  it("gives the Numidian Decision its own copy of the opening map", () => {
    const first = builtInScenarioMap(NUMIDIAN_DECISION_MAP_ASSET_ID);
    const second = builtInScenarioMap(NUMIDIAN_DECISION_MAP_ASSET_ID);

    expect(first).toBeDefined();
    expect(first).not.toBe(second);
    expect(first?.features.length).toBeGreaterThan(0);
  });

  it("serves the map the database row for the scenario names", () => {
    expect(PUNIC_WARS_MAP_ASSET_ID).toBe(PUNIC_WARS_MAP_ASSET_ID_IN_DB);
  });

  it("gives Punic Wars an independent historical map", () => {
    const first = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID);
    const second = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID);

    expect(first).toBeDefined();
    expect(first).not.toBe(second);
    expect(first?.features.length).toBeGreaterThan(0);
    expect(first?.features.some((feature) => feature.id === PUNIC_IDS.rome)).toBe(true);
  });
});

describe("the map as it is downloaded", { timeout: 60_000 }, () => {
  const opening = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID)!;
  const names = (rename?: { id: string; name: string }) => ({
    map: { provinces: opening.features.filter((feature) => feature.properties.kind === "province").map((feature) => ({ id: feature.id, name: rename?.id === feature.id ? rename.name : `${feature.id} by name` })) },
  }) as unknown as Pick<WorldState, "map">;

  it("is built once per version and served from memory after", () => {
    const first = mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, names())!;
    const second = mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, names())!;
    expect(second.body).toBe(first.body);
    expect(keptMapDocument(first.version)).toBe(first.body);
  });

  it("draws a provisional capital created on surviving countryside and refreshes the map version", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    world.map.provinces = world.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) => city.controllerPolityId === "carthage" ? { ...city, controllerPolityId: "rome" } : city) }));
    const relocated = reconcileCapitals(world);
    const seatId = relocated.map.polities.find((polity) => polity.id === "carthage")!.capitalSettlementId;
    expect(seatId).not.toBeNull();
    expect(mapVersion(PUNIC_WARS_MAP_ASSET_ID, relocated)).not.toBe(mapVersion(PUNIC_WARS_MAP_ASSET_ID, world));
    const document = JSON.parse(mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, relocated)!.body) as GeoJsonMap;
    expect(document.features.find((feature) => feature.id === seatId)).toMatchObject({ properties: { kind: "settlement", type: "town" }, geometry: { type: "Point" } });
    expect(isGeoJsonMapDocument(document)).toBe(true);
  });

  it("changes its version, and only its version, when a province is renamed", () => {
    const before = mapVersion(PUNIC_WARS_MAP_ASSET_ID, names());
    const renamed = mapVersion(PUNIC_WARS_MAP_ASSET_ID, names({ id: PUNIC_IDS.rome, name: "Latium Vetus" }));
    expect(renamed).not.toBe(before);
    expect(mapVersion(PUNIC_WARS_MAP_ASSET_ID, names())).toBe(before);
    expect(mapVersion(null, names())).toBeUndefined();
    const doc = JSON.parse(mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, names({ id: PUNIC_IDS.rome, name: "Latium Vetus" }))!.body) as GeoJsonMap;
    expect(doc.features.find((feature) => feature.id === PUNIC_IDS.rome)?.properties).toMatchObject({ name: "Latium Vetus" });
  });

  it("uses the saved settlement name for existing map markers", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    const city = world.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === "settlement-gaul-aedui-market")!;
    const before = mapVersion(PUNIC_WARS_MAP_ASSET_ID, world);
    city.name = "Saved city name";
    expect(mapVersion(PUNIC_WARS_MAP_ASSET_ID, world)).not.toBe(before);
    const document = JSON.parse(mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, world)!.body) as GeoJsonMap;
    expect(document.features.find((feature) => feature.id === city.id)?.properties.name).toBe(city.name);
  });

  it("is a map the client accepts, on a 1e-4 degree grid, with borders still shared and rings closed", () => {
    const doc = JSON.parse(mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, names())!.body) as GeoJsonMap;
    expect(isGeoJsonMapDocument(doc)).toBe(true);
    expect(doc.features).toHaveLength(opening.features.length);
    const onGrid = (value: number) => Math.abs(value * 1e4 - Math.round(value * 1e4)) < 1e-6;
    const vertices = new Map<string, number>();
    let offGrid = 0; let open = 0; let short = 0;
    for (const feature of doc.features) {
      if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") continue;
      const rings = feature.geometry.type === "Polygon" ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
      for (const ring of rings) {
        if (ring.length < 4) short++;
        if (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1]) open++;
        for (const [x, y] of ring) { if (!onGrid(x) || !onGrid(y)) offGrid++; vertices.set(`${x},${y}`, (vertices.get(`${x},${y}`) ?? 0) + 1); }
      }
    }
    expect({ offGrid, open, short }).toEqual({ offGrid: 0, open: 0, short: 0 });
    expect([...vertices.values()].filter((count) => count > 1).length).toBeGreaterThan(100);
  });

  it("is smaller than the map it came from", () => {
    const wire = mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, names())!.body;
    expect(wire.length).toBeLessThan(JSON.stringify(opening).length);
  });
});

describe("the client's check of a downloaded map", () => {
  it("refuses what is not a feature collection of identified features", () => {
    expect(isGeoJsonMapDocument(null)).toBe(false);
    expect(isGeoJsonMapDocument({ type: "FeatureCollection", features: [] })).toBe(false);
    expect(isGeoJsonMapDocument({ type: "FeatureCollection", features: [{ id: "a" }] })).toBe(false);
    expect(isGeoJsonMapDocument({ type: "FeatureCollection", features: [{ id: "a", properties: { kind: "river" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }] })).toBe(true);
  });
});
