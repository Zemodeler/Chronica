import "server-only";

import type { GeoJsonMap, Settlement, WorldState } from "@chronica/shared";
import { builtInScenarioMap } from "./built-in-scenario-maps";

/**
 * A canvas province is the geographic source of truth; state only materializes it when play reaches it.
 * `region` is the coarse ancient region or holding polity the province sits in, and
 * `aliases` the other names a person might use for the same ground (former names, its towns).
 */
export type CanvasRegion = Readonly<{ id: string; name: string; region: string; aliases: readonly string[] }>;

function canvasFor(mapAssetId: string | null): GeoJsonMap | undefined {
  return builtInScenarioMap(mapAssetId);
}

function humanise(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

/** Every selectable province comes from the scenario's delivered canvas, with state as a fallback for custom maps. */
export function canvasRegions(mapAssetId: string | null, world: WorldState): readonly CanvasRegion[] {
  const polities = new Map(world.map.polities.map((polity) => [polity.id, polity.name]));
  const stateProvinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  const map = canvasFor(mapAssetId);
  if (map === undefined) {
    return world.map.provinces.map((province) => ({
      id: province.id,
      name: province.name,
      region: (province.controllerPolityId === null ? undefined : polities.get(province.controllerPolityId)) ?? "Unclaimed lands",
      aliases: [...province.formerNames, ...province.settlements.map((settlement) => settlement.name)],
    }));
  }
  const townsByProvince = new Map<string, string[]>();
  for (const feature of map.features) {
    if (feature.properties.kind !== "settlement") continue;
    const towns = townsByProvince.get(feature.properties.provinceId) ?? [];
    towns.push(feature.properties.name);
    townsByProvince.set(feature.properties.provinceId, towns);
  }
  return map.features
    .filter((feature) => feature.properties.kind === "province")
    .map((feature) => {
      const state = stateProvinces.get(feature.id);
      const holder = state?.controllerPolityId == null ? undefined : polities.get(state.controllerPolityId);
      const regionId = feature.properties.kind === "province" ? feature.properties.regionId : undefined;
      return {
        id: feature.id,
        // The world's name wins: the geometry's are modern (`namedByTheWorld`).
        name: state?.name ?? feature.properties.name ?? feature.id,
        region: regionId === undefined ? holder ?? "Unclaimed lands" : humanise(regionId),
        aliases: [...(state?.formerNames ?? []), ...(townsByProvince.get(feature.id) ?? [])],
      };
    });
}

function settlementKind(type: "capital" | "city" | "town" | "village" | "fort" | "port"): Settlement["kind"] {
  if (type === "capital") return "city";
  if (type === "fort") return "fortress";
  return type;
}

/**
 * Adds one valid canvas province to sparse state, along with the map-backed
 * polity and settlement anchors necessary for a character to live there.
 *
 * This is deliberately a no-op for an already materialized province and for
 * unknown IDs. Geometry itself remains in the immutable map asset.
 */
export function materializeCanvasProvince(
  world: WorldState,
  mapAssetId: string | null,
  provinceId: string | null,
): WorldState {
  if (provinceId === null || world.map.provinces.some((province) => province.id === provinceId)) return world;

  const map = canvasFor(mapAssetId);
  const feature = map?.features.find((candidate) => candidate.id === provinceId && candidate.properties.kind === "province");
  if (feature === undefined || feature.properties.kind !== "province") return world;

  // Ground nobody holds yet: a canvas province carries geometry, not politics.
  const settlements = map?.features.flatMap((candidate) => {
    if (candidate.properties.kind !== "settlement" || candidate.properties.provinceId !== provinceId) return [];
    return [{
      id: candidate.id,
      name: candidate.properties.name ?? candidate.id,
      kind: settlementKind(candidate.properties.type),
      provinceId,
      controllerPolityId: null,
      size: 40,
      fortificationLevel: candidate.properties.type === "fort" ? 3 : candidate.properties.type === "capital" ? 5 : 1,
    } satisfies Settlement];
  }) ?? [];

  return {
    ...world,
    map: {
      ...world.map,
      provinces: [
        ...world.map.provinces,
        {
          id: provinceId,
          name: feature.properties.name ?? feature.id,
          formerNames: [],
          terrainId: feature.properties.terrain ?? "hills",
          settlements,
          controllerPolityId: null,
          controlFirmnessBps: 0,
        },
      ],
    },
  };
}
