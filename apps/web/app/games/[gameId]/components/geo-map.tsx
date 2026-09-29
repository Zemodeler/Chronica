"use client";

import { useMemo, useCallback, useRef, type PointerEvent } from "react";
import type { DynamicMapOverlay, GeoJsonPosition } from "@chronica/shared";
import { provinceAtPoint, type StaticWorldGeometry } from "./world-geometry";
import { resolveMapForcePlacements } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";
import { ARMY_STANDARD_HIT_SLOP_PIXELS, FALLBACK_FORCE_FLAG, FORCES_VISIBLE_FROM_SCALE, armyStandardHitBounds, armyStandardWidthForZoom, fannedStandardCentre, type ForceFlagAsset } from "./army-standard";
import type { ViewportTransform } from "./map-viewport";
import { displayUnit } from "./map-display-unit";

export type { ForceFlagAsset };

type ZoomBand = "far" | "medium" | "close";
type MapEvent = Pick<PointerEvent<HTMLDivElement>, "currentTarget" | "clientX" | "clientY">;
export interface ForceMapDetails { readonly forceId: string; readonly ownerPolityId: string; readonly name: string; readonly commanderLabel: string | null; readonly statusLabel: string; readonly strengthLabel: string; readonly locationLabel: string; readonly destinationLabel: string; readonly progressBps: number | null; readonly movementState: "moving" | "retreating" | null; readonly commandable: boolean; }

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
  /** The army under the pointer, by name, so its flag reads as something to click and not part of the province. */
  readonly onForceHover: (name: string | null, event?: PointerEvent) => void;
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
export function GeoMap({ world, viewBox, overlay, zoomBand, liveTransform, forceFlagUrls, onProvinceHover, onForceHover, onProvinceClick, onForceClick, onMapPointerDown }: GeoMapProps) {
  const hoveredProvinceRef = useRef<string | null>(null);
  const hoveredForceRef = useRef<string | null>(null);
  // In the order the canvas draws them (map-canvas-entities.ts), so the last
  // one here is the one painted on top.
  const forceMarkers = useMemo(() => {
    const forceById = new Map((overlay?.forces ?? []).map((force) => [force.forceId, force]));
    return resolveMapForcePlacements(overlay?.forces ?? [], world, overlay ?? null).flatMap((placement) => {
      const force = forceById.get(placement.forceId);
      // A non-primary member of a deliberate group (docs/19 Phase 3) is
      // drawn and hit-tested as part of its group's single marker only.
      if (!force || placement.group?.isPrimary === false) return [];
      return [{ ...force, placement }];
    });
  }, [overlay, world]);
  const conflictByForceId = useMemo(() => deriveForceConflictStatuses(overlay), [overlay]);

  /** The pointer in projected world units (x = longitude, y = -latitude), plus the canvas scale `m` and the display unit the canvas drew with. */
  const worldPoint = useCallback((event: MapEvent) => {
    const rect = event.currentTarget.closest<HTMLElement>(".map-frame")?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const { scale, tx, ty } = liveTransform();
    const [vx, vy, vw, vh] = viewBox.split(" ").map(Number) as [number, number, number, number];
    const sf = Math.min(rect.width / vw, rect.height / vh);
    const ox = (rect.width - vw * sf) / 2;
    const oy = (rect.height - vh * sf) / 2;
    const m = sf * scale;
    return { wx: (event.clientX - rect.left - ((ox - vx * sf) * scale + tx)) / m, wy: (event.clientY - rect.top - ((oy - vy * sf) * scale + ty)) / m, m, scale, unit: displayUnit(rect.width, rect.height) };
  }, [liveTransform, viewBox]);

  const provinceAt = useCallback((event: MapEvent) => {
    const point = worldPoint(event);
    if (!point) return null;
    const geographic: GeoJsonPosition = [point.wx, -point.wy];
    // Last drawn is on top, as it was on the canvas.
    return provinceAtPoint(world, geographic) ?? null;
  }, [worldPoint, world]);

  /**
   * The army whose standard is drawn under the pointer, topmost first.
   *
   * Only where one is drawn: below the zoom the canvas paints forces at, the
   * map opened on invisible click targets, and a click on Latium or Sicily
   * opened an army nobody had seen.
   */
  const forceAt = useCallback((event: MapEvent) => {
    const point = worldPoint(event);
    if (!point || point.scale < FORCES_VISIBLE_FROM_SCALE) return null;
    const { wx, wy } = point;
    const armyWidth = armyStandardWidthForZoom(point.m, point.unit);
    const slop = ARMY_STANDARD_HIT_SLOP_PIXELS * point.unit / point.m;
    for (let index = forceMarkers.length - 1; index >= 0; index--) {
      const force = forceMarkers[index]!;
      const asset = forceFlagUrls.get(force.forceId) ?? FALLBACK_FORCE_FLAG;
      const conflict = conflictByForceId.get(force.forceId);
      const centre = fannedStandardCentre(force.placement, armyWidth);
      const bounds = armyStandardHitBounds(asset, centre.x, centre.y, conflict !== undefined, armyWidth);
      if (wx >= bounds.x - slop && wx <= bounds.x + bounds.width + slop && wy >= bounds.y - slop && wy <= bounds.y + bounds.height + slop) return force;
    }
    return null;
  }, [conflictByForceId, forceFlagUrls, forceMarkers, worldPoint]);

  const activateForce = useCallback((force: typeof forceMarkers[number]) => {
    const locationLabel = world.provinceById.get(force.provinceId)?.name ?? force.provinceId;
    const destination = force.movement?.destination;
    const destinationLabel = destination === undefined ? "Holding position" : provinceAtPoint(world, destination, "first")?.name ?? coordinateLabel(destination);
    const conflict = conflictByForceId.get(force.forceId);
    const details: ForceMapDetails = { forceId: force.forceId, ownerPolityId: force.ownerPolityId, name: force.name, commanderLabel: force.commanderLabel, statusLabel: conflict?.statusLabel ?? "Not in combat", strengthLabel: force.strengthLabel, locationLabel, destinationLabel, progressBps: force.movement?.progressBps ?? null, movementState: force.movement?.state ?? null, commandable: force.commandable === true };
    onForceClick(details);
  }, [conflictByForceId, onForceClick, world]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.closest(".map-frame")?.hasAttribute("data-panning")) {
      hoveredProvinceRef.current = null;
      hoveredForceRef.current = null;
      event.currentTarget.removeAttribute("data-over-force");
      return;
    }
    // A flag is its own thing, not a part of the province it stands in: the
    // province under it does not light up, and the pointer says it can be
    // clicked.
    const force = forceAt(event);
    if (force) {
      event.currentTarget.setAttribute("data-over-force", "");
      if (hoveredProvinceRef.current !== null) { hoveredProvinceRef.current = null; onProvinceHover(null); }
      if (hoveredForceRef.current !== force.forceId) { hoveredForceRef.current = force.forceId; onForceHover(force.name, event); }
      return;
    }
    if (hoveredForceRef.current !== null) {
      hoveredForceRef.current = null;
      event.currentTarget.removeAttribute("data-over-force");
      onForceHover(null);
    }
    const provinceId = provinceAt(event)?.id ?? null;
    if (provinceId === hoveredProvinceRef.current) return;
    hoveredProvinceRef.current = provinceId;
    onProvinceHover(provinceId, event);
  }, [forceAt, onForceHover, onProvinceHover, provinceAt]);
  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (forceAt(event)) event.stopPropagation(); else onMapPointerDown();
  }, [forceAt, onMapPointerDown]);
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const force = forceAt(event);
    if (force) { event.stopPropagation(); activateForce(force); return; }
    const province = provinceAt(event);
    if (province) onProvinceClick(province.id);
  }, [activateForce, forceAt, onProvinceClick, provinceAt]);

  const handlePointerLeave = useCallback((event: PointerEvent<HTMLDivElement>) => {
    hoveredProvinceRef.current = null;
    if (hoveredForceRef.current !== null) {
      hoveredForceRef.current = null;
      event.currentTarget.removeAttribute("data-over-force");
      onForceHover(null);
    }
    onProvinceHover(null);
  }, [onForceHover, onProvinceHover]);

  return <div className="geo-map" data-zoom={zoomBand} onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} onPointerDown={handlePointerDown} onClick={handleClick} aria-label="Map interaction layer" style={{ position: "absolute", inset: 0 }} />;
}
