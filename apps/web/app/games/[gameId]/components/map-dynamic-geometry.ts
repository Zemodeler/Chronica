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

// Position/grouping for co-located forces (docs/19 Phase 3).
//
// Two forces sharing a province do not automatically fight (docs/19); the
// map must not visually imply they do just because their markers land on
// the same pixel. A deliberate group -- both sides of a battle, or several
// forces jointly besieging the same settlement -- is the opposite case:
// they belong at the same place, drawn as one marker with a count, not
// spread apart as if unrelated.

export interface ForceMarkerPlacement {
  readonly forceId: string;
  readonly x: number;
  readonly y: number;
  readonly travelledPath: readonly GeoJsonPosition[] | null;
  /** Present only for a deliberate group (a battle, or a joint siege) of more than one force sharing this exact placement. */
  readonly group: { readonly key: string; readonly size: number; readonly isPrimary: boolean } | null;
  /**
   * This force's place in a row of unrelated forces that landed on the same
   * point, or null when it stands alone. The row is laid out by whoever knows
   * how wide a standard is drawn at this zoom (`fannedStandardCentre`).
   */
  readonly fan: { readonly index: number; readonly count: number } | null;
}

/** Null when the force is not part of any deliberate, already-combined engagement. */
function deliberateGroupKey(forceId: string, overlay: DynamicMapOverlay | null): string | null {
  for (const battle of overlay?.conflicts.battles ?? []) {
    if (battle.participantForceIds.includes(forceId)) return `battle:${battle.battleId}`;
  }
  for (const siege of overlay?.conflicts.sieges ?? []) {
    if (siege.invadingForceIds.length > 1 && siege.invadingForceIds.includes(forceId)) return `siege-attackers:${siege.settlementId}`;
  }
  return null;
}

/**
 * Resolve every force's marker placement at once: deliberate groups (a
 * battle's two sides, a joint siege's attackers) collapse to one shared
 * placement per group; any other forces that merely happen to land on the
 * same point are put in a row (ordered by forceId, so the same set of
 * co-located forces always fans out the same way, stable across reload and
 * replay) so their flags never overlap.

 * The row used to be a circle 0.015 degrees across, in a world where a
 * standard is drawn about 0.18 degrees wide: two armies sharing a province
 * covered each other almost exactly, and a click on the one on top opened the
 * one beneath. The spacing is now in standard widths, which only the drawing
 * code knows.
 */
export function resolveMapForcePlacements(
  forces: readonly MapForceOverlay[],
  world: StaticWorldGeometry,
  overlay: DynamicMapOverlay | null,
): ForceMarkerPlacement[] {
  const resolved = forces
    .map((force) => ({ force, position: resolveForceMapPosition(force, world, overlay) }))
    .filter((entry): entry is { force: MapForceOverlay; position: NonNullable<ReturnType<typeof resolveForceMapPosition>> } => entry.position !== null);

  const groupSizeByKey = new Map<string, number>();
  for (const entry of resolved) {
    const key = deliberateGroupKey(entry.force.forceId, overlay);
    if (key) groupSizeByKey.set(key, (groupSizeByKey.get(key) ?? 0) + 1);
  }

  const roundedCoordinateKey = (x: number, y: number) => `${x.toFixed(3)}:${y.toFixed(3)}`;
  const incidentalBuckets = new Map<string, typeof resolved>();
  for (const entry of resolved) {
    if (deliberateGroupKey(entry.force.forceId, overlay)) continue;
    const key = roundedCoordinateKey(entry.position.x, entry.position.y);
    const bucket = incidentalBuckets.get(key) ?? [];
    bucket.push(entry);
    incidentalBuckets.set(key, bucket);
  }
  const fanByForceId = new Map<string, { index: number; count: number }>();
  for (const bucket of incidentalBuckets.values()) {
    if (bucket.length < 2) continue;
    const ordered = [...bucket].sort((a, b) => a.force.forceId.localeCompare(b.force.forceId));
    ordered.forEach((entry, index) => fanByForceId.set(entry.force.forceId, { index, count: ordered.length }));
  }

  const seenGroupKey = new Set<string>();
  return resolved.map(({ force, position }) => {
    const key = deliberateGroupKey(force.forceId, overlay);
    const { x, y } = position;
    if (!key) return { forceId: force.forceId, x, y, travelledPath: position.travelledPath, group: null, fan: fanByForceId.get(force.forceId) ?? null };
    const size = groupSizeByKey.get(key) ?? 1;
    const isPrimary = !seenGroupKey.has(key);
    seenGroupKey.add(key);
    return { forceId: force.forceId, x, y, travelledPath: position.travelledPath, group: size > 1 ? { key, size, isPrimary } : null, fan: null };
  });
}
