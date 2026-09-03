import type { DynamicMapOverlay, GeoJsonPosition, MapForceOverlay, MapMovementOverlay } from "@chronica/shared";
import { projectCoordinate } from "./geo-projection";
import type { StaticWorldGeometry } from "./world-geometry";

function distance(first: GeoJsonPosition, second: GeoJsonPosition): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

/** Resolves a path position and the already-travelled route without renderer state. */
export function interpolateMovement(movement: MapMovementOverlay): { coordinate: GeoJsonPosition; travelledPath: readonly GeoJsonPosition[] } {
  const segments = movement.path.slice(1).map((end, index) => ({ start: movement.path[index]!, end, length: distance(movement.path[index]!, end) }));
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= Number.EPSILON) return { coordinate: movement.start, travelledPath: [movement.start] };

  let remaining = totalLength * movement.progressBps / 10_000;
  const travelled: GeoJsonPosition[] = [movement.start];
  for (const segment of segments) {
    if (segment.length <= Number.EPSILON) continue;
    if (remaining >= segment.length) {
      travelled.push(segment.end);
      remaining -= segment.length;
      continue;
    }
    const ratio = remaining / segment.length;
    const coordinate: GeoJsonPosition = [
      segment.start[0] + (segment.end[0] - segment.start[0]) * ratio,
      segment.start[1] + (segment.end[1] - segment.start[1]) * ratio,
    ];
    travelled.push(coordinate);
    return { coordinate, travelledPath: travelled };
  }
  return { coordinate: movement.destination, travelledPath: travelled };
}

/**
 * Chooses movement progress, then an explicit coordinate, then province
 * centroid, then (general fallback, works for any scenario) another
 * province held by the force's own polity that does have geometry. If a
 * malformed or legacy overlay has no such province, use the first drawable
 * province rather than silently dropping the army from the map.
 *
 * A gameplay province id with no matching map polygon -- e.g. a scenario
 * that authors finer-grained provinces than the rendered map's partition,
 * or any future scenario/geometry mismatch -- would otherwise leave a force
 * with nowhere to draw and make it silently vanish. Landing on any of the
 * force's own polity's real territory is a better approximation than
 * disappearing, and needs no scenario-specific alias data.
 */
export function resolveForceMapPosition(
  force: MapForceOverlay,
  world: StaticWorldGeometry,
  overlay?: DynamicMapOverlay | null,
): { x: number; y: number; travelledPath: readonly GeoJsonPosition[] | null } | null {
  const movement = force.movement === null ? null : interpolateMovement(force.movement);
  let coordinate = movement?.coordinate ?? force.coordinate ?? world.provinceById.get(force.provinceId)?.centroid;
  if (coordinate === undefined && overlay) {
    const drawableProvince = overlay.provinces.find(
      (province) => province.controllerPolityId === force.ownerPolityId && world.provinceById.has(province.provinceId),
    ) ?? overlay.provinces.find((province) => world.provinceById.has(province.provinceId));
    coordinate = drawableProvince ? world.provinceById.get(drawableProvince.provinceId)?.centroid : undefined;
  }
  if (coordinate === undefined) return null;
  const [x, y] = projectCoordinate(coordinate[0], coordinate[1]);
  return { x, y, travelledPath: movement?.travelledPath ?? null };
}
