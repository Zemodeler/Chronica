"use client";

import { useMemo, useCallback, useState, useRef, useEffect, type KeyboardEvent, type PointerEvent } from "react";
import type { DynamicMapOverlay, GeoJsonPosition } from "@chronica/shared";
import type { PoliticalMapState } from "./political-geometry";
import { provinceContains, type StaticWorldGeometry } from "./world-geometry";
import { resolveForceMapPosition } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";
import { armyStandardHitBounds, armyStandardWidthForZoom, ARMY_STANDARD_WIDTH, type ForceFlagAsset } from "./army-standard";

export type { ForceFlagAsset };

type ZoomBand = "far" | "medium" | "close";
export interface ForceMapDetails { readonly forceId: string; readonly ownerPolityId: string; readonly name: string; readonly commanderLabel: string | null; readonly statusLabel: string; readonly strengthLabel: string; readonly locationLabel: string; readonly destinationLabel: string; readonly progressBps: number | null; readonly movementState: "moving" | "retreating" | null; }

interface GeoMapProps {
  /** Pre-computed world geometry — shared with the canvas terrain layer. */
  readonly world: StaticWorldGeometry;
  /** Pre-computed political map state — shared with the canvas terrain layer. */
  readonly political: PoliticalMapState;
  /** SVG viewBox string derived from the GeoJSON map. */
  readonly viewBox: string;
  readonly overlay: DynamicMapOverlay | null;
  readonly selectedProvinceId: string | null;
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

interface VisibleRect { minX: number; maxX: number; minY: number; maxY: number; }

function coordinateLabel([longitude, latitude]: GeoJsonPosition) { return `${latitude.toFixed(1)}°N, ${longitude.toFixed(1)}°E`; }

function computeVisibleRect(
  viewBox: string,
  containerW: number,
  containerH: number,
  tx: number,
  ty: number,
  scale: number,
): VisibleRect {
  const parts = viewBox.split(" ").map(Number);
  const [vx, vy, vw, vh] = [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
  const svgFactor = Math.min(containerW / vw, containerH / vh);
  const ox = (containerW - vw * svgFactor) / 2;
  const oy = (containerH - vh * svgFactor) / 2;
  const PAD = 5;
  const toX = (sx: number) => vx + ((sx - tx) / scale - ox) / svgFactor;
  const toY = (sy: number) => vy + ((sy - ty) / scale - oy) / svgFactor;
  return { minX: toX(0) - PAD, maxX: toX(containerW) + PAD, minY: toY(0) - PAD, maxY: toY(containerH) + PAD };
}

// The flag image and its conflict frame are painted on the terrain canvas
// (see map-canvas-entities.ts's drawForces) — this stays an invisible hit
// target only, positioned with the exact same bounds math so it lines up
// with what's drawn underneath.
function ArmyStandardHitTarget({ asset, x, y, width, conflictClass, onActivate }: { readonly asset: ForceFlagAsset; readonly x: number; readonly y: number; readonly width: number; readonly conflictClass: "combat" | "siege-attacker" | "siege-defender" | null; readonly onActivate: () => void }) {
  const hitBounds = armyStandardHitBounds(asset, x, y, conflictClass !== null, width);
  return <rect className="map-army-hit-target" x={hitBounds.x} y={hitBounds.y} width={hitBounds.width} height={hitBounds.height} pointerEvents="all" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onActivate(); }} />;
}

/**
 * Lightweight SVG overlay: province hit areas plus invisible army hit
 * targets. Terrain fills, rivers, political overlay, borders, political
 * territory name labels, settlement markers/labels, and army/fleet standards
 * are all on the canvas layer drawn by MapViewport (see map-canvas-terrain.ts
 * / map-canvas-labels.ts / map-canvas-entities.ts), so this SVG paints no
 * fills or images and repaints far fewer elements per animation frame —
 * territory labels in particular used to be hundreds of live SVG nodes here
 * (one <text> plus a <defs> path per territory) and were a real pan/zoom lag
 * source once a map had enough small territories.
 */
export function GeoMap({ world, political, viewBox, overlay, selectedProvinceId, zoomBand, scale, tx, ty, forceFlagUrls, onProvinceHover, onProvinceClick, onForceClick, onMapPointerDown }: GeoMapProps) {
  const forceMarkers = useMemo(() => (overlay?.forces ?? []).flatMap((force) => {
    const position = resolveForceMapPosition(force, world);
    return position === null ? [] : [{ ...force, ...position }];
  }), [overlay?.forces, world]);
  const conflictByForceId = useMemo(() => deriveForceConflictStatuses(overlay), [overlay]);

  // Container size via ResizeObserver — uses contentRect (layout box, unaffected
  // by CSS transform) so viewport culling stays accurate at any zoom level.
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      setContainerSize((prev) => (prev?.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleRect = useMemo((): VisibleRect | null => {
    if (!containerSize || containerSize.w === 0 || containerSize.h === 0) return null;
    return computeVisibleRect(viewBox, containerSize.w, containerSize.h, tx, ty, scale);
  }, [viewBox, tx, ty, scale, containerSize]);

  // How many CSS pixels one geographic degree covers right now — used to
  // drop labels too small to read, and stays undefined (no filtering)
  // before the container has been measured.
  const pixelsPerDegree = useMemo(() => {
    if (!containerSize || containerSize.w === 0 || containerSize.h === 0) return undefined;
    const parts = viewBox.split(" ").map(Number);
    const [, , vw, vh] = [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
    return Math.min(containerSize.w / vw, containerSize.h / vh) * scale;
  }, [viewBox, containerSize, scale]);
  const armyStandardWidth = useMemo(() => pixelsPerDegree ? armyStandardWidthForZoom(pixelsPerDegree) : ARMY_STANDARD_WIDTH, [pixelsPerDegree]);

  const visibleProvinces = useMemo(() => {
    if (!visibleRect) return world.provinces;
    const r = visibleRect;
    return world.provinces.filter((p) =>
      p.bounds.minX <= r.maxX && p.bounds.maxX >= r.minX &&
      -p.bounds.maxY <= r.maxY && -p.bounds.minY >= r.minY,
    );
  }, [world.provinces, visibleRect]);

  const visibleForces = useMemo(() => {
    if (!visibleRect) return forceMarkers;
    const r = visibleRect;
    return forceMarkers.filter((f) => f.x >= r.minX && f.x <= r.maxX && f.y >= r.minY && f.y <= r.maxY);
  }, [forceMarkers, visibleRect]);

  const handlePointerEnter = useCallback((event: PointerEvent<SVGPathElement>) => { const id = event.currentTarget.dataset.provinceId; if (id) onProvinceHover(id, event); }, [onProvinceHover]);
  const handlePointerLeave = useCallback(() => onProvinceHover(null), [onProvinceHover]);
  const handleClick = useCallback((event: React.MouseEvent<SVGPathElement>) => { const id = event.currentTarget.dataset.provinceId; if (id) onProvinceClick(id); }, [onProvinceClick]);
  const handleKeyDown = useCallback((event: KeyboardEvent<SVGPathElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const id = event.currentTarget.dataset.provinceId; if (id) onProvinceClick(id); } }, [onProvinceClick]);

  return <svg ref={svgRef} className="geo-map" viewBox={viewBox} xmlns="http://www.w3.org/2000/svg" data-zoom={zoomBand} preserveAspectRatio="xMidYMid meet" onPointerDown={onMapPointerDown} style={{ willChange: "transform" }}>
    {/* Terrain, rivers, political fills, and borders are all on the canvas layer */}
    <g className="layer-dynamic-selection">{visibleProvinces.map((province) => <g key={province.id} className="geo-map-region" data-selected={selectedProvinceId === province.id ? "true" : undefined}><path d={province.svgPath} className="geo-map-region-hit" data-province-id={province.id} tabIndex={0} role="button" aria-label={province.name} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave} onClick={handleClick} onKeyDown={handleKeyDown} /><path d={province.exteriorSvgPath} className="geo-map-region-outline" pointerEvents="none" /></g>)}</g>
    {/* Political territory name labels, settlements, and army/fleet standards
        are all drawn on the terrain canvas now (see map-canvas-labels.ts and
        map-canvas-entities.ts) — this group only carries invisible force hit
        targets so click/hover/keyboard activation still works. */}
    <g className="layer-forces">{visibleForces.map((force) => {
      const locationLabel = world.provinceById.get(force.provinceId)?.name ?? force.provinceId;
      const destination = force.movement?.destination;
      const destinationLabel = destination === undefined ? "Holding position" : world.provinces.find((province) => provinceContains(province, destination))?.name ?? coordinateLabel(destination);
      const conflict = conflictByForceId.get(force.forceId);
      const details: ForceMapDetails = { forceId: force.forceId, ownerPolityId: force.ownerPolityId, name: force.name, commanderLabel: force.commanderLabel, statusLabel: conflict?.statusLabel ?? "Not in combat", strengthLabel: force.strengthLabel, locationLabel, destinationLabel, progressBps: force.movement?.progressBps ?? null, movementState: force.movement?.state ?? null };
      const flagAsset = forceFlagUrls.get(force.forceId) ?? { url: "/maps/generic-merchant-ship-standard.png", aspectRatio: 4 / 3 };
      const activate = () => onForceClick(details);
      return <g key={force.forceId} className="map-army-token" role="button" tabIndex={0} aria-label={`View ${force.name}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } }}>
        <title>{force.name}</title>
        <ArmyStandardHitTarget asset={flagAsset} x={force.x} y={force.y} width={armyStandardWidth} conflictClass={conflict?.conflictClass ?? null} onActivate={activate} />
      </g>;
    })}</g>
  </svg>;
}
