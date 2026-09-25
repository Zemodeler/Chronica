"use client";

import { useMemo, useCallback, useRef, type PointerEvent } from "react";
import type { DynamicMapOverlay, GeoJsonPosition } from "@chronica/shared";
import { provinceContains, type StaticWorldGeometry } from "./world-geometry";
import { resolveMapForcePlacements } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";
import { armyStandardHitBounds, armyStandardWidthForZoom, type ForceFlagAsset } from "./army-standard";
import type { ViewportTransform } from "./map-viewport";

export type { ForceFlagAsset };

type ZoomBand = "far" | "medium" | "close";
type MapEvent = Pick<PointerEvent<HTMLDivElement>, "currentTarget" | "clientX" | "clientY">;
export interface ForceMapDetails { readonly forceId: string; readonly ownerPolityId: string; readonly name: string; readonly commanderLabel: string | null; readonly statusLabel: string; readonly strengthLabel: string; readonly locationLabel: string; readonly destinationLabel: string; readonly progressBps: number | null; readonly movementState: "moving" | "retreating" | null; }

interface GeoMapProps {
  /** Pre-computed world geometry — shared with the canvas terrain layer. */
  readonly world: StaticWorldGeometry;
  /** Map viewBox derived from the GeoJSON map. */
  readonly viewBox: string;
  readonly overlay: DynamicMapOverlay | null;
  readonly zoomBand: ZoomBand;
  /** The viewport's live transform — during a wheel zoom it runs ahead of
   *  the committed React state, and hit tests must match what is drawn. */
  readonly liveTransform: () => ViewportTransform;
  readonly forceFlagUrls: ReadonlyMap<string, ForceFlagAsset>;
  readonly onProvinceHover: (provinceId: string | null, event?: PointerEvent) => void;
  readonly onProvinceClick: (provinceId: string) => void;
  readonly onForceClick: (details: ForceMapDetails) => void;
  readonly onMapPointerDown: () => void;
}

function coordinateLabel([longitude, latitude]: GeoJsonPosition) { return `${latitude.toFixed(1)}°N, ${longitude.toFixed(1)}°E`; }

/**
 * One transparent HTML interaction layer above the canvas. Both province and
 * force hits are resolved in world space against the same geometry the canvas
 * draws: a province by point-in-polygon (a bounds check rules out nearly all
 * of them), a force by its standard's bounds.
 *
 * Provinces used to be picked from a colour-indexed canvas. Redrawing it for
 * every new view cost ~19ms on the first hover after each pan or zoom, and
 * its anti-aliased edges blended two provinces' colours into an index that
 * named a third.
 */
export function GeoMap({ world, viewBox, overlay, zoomBand, liveTransform, forceFlagUrls, onProvinceHover, onProvinceClick, onForceClick, onMapPointerDown }: GeoMapProps) {
  const hoveredProvinceRef = useRef<string | null>(null);
  const forceMarkers = useMemo(() => {
    const placementByForceId = new Map(resolveMapForcePlacements(overlay?.forces ?? [], world, overlay ?? null).map((placement) => [placement.forceId, placement]));
    return (overlay?.forces ?? []).flatMap((force) => {
      const placement = placementByForceId.get(force.forceId);
      // A non-primary member of a deliberate group (docs/19 Phase 3) is
      // drawn and hit-tested as part of its group's single marker only.
      if (!placement || placement.group?.isPrimary === false) return [];
      return [{ ...force, x: placement.x, y: placement.y, travelledPath: placement.travelledPath, group: placement.group }];
    });
  }, [overlay, world]);
  const conflictByForceId = useMemo(() => deriveForceConflictStatuses(overlay), [overlay]);

  /** The pointer in projected world units (x = longitude, y = -latitude), plus the canvas scale `m`. */
  const worldPoint = useCallback((event: MapEvent) => {
    const rect = event.currentTarget.closest<HTMLElement>(".map-frame")?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const { scale, tx, ty } = liveTransform();
    const [vx, vy, vw, vh] = viewBox.split(" ").map(Number) as [number, number, number, number];
    const sf = Math.min(rect.width / vw, rect.height / vh);
    const ox = (rect.width - vw * sf) / 2;
    const oy = (rect.height - vh * sf) / 2;
    const m = sf * scale;
    return { wx: (event.clientX - rect.left - ((ox - vx * sf) * scale + tx)) / m, wy: (event.clientY - rect.top - ((oy - vy * sf) * scale + ty)) / m, m };
  }, [liveTransform, viewBox]);

  const provinceAt = useCallback((event: MapEvent) => {
    const point = worldPoint(event);
    if (!point) return null;
    const geographic: GeoJsonPosition = [point.wx, -point.wy];
    // Last drawn is on top, as it was on the canvas.
    for (let index = world.provinces.length - 1; index >= 0; index--) {
      const province = world.provinces[index]!;
      if (provinceContains(province, geographic)) return province;
    }
    return null;
  }, [worldPoint, world]);

  const forceAt = useCallback((event: MapEvent) => {
    const point = worldPoint(event);
    if (!point) return null;
    const { wx, wy } = point;
    const armyWidth = armyStandardWidthForZoom(point.m);
    for (const force of forceMarkers) {
      const asset = forceFlagUrls.get(force.forceId) ?? { url: "/maps/generic-merchant-ship-standard.png", aspectRatio: 4 / 3 };
      const conflict = conflictByForceId.get(force.forceId);
      const bounds = armyStandardHitBounds(asset, force.x, force.y, conflict !== undefined, armyWidth);
      if (wx >= bounds.x && wx <= bounds.x + bounds.width && wy >= bounds.y && wy <= bounds.y + bounds.height) return force;
    }
    return null;
  }, [conflictByForceId, forceFlagUrls, forceMarkers, worldPoint]);

  const activateForce = useCallback((force: typeof forceMarkers[number]) => {
    const locationLabel = world.provinceById.get(force.provinceId)?.name ?? force.provinceId;
    const destination = force.movement?.destination;
    const destinationLabel = destination === undefined ? "Holding position" : world.provinces.find((province) => provinceContains(province, destination))?.name ?? coordinateLabel(destination);
    const conflict = conflictByForceId.get(force.forceId);
    const details: ForceMapDetails = { forceId: force.forceId, ownerPolityId: force.ownerPolityId, name: force.name, commanderLabel: force.commanderLabel, statusLabel: conflict?.statusLabel ?? "Not in combat", strengthLabel: force.strengthLabel, locationLabel, destinationLabel, progressBps: force.movement?.progressBps ?? null, movementState: force.movement?.state ?? null };
    onForceClick(details);
  }, [conflictByForceId, onForceClick, world]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.closest(".map-frame")?.hasAttribute("data-panning")) {
      hoveredProvinceRef.current = null;
      return;
    }
    const provinceId = provinceAt(event)?.id ?? null;
    if (provinceId === hoveredProvinceRef.current) return;
    hoveredProvinceRef.current = provinceId;
    onProvinceHover(provinceId, event);
  }, [onProvinceHover, provinceAt]);
  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (forceAt(event)) event.stopPropagation(); else onMapPointerDown();
  }, [forceAt, onMapPointerDown]);
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const force = forceAt(event);
    if (force) { event.stopPropagation(); activateForce(force); return; }
    const province = provinceAt(event);
    if (province) onProvinceClick(province.id);
  }, [activateForce, forceAt, onProvinceClick, provinceAt]);

  const handlePointerLeave = useCallback(() => {
    hoveredProvinceRef.current = null;
    onProvinceHover(null);
  }, [onProvinceHover]);

  return <div className="geo-map" data-zoom={zoomBand} onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} onPointerDown={handlePointerDown} onClick={handleClick} aria-label="Map interaction layer" style={{ position: "absolute", inset: 0 }} />;
}
