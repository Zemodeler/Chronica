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
export function namedByTheWorld(map: GeoJsonMap | undefined, world: Pick<WorldState, "map">): GeoJsonMap | undefined {
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
