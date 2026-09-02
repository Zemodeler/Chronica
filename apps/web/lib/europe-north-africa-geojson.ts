import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeoJsonMap, GeoJsonMapFeature } from "@chronica/shared";
import { agrigentumFortDemoSettlement, caralisDemoSettlement, naplesDemoSettlement, romeDemoSettlement, syracuseDemoSettlement } from "./calibration-map-features";

/**
 * Europe and Northern Africa provincial boundaries from geoBoundaries gbOpen.
 * Germany uses 38 ADM2 government districts; the remaining 49 country layers
 * use ADM1 boundaries. The source file has 901 province features in WGS84.
 * Source metadata: https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/
 * Germany: https://www.geoboundaries.org/api/current/gbOpen/DEU/ADM2/
 */
const mapPath = join(process.cwd(), "public", "maps", "europe-north-africa-adm1.geojson");
const regionalMap = JSON.parse(readFileSync(mapPath, "utf8")) as GeoJsonMap;
const franceDepartmentsPath = join(process.cwd(), "public", "maps", "france-adm2-simplified.geojson");
const franceDepartments = JSON.parse(readFileSync(franceDepartmentsPath, "utf8")) as Readonly<{
  features: readonly Readonly<{ geometry: GeoJsonMapFeature["geometry"]; properties: Readonly<{ shapeID: string; shapeName: string }> }> [];
}>;
const italyRegionsPath = join(process.cwd(), "public", "maps", "italy-adm2-simplified.geojson");
const italyRegions = JSON.parse(readFileSync(italyRegionsPath, "utf8")) as Readonly<{
  features: readonly Readonly<{ geometry: GeoJsonMapFeature["geometry"]; properties: Readonly<{ shapeID: string; shapeName: string }> }> [];
}>;

const ITALIAN_ISLANDS_ID = "ita-72843720b81376294924159";

/**
 * France's ADM1 areas are too broad for the same local-territory scale used
 * in Germania.  Replace only that country layer with the matching simplified
 * 96-area source so its shared borders remain surveyed and exactly aligned.
 */
function replaceFranceWithLocalBoundaries(map: GeoJsonMap): GeoJsonMap {
  let inserted = false;
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (!feature.id.startsWith("fra-")) return [feature];
      if (inserted) return [];
      inserted = true;
      return franceDepartments.features.map((department) => ({
        type: "Feature" as const,
        id: `fra-local-${department.properties.shapeID}`,
        geometry: department.geometry,
        properties: { kind: "province" as const, name: department.properties.shapeName },
      }));
    }),
  };
}

/** Keep the purpose-built Sicily split, while replacing mainland Italy's four broad blocks with its local regional source. */
function replaceItalyWithLocalBoundaries(map: GeoJsonMap): GeoJsonMap {
  const islands = new Set(["Sardegna", "Sicilia"]);
  let inserted = false;
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (!feature.id.startsWith("ita-") || feature.id === ITALIAN_ISLANDS_ID) return [feature];
      if (inserted) return [];
      inserted = true;
      return italyRegions.features
        .filter((region) => !islands.has(region.properties.shapeName))
        .map((region) => ({
          type: "Feature" as const,
          id: `ita-local-${region.properties.shapeID}`,
          geometry: region.geometry,
          properties: { kind: "province" as const, name: region.properties.shapeName },
        }));
    }),
  };
}

function withSettlementProvince(feature: GeoJsonMapFeature, provinceId: string): GeoJsonMapFeature {
  if (feature.properties.kind !== "settlement") throw new Error("Only settlement anchors can be reattached to a new territory.");
  return { ...feature, properties: { kind: "settlement", name: feature.properties.name, provinceId, type: feature.properties.type } };
}

function polygonCenter(polygon: readonly (readonly [number, number][])[]): readonly [number, number] {
  const ring = polygon[0] ?? [];
  const unique = ring.slice(0, -1);
  return unique.reduce<[number, number]>((sum, point) => [sum[0] + point[0] / unique.length, sum[1] + point[1] / unique.length], [0, 0]);
}

function clipRingToHalfPlane(ring: readonly (readonly [number, number])[], valueAt: (point: readonly [number, number]) => number): [number, number][] {
  const result: [number, number][] = [];
  const points = ring.slice(0, -1);
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const currentValue = valueAt(current);
    const nextValue = valueAt(next);
    const currentInside = currentValue <= 0;
    const nextInside = nextValue <= 0;
    const crossing = (): [number, number] => {
      const ratio = currentValue / (currentValue - nextValue);
      return [current[0] + (next[0] - current[0]) * ratio, current[1] + (next[1] - current[1]) * ratio];
    };
    if (currentInside) result.push([current[0], current[1]]);
    if (currentInside !== nextInside && current[0] !== next[0]) result.push(crossing());
  }
  if (result.length < 3) return [];
  result.push([...result[0]!]);
  return result;
}

type SicilySite = Readonly<{ id: string; name: string; coordinate: readonly [number, number] }>;

function sicilianCityRegion(sicily: readonly (readonly (readonly [number, number][])[])[], site: SicilySite, allSites: readonly SicilySite[]) {
  return sicily.flatMap((polygon) => {
    let ring = polygon[0] === undefined ? [] : polygon[0].map((point) => [...point] as [number, number]);
    for (const other of allSites) {
      if (other.id === site.id || ring.length === 0) continue;
      // A Voronoi cell: every point is closer to this historical centre than
      // to another one. It follows Sicily's coast and produces angled, organic
      // city hinterlands rather than five artificial vertical strips.
      const [sx, sy] = site.coordinate;
      const [ox, oy] = other.coordinate;
      ring = clipRingToHalfPlane(ring, ([x, y]) => (x - sx) ** 2 + (y - sy) ** 2 - ((x - ox) ** 2 + (y - oy) ** 2));
    }
    return ring.length === 0 ? [] : [[ring]];
  });
}

/**
 * The source ADM1 feature combines Sicily with Sardinia and minor islands.
 * Split Sicily into five stable provinces before the map reaches the client.
 * This gives Rome, Carthage, and Syracuse independently visible opening
 * territories in the First Punic War rather than painting the whole island as
 * a single modern administrative region.
 * Corse is already a distinct French GeoJSON feature.
 */
function splitSicily(map: GeoJsonMap): GeoJsonMap {
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (feature.id !== ITALIAN_ISLANDS_ID || feature.geometry.type !== "MultiPolygon" || feature.properties.kind !== "province") return [feature];
      const sicily = feature.geometry.coordinates.filter((polygon) => {
        const [longitude, latitude] = polygonCenter(polygon);
        return longitude > 11 && longitude < 16 && latitude < 39.8;
      });
      const remaining = feature.geometry.coordinates.filter((polygon) => !sicily.includes(polygon));
      if (sicily.length === 0 || remaining.length === 0) return [feature];
      const regions: SicilySite[] = [
        { id: "sicily-west", name: "Lilybaeum and western Sicily", coordinate: [12.95, 37.8] },
        { id: "sicily-northwest", name: "Panormus and the north-west", coordinate: [13.36, 38.12] },
        { id: "sicily-central", name: "Agrigentum and the south-west", coordinate: [13.58, 37.31] },
        { id: "sicily-southeast", name: "Syracuse and the south-east", coordinate: [15.29, 37.08] },
        { id: "sicily-northeast", name: "Messana and the strait", coordinate: [15.55, 38.19] },
      ];
      return [
        { ...feature, geometry: { type: "MultiPolygon" as const, coordinates: remaining }, properties: { ...feature.properties, name: "Sardegna e isole" } },
        ...regions.map((region) => ({ ...feature, id: `${ITALIAN_ISLANDS_ID}-${region.id}`, geometry: { type: "MultiPolygon" as const, coordinates: sicilianCityRegion(sicily, region, regions) }, properties: { ...feature.properties, name: region.name } })),
      ];
    }),
  };
}

const splitRegionalMap = splitSicily(replaceItalyWithLocalBoundaries(replaceFranceWithLocalBoundaries(regionalMap)));

export const europeNorthAfricaGeoJson: GeoJsonMap = {
  ...splitRegionalMap,
  features: [
    ...splitRegionalMap.features,
    withSettlementProvince(romeDemoSettlement, "ita-local-23120603B86473916475875"),
    withSettlementProvince(naplesDemoSettlement, "ita-local-23120603B14973764900567"),
    syracuseDemoSettlement,
    agrigentumFortDemoSettlement,
    caralisDemoSettlement,
  ],
};
