import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeoJsonMap } from "@chronica/shared";
import { naplesDemoSettlement, romeDemoSettlement, syracuseDemoSettlement } from "./calibration-map-features";

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

/**
 * The source ADM1 feature combines Sicily with Sardinia and minor islands.
 * Split Sicily into its own stable province before the map reaches the client.
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
      return [
        { ...feature, geometry: { type: "MultiPolygon" as const, coordinates: remaining }, properties: { ...feature.properties, name: "Sardegna e isole" } },
        { ...feature, id: `${ITALIAN_ISLANDS_ID}-sicily`, geometry: { type: "MultiPolygon" as const, coordinates: sicily }, properties: { ...feature.properties, name: "Sicilia" } },
      ];
    }),
  };
}

const splitRegionalMap = splitSicily(regionalMap);

export const europeNorthAfricaGeoJson: GeoJsonMap = {
  ...splitRegionalMap,
  features: [...splitRegionalMap.features, romeDemoSettlement, naplesDemoSettlement, syracuseDemoSettlement],
};
