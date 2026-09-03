import type { GeoJsonMap } from "./geojson";
import type { WorldState } from "./world-state";

/**
 * Reports the simulation locations that cannot be represented on a map.
 *
 * Geometry deliberately remains outside WorldState, but a playable scenario
 * must still give every simulated province a polygon. Without that contract a
 * perfectly valid force move can leave an army with no drawable position.
 */
export function findWorldMapGeometryGaps(
  world: Pick<WorldState, "map" | "material">,
  map: GeoJsonMap,
): readonly string[] {
  const geometryProvinceIds = new Set(
    map.features
      .filter((feature) => feature.properties.kind === "province")
      .map((feature) => feature.id),
  );
  const requiredProvinceIds = new Set([
    ...world.map.provinces.map((province) => province.id),
    ...world.material.forces.map((force) => force.locationId),
  ]);

  return [...requiredProvinceIds]
    .filter((provinceId) => !geometryProvinceIds.has(provinceId))
    .sort();
}

/** Fail scenario publication/CI with the exact locations that would be invisible. */
export function assertWorldMapGeometryComplete(
  world: Pick<WorldState, "map" | "material">,
  map: GeoJsonMap,
): void {
  const missingProvinceIds = findWorldMapGeometryGaps(world, map);
  if (missingProvinceIds.length > 0) {
    throw new Error(
      `Scenario map is missing geometry for simulated province IDs: ${missingProvinceIds.join(", ")}.`,
    );
  }
}
