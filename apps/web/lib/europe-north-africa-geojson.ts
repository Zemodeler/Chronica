import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeoJsonMap } from "@chronica/shared";
import { romeCalibrationSettlement } from "./calibration-map-features";

/**
 * Europe and Northern Africa ADM1 boundaries from geoBoundaries gbOpen.
 * 50 national layers, 913 Chronica province features, WGS84 longitude/latitude.
 * Source metadata: https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/
 */
const mapPath = join(process.cwd(), "public", "maps", "europe-north-africa-adm1.geojson");
const regionalMap = JSON.parse(readFileSync(mapPath, "utf8")) as GeoJsonMap;

export const europeNorthAfricaGeoJson: GeoJsonMap = {
  ...regionalMap,
  features: [...regionalMap.features, romeCalibrationSettlement],
};
