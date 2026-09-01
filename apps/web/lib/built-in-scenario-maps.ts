import type { GeoJsonMap } from "@chronica/shared";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";
import { punicWarsGeoJson } from "./punic-wars-geojson";

/** Immutable identity for the Numidian Decision's copied opening map asset. */
export const NUMIDIAN_DECISION_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000201";
export const PUNIC_WARS_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000202";

/** Return a fresh map document so hosted scenarios cannot mutate the DEMO map. */
export function builtInScenarioMap(mapAssetId: string | null): GeoJsonMap | undefined {
  if (mapAssetId === NUMIDIAN_DECISION_MAP_ASSET_ID) return structuredClone(europeNorthAfricaGeoJson);
  if (mapAssetId === PUNIC_WARS_MAP_ASSET_ID) return structuredClone(punicWarsGeoJson);
  return undefined;
}
