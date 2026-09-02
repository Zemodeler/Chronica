"use client";

import { useMemo, useCallback, useState, useRef, useEffect, type KeyboardEvent, type PointerEvent } from "react";
import type { DynamicMapOverlay, GeoJsonPosition } from "@chronica/shared";
import { projectCoordinate } from "./geo-projection";
import { derivePoliticalLabels } from "./political-labels";
import { politicalColourWithAlpha, type PoliticalMapState } from "./political-geometry";
import { provinceContains, type StaticWorldGeometry } from "./world-geometry";
import { resolveForceMapPosition } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";
import { armyStandardBounds, armyStandardHitBounds } from "./army-standard";

type ZoomBand = "far" | "medium" | "close";
export interface ForceMapDetails { readonly forceId: string; readonly ownerPolityId: string; readonly name: string; readonly commanderLabel: string | null; readonly statusLabel: string; readonly strengthLabel: string; readonly locationLabel: string; readonly destinationLabel: string; readonly progressBps: number | null; readonly movementState: "moving" | "retreating" | null; }
export interface ForceFlagAsset {
  readonly url: string;
  readonly aspectRatio: number;
  readonly contentBounds?: Readonly<{ x: number; y: number; width: number; height: number }>;
}

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

function settlementRadius(type: string): number { return type === "capital" ? .06 : type === "city" ? .035 : type === "town" ? .015 : type === "fort" || type === "port" ? .04 : .020; }
function diamondPoints(x: number, y: number, radius: number): string { return `${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`; }
function starPoints(x: number, y: number, radius: number): string { return Array.from({ length: 10 }, (_, index) => { const angle = -Math.PI / 2 + index * Math.PI / 5; const size = index % 2 === 0 ? radius : radius * .45; return `${x + Math.cos(angle) * size},${y + Math.sin(angle) * size}`; }).join(" "); }
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

function ArmyStandard({ asset, x, y, conflictClass, onActivate }: { readonly asset: ForceFlagAsset; readonly x: number; readonly y: number; readonly conflictClass: "combat" | "siege-attacker" | "siege-defender" | null; readonly onActivate: () => void }) {
  const bounds = armyStandardBounds(asset, x, y);
  const hitBounds = armyStandardHitBounds(asset, x, y, conflictClass !== null);
  return <>
    <rect className="map-army-hit-target" x={hitBounds.x} y={hitBounds.y} width={hitBounds.width} height={hitBounds.height} pointerEvents="all" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onActivate(); }} />
    {conflictClass && <rect className={`map-army-conflict map-army-conflict-${conflictClass}`} x={bounds.x + .002} y={bounds.y + .002} width={bounds.width - .004} height={bounds.height - .004} rx={.006} pointerEvents="none" />}
    <image
      href={asset.url}
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      preserveAspectRatio="xMidYMid meet"
      pointerEvents="none"
    />
  </>;
}

/**
 * Lightweight SVG overlay: hit areas, labels, settlements, forces.
 *
 * Terrain fills, rivers, political overlay, and borders are all on the
 * canvas layer drawn by MapViewport, so this SVG has zero fill paths and
 * repaints roughly 80% fewer elements per animation frame.
 */
export function GeoMap({ world, political, viewBox, overlay, selectedProvinceId, zoomBand, scale, tx, ty, forceFlagUrls, onProvinceHover, onProvinceClick, onForceClick, onMapPointerDown }: GeoMapProps) {
  const invScale = 1 / scale;
  const politicalLabels = useMemo(() => derivePoliticalLabels(political, zoomBand), [political, zoomBand]);
  const settlementOverlay = useMemo(() => new Map(overlay?.settlements.map((s) => [s.settlementId, s]) ?? []), [overlay]);
  const forceMarkers = useMemo(() => (overlay?.forces ?? []).flatMap((force) => {
    const position = resolveForceMapPosition(force, world);
    return position === null ? [] : [{ ...force, ...position }];
  }), [overlay?.forces, world]);
  const conflictByForceId = useMemo(() => deriveForceConflictStatuses(overlay), [overlay]);
  const besiegedSettlementIds = useMemo(() => new Set(overlay?.conflicts.sieges.map((siege) => siege.settlementId) ?? []), [overlay?.conflicts.sieges]);

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

  const visibleProvinces = useMemo(() => {
    if (!visibleRect) return world.provinces;
    const r = visibleRect;
    return world.provinces.filter((p) =>
      p.bounds.minX <= r.maxX && p.bounds.maxX >= r.minX &&
      -p.bounds.maxY <= r.maxY && -p.bounds.minY >= r.minY,
    );
  }, [world.provinces, visibleRect]);

  const visibleSettlements = useMemo(() => {
    if (!visibleRect) return world.settlements;
    const r = visibleRect;
    return world.settlements.filter((s) =>
      s.projected[0] >= r.minX && s.projected[0] <= r.maxX &&
      s.projected[1] >= r.minY && s.projected[1] <= r.maxY,
    );
  }, [world.settlements, visibleRect]);

  // Labels are text paths — filtering by viewport causes textPath→defs reference
  // races in React reconciliation, so we always render all of them.
  const visibleLabels = politicalLabels;

  const visibleForces = useMemo(() => {
    if (!visibleRect) return forceMarkers;
    const r = visibleRect;
    return forceMarkers.filter((f) => f.x >= r.minX && f.x <= r.maxX && f.y >= r.minY && f.y <= r.maxY);
  }, [forceMarkers, visibleRect]);

  const handlePointerEnter = useCallback((event: PointerEvent<SVGPathElement>) => { const id = event.currentTarget.dataset.provinceId; if (id) onProvinceHover(id, event); }, [onProvinceHover]);
  const handlePointerLeave = useCallback(() => onProvinceHover(null), [onProvinceHover]);
  const handleClick = useCallback((event: React.MouseEvent<SVGPathElement>) => { const id = event.currentTarget.dataset.provinceId; if (id) onProvinceClick(id); }, [onProvinceClick]);
  const handleKeyDown = useCallback((event: KeyboardEvent<SVGPathElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const id = event.currentTarget.dataset.provinceId; if (id) onProvinceClick(id); } }, [onProvinceClick]);

  return <svg ref={svgRef} className="geo-map" viewBox={viewBox} xmlns="http://www.w3.org/2000/svg" data-zoom={zoomBand} preserveAspectRatio="xMidYMid meet" onPointerDown={onMapPointerDown}>
    {/* Terrain, rivers, political fills, and borders are all on the canvas layer */}
    <g className="layer-dynamic-selection">{visibleProvinces.map((province) => <g key={province.id} className="geo-map-region" data-selected={selectedProvinceId === province.id ? "true" : undefined}><path d={province.svgPath} className="geo-map-region-hit" data-province-id={province.id} tabIndex={0} role="button" aria-label={province.name} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave} onClick={handleClick} onKeyDown={handleKeyDown} /><path d={province.exteriorSvgPath} className="geo-map-region-outline" pointerEvents="none" /></g>)}</g>
    <g className="layer-political-labels">
      <defs>{visibleLabels.map((label) => {
        const start = projectCoordinate(label.pathPoints[0][0], label.pathPoints[0][1]);
        const control = projectCoordinate(label.pathPoints[1][0], label.pathPoints[1][1]);
        const end = projectCoordinate(label.pathPoints[2][0], label.pathPoints[2][1]);
        return <path key={label.id} id={`political-label-path-${label.id}`} d={`M${start[0]} ${start[1]}Q${control[0]} ${control[1]} ${end[0]} ${end[1]}`} />;
      })}</defs>
      {visibleLabels.map((label) => <text key={label.id} textAnchor="middle" textLength={label.usableLength} lengthAdjust="spacing" className="map-political-label" style={{ fontSize: `${label.fontSize}px`, strokeWidth: `${.045 * invScale}px` }}><textPath href={`#political-label-path-${label.id}`} startOffset="50%">{label.name.toUpperCase()}</textPath></text>)}
    </g>
    <g className="layer-settlements">{visibleSettlements.map((settlement) => {
      const radius = settlementRadius(settlement.type);
      const state = settlementOverlay.get(settlement.id);
      const capital = state?.capitalPolityId !== null && state?.capitalPolityId !== undefined;
      const fill = state?.controllerPolityId ? politicalColourWithAlpha(state.controllerPolityId, .9) : "#c8b88a";
      const labelSize = (state?.importance ?? 50) * .0035;
      return <g key={settlement.id} className={`map-settlement map-settlement-${capital ? "capital" : settlement.type}`} data-under-siege={besiegedSettlementIds.has(settlement.id) || undefined}>
        {capital ? <polygon points={starPoints(settlement.projected[0], settlement.projected[1], radius * 1.5)} fill={fill} stroke="#f4cf68" strokeWidth={.06} /> : settlement.type === "city" ? <polygon points={diamondPoints(settlement.projected[0], settlement.projected[1], radius)} fill={fill} stroke="#10151f" strokeWidth={.06} /> : settlement.type === "fort" ? <rect x={settlement.projected[0] - radius} y={settlement.projected[1] - radius} width={radius * 2} height={radius * 2} fill={fill} stroke="#10151f" strokeWidth={.06} /> : <circle cx={settlement.projected[0]} cy={settlement.projected[1]} r={radius} fill={fill} stroke="#10151f" strokeWidth={.06} />}
        <text x={settlement.projected[0]} y={settlement.projected[1] + radius + .28} textAnchor="middle" className="map-settlement-label" style={{ fontSize: `${labelSize}px`, strokeWidth: ".06px" }}>{settlement.name}</text>
      </g>;
    })}</g>
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
        <ArmyStandard asset={flagAsset} x={force.x} y={force.y} conflictClass={conflict?.conflictClass ?? null} onActivate={activate} />
      </g>;
    })}</g>
  </svg>;
}
