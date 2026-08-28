import { createHash } from "node:crypto";
import { GeoJsonMapSchema, type GeoJsonMap } from "@chronica/shared";

const MAX_GEOJSON_BYTES = 20 * 1024 * 1024;

export type GeoJsonUpload = Readonly<{
  filename: string;
  mimeType: string;
  body: string;
  rightsConfirmed: boolean;
}>;

export type ValidatedGeoJsonUpload = Readonly<{
  map: GeoJsonMap;
  byteSize: number;
  checksum: string;
  featureCount: number;
  boundingBox: readonly [number, number, number, number];
}>;

function bounds(map: GeoJsonMap): readonly [number, number, number, number] {
  const positions = map.features.flatMap((feature): readonly (readonly [number, number])[] => {
    const geometry = feature.geometry;
    if (geometry.type === "Point") return [geometry.coordinates];
    if (geometry.type === "LineString") return geometry.coordinates;
    if (geometry.type === "MultiLineString") return geometry.coordinates.flat();
    if (geometry.type === "Polygon") return geometry.coordinates.flat();
    return geometry.coordinates.flat(2);
  });
  const xs = positions.map(([x]) => x);
  const ys = positions.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Boundary used by the future authoring form before any object-storage write. */
export function validateGeoJsonUpload(upload: GeoJsonUpload): ValidatedGeoJsonUpload {
  if (!upload.filename.toLowerCase().endsWith(".geojson")) throw new Error("Map uploads must use the .geojson extension.");
  if (upload.mimeType !== "application/geo+json") throw new Error("Map uploads must use application/geo+json.");
  if (!upload.rightsConfirmed) throw new Error("Confirm that you have the right to use this map.");
  const byteSize = Buffer.byteLength(upload.body, "utf8");
  if (byteSize > MAX_GEOJSON_BYTES) throw new Error("GeoJSON map uploads must be 20 MiB or smaller.");
  let candidate: unknown;
  try { candidate = JSON.parse(upload.body) as unknown; } catch { throw new Error("Map upload is not valid JSON."); }
  const parsed = GeoJsonMapSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("Map upload is not a valid Chronica GeoJSON map.");
  return { map: parsed.data, byteSize, checksum: createHash("sha256").update(upload.body, "utf8").digest("hex"), featureCount: parsed.data.features.length, boundingBox: bounds(parsed.data) };
}
