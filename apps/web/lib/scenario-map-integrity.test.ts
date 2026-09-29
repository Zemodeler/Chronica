import { assertWorldMapGeometryComplete, findWorldMapGeometryGaps, type GeoJsonMap } from "@chronica/shared";
import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";
import { PUNIC_WARS_MAP_ASSET_ID, builtInScenarioMap } from "./built-in-scenario-maps";

const punicWarsGeoJson: GeoJsonMap = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID)!;
type Ring = readonly (readonly [number, number])[];

const ringHolds = (ring: Ring, x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Kilometres from a point to the nearest edge of any ring, on the local flat. */
function kmToRings(rings: readonly Ring[], x: number, y: number): number {
  const kx = Math.cos((y * Math.PI) / 180) * 111.2;
  const ky = 111.2;
  let nearest = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = [ring[i - 1]![0] * kx, ring[i - 1]![1] * ky];
      const [dx, dy] = [ring[i]![0] * kx - ax, ring[i]![1] * ky - ay];
      const along = Math.max(0, Math.min(1, ((x * kx - ax) * dx + (y * ky - ay) * dy) / (dx * dx + dy * dy || 1)));
      nearest = Math.min(nearest, Math.hypot(x * kx - (ax + along * dx), y * ky - (ay + along * dy)));
    }
  }
  return nearest;
}

describe("scenario map integrity", () => {
  it("gives every simulated built-in province and force location a polygon", () => {
    expect(findWorldMapGeometryGaps(firstPunicWarScenario.initialWorld, europeNorthAfricaGeoJson)).toEqual([]);
    expect(findWorldMapGeometryGaps(punicWarsScenario.initialWorld, punicWarsGeoJson)).toEqual([]);
    expect(() => assertWorldMapGeometryComplete(firstPunicWarScenario.initialWorld, europeNorthAfricaGeoJson)).not.toThrow();
    expect(() => assertWorldMapGeometryComplete(punicWarsScenario.initialWorld, punicWarsGeoJson)).not.toThrow();
  });

  it("identifies every missing location instead of allowing a silent rendering failure", () => {
    const world = { ...punicWarsScenario.initialWorld, map: { ...punicWarsScenario.initialWorld.map, provinces: [{ ...punicWarsScenario.initialWorld.map.provinces[0]!, id: "not-on-the-map" }] } };
    expect(findWorldMapGeometryGaps(world, punicWarsGeoJson)).toEqual(["not-on-the-map"]);
    expect(() => assertWorldMapGeometryComplete(world, punicWarsGeoJson)).toThrow("not-on-the-map");
  });

  it("draws exactly the provinces the world holds, each once", () => {
    const drawn = punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "province").map((feature) => feature.id);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn.sort()).toEqual(punicWarsScenario.initialWorld.map.provinces.map((province) => province.id).sort());
    expect(punicWarsScenario.definition.map.provinceCount).toEqual({ min: drawn.length, max: drawn.length });
  });

  it("does not render a siegeable settlement that is absent from its playable world, or hold one the map does not draw", () => {
    const renderedSettlementIds = punicWarsGeoJson.features
      .filter((feature) => feature.properties.kind === "settlement")
      .map((feature) => feature.id)
      .sort();
    const worldSettlementIds = punicWarsScenario.initialWorld.map.provinces
      .flatMap((province) => province.settlements.map((settlement) => settlement.id))
      .sort();

    expect(worldSettlementIds).toEqual(renderedSettlementIds);
  });

  it("draws every settlement in the province the world puts it in, or on its shore", () => {
    const polygons = new Map(punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "province").map((feature) => [
      feature.id,
      feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [],
    ]));
    const worldProvinceOf = new Map(punicWarsScenario.initialWorld.map.provinces.flatMap((province) => province.settlements.map((settlement) => [settlement.id, province.id] as const)));
    const misplaced = punicWarsGeoJson.features.filter((feature) => {
      if (feature.properties.kind !== "settlement" || feature.geometry.type !== "Point") return false;
      const [x, y] = feature.geometry.coordinates;
      const parts = polygons.get(feature.properties.provinceId) ?? [];
      const inProvince = parts.some((polygon) => polygon.reduce((inside, ring) => (ringHolds(ring, x, y) ? !inside : inside), false));
      // A port's pin can sit a little off the smoothed coast of its province; a town is never a province away.
      const onItsShore = inProvince || kmToRings(parts.flat(), x, y) <= 12;
      return !onItsShore || worldProvinceOf.get(feature.id) !== feature.properties.provinceId;
    });
    expect(misplaced.map((feature) => feature.id)).toEqual([]);
  });
});
