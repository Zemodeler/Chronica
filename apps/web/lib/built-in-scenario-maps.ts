import type { GeoJsonMap, WorldState } from "@chronica/shared";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";
import { punicWarsGeoJson } from "./punic-wars-geojson";

/** Immutable identity for the Numidian Decision's copied opening map asset. */
export const NUMIDIAN_DECISION_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000201";
export const PUNIC_WARS_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000202";

/**
 * Return a fresh top-level map document so callers can't accidentally share
 * object identity with the shared singleton across requests. Callers only
 * ever read `features`, never mutate it, so a shallow copy — not a deep
 * `structuredClone` of the whole multi-megabyte geometry — is enough, and
 * it avoids re-cloning tens of thousands of coordinate points on every
 * request to this hot path.
 */
export function builtInScenarioMap(mapAssetId: string | null): GeoJsonMap | undefined {
  if (mapAssetId === NUMIDIAN_DECISION_MAP_ASSET_ID) return { ...europeNorthAfricaGeoJson };
  if (mapAssetId === PUNIC_WARS_MAP_ASSET_ID) return { ...punicWarsGeoJson };
  return undefined;
}

/**
 * The map's provinces under the names the world gives them.
 *
 * The geometry came from Natural Earth and carries its admin-1 names, so a
 * consul in 270 BC hovered over "Szabolcs-Szatmár-Bereg" while every order,
 * letter and Chronicle entry called it by its ancient name. The world is where
 * a province's name lives -- a city renamed in play is renamed there -- so the
 * map is labelled from it, and falls back to the geometry's name only for
 * ground the world does not hold.
 */
function namedByTheWorld(map: GeoJsonMap | undefined, world: Pick<WorldState, "map">): GeoJsonMap | undefined {
  if (map === undefined) return undefined;
  const names = new Map(world.map.provinces.map((province) => [province.id, province.name]));
  return {
    ...map,
    features: map.features.map((feature) => {
      if (feature.properties.kind !== "province") return feature;
      const name = names.get(feature.id);
      return name === undefined || name === feature.properties.name ? feature : { ...feature, properties: { ...feature.properties, name } };
    }),
  };
}

/**
 * What names the map wears: the geometry is immutable per asset, so the only
 * thing that can make a copy stale is a province renamed in play. That is the
 * version the client keys its one download of the map by.
 */
export function mapVersion(mapAssetId: string | null, world: Pick<WorldState, "map">): string | undefined {
  if (builtInScenarioMap(mapAssetId) === undefined || mapAssetId === null) return undefined;
  let hash = 0x811c9dc5;
  for (const province of world.map.provinces) {
    const line = `${province.id}\t${province.name}\n`;
    for (let index = 0; index < line.length; index++) hash = Math.imul(hash ^ line.charCodeAt(index), 0x01000193);
  }
  return `${mapAssetId.slice(-4)}-${(hash >>> 0).toString(36)}`;
}

/** A coordinate every 1e-4 degree, about eleven metres: finer than any border is drawn or hit, and a third of the digits. */
const WIRE_STEP = 1e4;
const quantise = (value: number) => Math.round(value * WIRE_STEP) / WIRE_STEP;
type Position = readonly [number, number];
const quantisePosition = ([x, y]: Position): [number, number] => [quantise(x), quantise(y)];

/** Rounding can land two neighbouring vertices on one point; a ring keeps one of them, still closed, and never shrinks below a triangle. */
function quantiseRing(ring: readonly Position[]): [number, number][] {
  const rounded = ring.map(quantisePosition);
  const kept = rounded.filter((point, index) => index === 0 || point[0] !== rounded[index - 1]![0] || point[1] !== rounded[index - 1]![1]);
  return kept.length >= 4 ? kept : rounded;
}

function quantiseGeometry(geometry: GeoJsonMap["features"][number]["geometry"]): GeoJsonMap["features"][number]["geometry"] {
  switch (geometry.type) {
    case "Point": return { type: "Point", coordinates: quantisePosition(geometry.coordinates) };
    case "LineString": return { type: "LineString", coordinates: geometry.coordinates.map(quantisePosition) };
    case "MultiLineString": return { type: "MultiLineString", coordinates: geometry.coordinates.map((line) => line.map(quantisePosition)) };
    case "Polygon": return { type: "Polygon", coordinates: geometry.coordinates.map(quantiseRing) };
    case "MultiPolygon": return { type: "MultiPolygon", coordinates: geometry.coordinates.map((polygon) => polygon.map(quantiseRing)) };
  }
}

/** A map as the text the client downloads. */
export function wireBody(map: GeoJsonMap): string {
  return JSON.stringify({ ...map, features: map.features.map((feature) => ({ ...feature, geometry: quantiseGeometry(feature.geometry) })) });
}

const MAP_DOCUMENTS_KEPT = 4;
const _wireDocuments = new Map<string, string>();

/**
 * The map exactly as the client downloads it: named by the world, coordinates
 * quantised, serialised once per version. Building it walks every coordinate of
 * the map, so it is kept rather than rebuilt for each request.
 */
export function mapWireDocument(mapAssetId: string | null, world: Pick<WorldState, "map">): { readonly version: string; readonly body: string } | undefined {
  const version = mapVersion(mapAssetId, world);
  if (version === undefined) return undefined;
  const kept = _wireDocuments.get(version);
  if (kept !== undefined) return { version, body: kept };
  const body = wireBody(namedByTheWorld(builtInScenarioMap(mapAssetId), world)!);
  _wireDocuments.set(version, body);
  if (_wireDocuments.size > MAP_DOCUMENTS_KEPT) _wireDocuments.delete(_wireDocuments.keys().next().value as string);
  return { version, body };
}

/** Whether a version is one this process has already built, so a request for it needs no world read. */
export function keptMapDocument(version: string): string | undefined {
  return _wireDocuments.get(version);
}
