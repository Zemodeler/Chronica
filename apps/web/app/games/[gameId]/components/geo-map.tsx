"use client";

import { useMemo, useCallback, useRef, type PointerEvent } from "react";
import type { DynamicMapOverlay, GeoJsonPosition } from "@chronica/shared";
import { provinceContains, type StaticWorldGeometry } from "./world-geometry";
import { resolveMapForcePlacements } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";
import { armyStandardHitBounds, armyStandardWidthForZoom, type ForceFlagAsset } from "./army-standard";
import { drawPickCanvas, pickProvinceAt } from "./map-canvas-terrain";

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
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
  readonly forceFlagUrls: ReadonlyMap<string, ForceFlagAsset>;
  readonly onProvinceHover: (provinceId: string | null, event?: PointerEvent) => void;
  readonly onProvinceClick: (provinceId: string) => void;
  readonly onForceClick: (details: ForceMapDetails) => void;
  readonly onMapPointerDown: () => void;
}

function coordinateLabel([longitude, latitude]: GeoJsonPosition) { return `${latitude.toFixed(1)}°N, ${longitude.toFixed(1)}°E`; }

/**
 * One transparent HTML interaction layer above the canvas. Province picking
 * uses a cached, colour-indexed canvas, avoiding an SVG path per province;
 * force hits use the same world-space geometry as the canvas standards.
 */
export function GeoMap({ world, viewBox, overlay, zoomBand, scale, tx, ty, forceFlagUrls, onProvinceHover, onProvinceClick, onForceClick, onMapPointerDown }: GeoMapProps) {
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

  const mapCoordinates = useCallback((event: MapEvent) => {
    const frame = event.currentTarget.closest<HTMLElement>(".map-frame");
    const rect = frame?.getBoundingClientRect();
    if (!rect) return null;
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
  }, []);

  const provinceAt = useCallback((event: MapEvent) => {
    const point = mapCoordinates(event);
    if (!point || point.width === 0 || point.height === 0) return null;
    const pickCanvas = drawPickCanvas(Math.round(point.width), Math.round(point.height), { scale, tx, ty }, viewBox, world);
    const index = pickProvinceAt(pickCanvas, point.x, point.y);
    return index === 0 ? null : world.provinces[index - 1] ?? null;
  }, [mapCoordinates, scale, tx, ty, viewBox, world]);

  const forceAt = useCallback((event: MapEvent) => {
    const point = mapCoordinates(event);
    if (!point || point.width === 0 || point.height === 0) return null;
    const [vx, vy, vw, vh] = viewBox.split(" ").map(Number) as [number, number, number, number];
    const sf = Math.min(point.width / vw, point.height / vh);
    const ox = (point.width - vw * sf) / 2;
    const oy = (point.height - vh * sf) / 2;
    const m = sf * scale;
    const wx = (point.x - ((ox - vx * sf) * scale + tx)) / m;
    const wy = (point.y - ((oy - vy * sf) * scale + ty)) / m;
    const armyWidth = armyStandardWidthForZoom(m);
    for (const force of forceMarkers) {
      const asset = forceFlagUrls.get(force.forceId) ?? { url: "/maps/generic-merchant-ship-standard.png", aspectRatio: 4 / 3 };
      const conflict = conflictByForceId.get(force.forceId);
      const bounds = armyStandardHitBounds(asset, force.x, force.y, conflict !== undefined, armyWidth);
      if (wx >= bounds.x && wx <= bounds.x + bounds.width && wy >= bounds.y && wy <= bounds.y + bounds.height) return force;
    }
    return null;
  }, [conflictByForceId, forceFlagUrls, forceMarkers, mapCoordinates, scale, tx, ty, viewBox]);

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
