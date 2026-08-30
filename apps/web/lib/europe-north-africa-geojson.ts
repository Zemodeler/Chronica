import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeoJsonMap } from "@chronica/shared";
import { agrigentumFortDemoSettlement, naplesDemoSettlement, romeDemoSettlement, syracuseDemoSettlement } from "./calibration-map-features";

/**
 * Europe and Northern Africa ADM1 boundaries from geoBoundaries gbOpen.
 * 50 national layers, 913 Chronica province features, WGS84 longitude/latitude.
 * Source metadata: https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/
 */
const mapPath = join(process.cwd(), "public", "maps", "europe-north-africa-adm1.geojson");
const regionalMap = JSON.parse(readFileSync(mapPath, "utf8")) as GeoJsonMap;

const ITALIAN_ISLANDS_ID = "ita-72843720b81376294924159";

function polygonCenter(polygon: readonly (readonly [number, number][])[]): readonly [number, number] {
  const ring = polygon[0] ?? [];
  const unique = ring.slice(0, -1);
  return unique.reduce<[number, number]>((sum, point) => [sum[0] + point[0] / unique.length, sum[1] + point[1] / unique.length], [0, 0]);
}

function clipRingAtLongitude(ring: readonly (readonly [number, number])[], longitude: number, keepWest: boolean): [number, number][] {
  const result: [number, number][] = [];
  const points = ring.slice(0, -1);
  const inside = (point: readonly [number, number]) => keepWest ? point[0] <= longitude : point[0] >= longitude;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const currentInside = inside(current);
    const nextInside = inside(next);
    const crossing = (): [number, number] => [longitude, current[1] + (next[1] - current[1]) * (longitude - current[0]) / (next[0] - current[0])];
    if (currentInside) result.push([current[0], current[1]]);
    if (currentInside !== nextInside && current[0] !== next[0]) result.push(crossing());
  }
  if (result.length < 3) return [];
  result.push([...result[0]!]);
  return result;
}

function splitSicilyAtLongitude(sicily: readonly (readonly (readonly [number, number][])[])[], longitude: number, keepWest: boolean) {
  return sicily.flatMap((polygon) => {
    const ring = polygon[0] === undefined ? [] : clipRingAtLongitude(polygon[0], longitude, keepWest);
    return ring.length === 0 ? [] : [[ring]];
  });
}

/**
 * The source ADM1 feature combines Sicily with Sardinia and minor islands.
 * Split Sicily into western and eastern stable provinces before the map reaches
 * the client. This provides a real shared boundary for the First Punic War.
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
      const SICILY_DIVISION_LONGITUDE = 14.3;
      const westernSicily = splitSicilyAtLongitude(sicily, SICILY_DIVISION_LONGITUDE, true);
      const easternSicily = splitSicilyAtLongitude(sicily, SICILY_DIVISION_LONGITUDE, false);
      return [
        { ...feature, geometry: { type: "MultiPolygon" as const, coordinates: remaining }, properties: { ...feature.properties, name: "Sardegna e isole" } },
        { ...feature, id: `${ITALIAN_ISLANDS_ID}-sicily-west`, geometry: { type: "MultiPolygon" as const, coordinates: westernSicily }, properties: { ...feature.properties, name: "Sicilia occidentale" } },
        { ...feature, id: `${ITALIAN_ISLANDS_ID}-sicily-east`, geometry: { type: "MultiPolygon" as const, coordinates: easternSicily }, properties: { ...feature.properties, name: "Sicilia orientale" } },
      ];
    }),
  };
}

const splitRegionalMap = splitSicily(regionalMap);

export const europeNorthAfricaGeoJson: GeoJsonMap = {
  ...splitRegionalMap,
  features: [...splitRegionalMap.features, romeDemoSettlement, naplesDemoSettlement, syracuseDemoSettlement, agrigentumFortDemoSettlement],
};
