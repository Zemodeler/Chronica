"use client";

import { useMemo, useCallback, type KeyboardEvent, type PointerEvent } from "react";
import type { DynamicMapOverlay, GeoJsonMap, GeoJsonPosition } from "@chronica/shared";
import { computeViewBox, projectCoordinate } from "./geo-projection";
import { derivePoliticalLabels } from "./political-labels";
import { derivePoliticalMapState, deriveWarBorderPaths, politicalColourWithAlpha, type PoliticalOverlayInput } from "./political-geometry";
import { prepareStaticWorldGeometry, provinceContains } from "./world-geometry";
import { resolveForceMapPosition } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";

type ZoomBand = "far" | "medium" | "close";
export interface ForceMapDetails { readonly forceId: string; readonly name: string; readonly commanderLabel: string | null; readonly statusLabel: string; readonly strengthLabel: string; readonly locationLabel: string; readonly destinationLabel: string; readonly progressBps: number | null; readonly movementState: "moving" | "retreating" | null; }
export interface ForceFlagAsset { readonly url: string; readonly aspectRatio: number; }
interface GeoMapProps { readonly geoJson: GeoJsonMap; readonly overlay: DynamicMapOverlay | null; readonly selectedProvinceId: string | null; readonly zoomBand: ZoomBand; readonly scale: number; readonly baseImageUrl: string | undefined; readonly detailImageUrl?: string | undefined; readonly forceFlagUrls: ReadonlyMap<string, ForceFlagAsset>; readonly onProvinceHover: (provinceId: string | null, event?: PointerEvent) => void; readonly onProvinceClick: (provinceId: string) => void; readonly onForceClick: (details: ForceMapDetails) => void; }

function settlementRadius(type: string): number { return type === "capital" ? .06 : type === "city" ? .035 : type === "town" ? .015 : type === "fort" || type === "port" ? .04 : .020; }
function diamondPoints(x: number, y: number, radius: number): string { return `${x},${y - radius} ${x + radius},${y} ${x},${y + radius} ${x - radius},${y}`; }
function starPoints(x: number, y: number, radius: number): string { return Array.from({ length: 10 }, (_, index) => { const angle = -Math.PI / 2 + index * Math.PI / 5; const size = index % 2 === 0 ? radius : radius * .45; return `${x + Math.cos(angle) * size},${y + Math.sin(angle) * size}`; }).join(" "); }
function politicalIdentity(overlay: DynamicMapOverlay | null) { return overlay === null ? "" : `${overlay.polities.map((polity) => `${polity.polityId}:${polity.name}`).sort().join("|")}#${overlay.provinces.map((province) => `${province.provinceId}:${province.controllerPolityId ?? ""}`).sort().join("|")}`; }

function coordinateLabel([longitude, latitude]: GeoJsonPosition) { return `${latitude.toFixed(1)}°N, ${longitude.toFixed(1)}°E`; }

// Map-coordinate side length for both the visible army flag and its click target.
const ARMY_STANDARD_SIZE = .18;

function ArmyStandard({ asset, x, y, conflictClass, onActivate }: { readonly asset: ForceFlagAsset; readonly x: number; readonly y: number; readonly conflictClass: "combat" | "siege-attacker" | "siege-defender" | null; readonly onActivate: () => void }) {
  const width = ARMY_STANDARD_SIZE;
  const height = width / asset.aspectRatio;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return <>
    <rect x={x - halfWidth} y={y - halfHeight} width={width} height={height} fill="transparent" pointerEvents="all" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onActivate(); }} />
    {conflictClass && <rect className={`map-army-conflict map-army-conflict-${conflictClass}`} x={x - halfWidth + .002} y={y - halfHeight + .002} width={width - .004} height={height - .004} rx={.006} pointerEvents="none" />}
    <image
      href={asset.url}
      x={x - halfWidth}
      y={y - halfHeight}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      pointerEvents="none"
    />
  </>;
}

/** SVG view over immutable world geometry and derived political/dynamic map data. */
export function GeoMap({ geoJson, overlay, selectedProvinceId, zoomBand, scale, baseImageUrl, detailImageUrl, forceFlagUrls, onProvinceHover, onProvinceClick, onForceClick }: GeoMapProps) {
  const invScale = 1 / scale;
  const viewBox = useMemo(() => computeViewBox(geoJson), [geoJson]);
  const world = useMemo(() => prepareStaticWorldGeometry(geoJson), [geoJson]);
  const politicsKey = politicalIdentity(overlay);
  const politicalInput = useMemo<PoliticalOverlayInput | null>(() => overlay === null ? null : ({ polities: overlay.polities, provinces: overlay.provinces }), [politicsKey]);
  const political = useMemo(() => derivePoliticalMapState(world, politicalInput), [world, politicalInput]);
  const politicalLabels = useMemo(() => derivePoliticalLabels(political, zoomBand), [political, zoomBand]);
  const settlementOverlay = useMemo(() => new Map(overlay?.settlements.map((settlement) => [settlement.settlementId, settlement]) ?? []), [overlay]);
  const countryBorders = useMemo(() => deriveWarBorderPaths(political, overlay?.conflicts.wars ?? []), [overlay?.conflicts.wars, political]);

  const handlePointerEnter = useCallback((event: PointerEvent<SVGPathElement>) => { const id = event.currentTarget.dataset.provinceId; if (id) onProvinceHover(id, event); }, [onProvinceHover]);
  const handlePointerLeave = useCallback(() => onProvinceHover(null), [onProvinceHover]);
  const handleClick = useCallback((event: React.MouseEvent<SVGPathElement>) => { const id = event.currentTarget.dataset.provinceId; if (id) onProvinceClick(id); }, [onProvinceClick]);
  const handleKeyDown = useCallback((event: KeyboardEvent<SVGPathElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const id = event.currentTarget.dataset.provinceId; if (id) onProvinceClick(id); } }, [onProvinceClick]);

  const forceMarkers = useMemo(() => (overlay?.forces ?? []).flatMap((force) => {
    const position = resolveForceMapPosition(force, world);
    return position === null ? [] : [{ ...force, ...position }];
  }), [overlay?.forces, world]);
  const conflictByForceId = useMemo(() => deriveForceConflictStatuses(overlay), [overlay]);
  const besiegedSettlementIds = useMemo(() => new Set(overlay?.conflicts.sieges.map((siege) => siege.settlementId) ?? []), [overlay?.conflicts.sieges]);

  return <svg viewBox={viewBox} xmlns="http://www.w3.org/2000/svg" data-zoom={zoomBand} preserveAspectRatio="xMidYMid meet">
    <rect x="-180" y="-90" width="360" height="180" className="geo-map-water" />
    {baseImageUrl && <image href={baseImageUrl} x="-180" y="-90" width="360" height="180" preserveAspectRatio="none" className="geo-map-base-image" />}
    {detailImageUrl && <image href={detailImageUrl} x="-25" y="-72" width="85" height="57" preserveAspectRatio="none" className="geo-map-base-image" />}
    <g className="map-layer-terrain">{world.provinces.map((province) => <path key={province.id} d={province.svgPath} />)}</g>
    <g className="layer-rivers">{world.rivers.map((river) => <path key={river.id} d={river.svgPath} className={`geo-map-river geo-map-river-${river.className}`} />)}</g>
    <g className="map-layer-political">{world.provinces.map((province) => { const owner = political.ownerByProvince.get(province.id); return owner ? <path key={province.id} d={province.svgPath} fill={politicalColourWithAlpha(owner, .45)} /> : null; })}</g>
    {political.territories.length > 0 && <g className="layer-political-borders"><path d={countryBorders} className="geo-map-country-border" /></g>}
    <g className="layer-dynamic-selection">{world.provinces.map((province) => <path key={province.id} d={province.svgPath} className="geo-map-region" data-province-id={province.id} data-selected={selectedProvinceId === province.id ? "true" : undefined} tabIndex={0} role="button" aria-label={province.name} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave} onClick={handleClick} onKeyDown={handleKeyDown} />)}</g>
    <g className="layer-political-labels">
      <defs>{politicalLabels.map((label) => {
        const start = projectCoordinate(label.pathPoints[0][0], label.pathPoints[0][1]);
        const control = projectCoordinate(label.pathPoints[1][0], label.pathPoints[1][1]);
        const end = projectCoordinate(label.pathPoints[2][0], label.pathPoints[2][1]);
        return <path key={label.id} id={`political-label-path-${label.id}`} d={`M${start[0]} ${start[1]}Q${control[0]} ${control[1]} ${end[0]} ${end[1]}`} />;
      })}</defs>
      {politicalLabels.map((label) => <text key={label.id} textAnchor="middle" textLength={label.usableLength} lengthAdjust="spacing" className="map-political-label" style={{ fontSize: `${label.fontSize}px`, strokeWidth: `${.045 * invScale}px` }}><textPath href={`#political-label-path-${label.id}`} startOffset="50%">{label.name.toUpperCase()}</textPath></text>)}
    </g>
    <g className="layer-settlements">{world.settlements.map((settlement) => { const radius = settlementRadius(settlement.type); const state = settlementOverlay.get(settlement.id); const capital = state?.capitalPolityId !== null && state?.capitalPolityId !== undefined; const fill = state?.controllerPolityId ? politicalColourWithAlpha(state.controllerPolityId, .9) : "#c8b88a"; const labelSize = (state?.importance ?? 50) * .0035; return <g key={settlement.id} className={`map-settlement map-settlement-${capital ? "capital" : settlement.type}`} data-under-siege={besiegedSettlementIds.has(settlement.id) || undefined}>{capital ? <polygon points={starPoints(settlement.projected[0], settlement.projected[1], radius * 1.5)} fill={fill} stroke="#f4cf68" strokeWidth={.06} /> : settlement.type === "city" ? <polygon points={diamondPoints(settlement.projected[0], settlement.projected[1], radius)} fill={fill} stroke="#10151f" strokeWidth={.06} /> : settlement.type === "fort" ? <rect x={settlement.projected[0] - radius} y={settlement.projected[1] - radius} width={radius * 2} height={radius * 2} fill={fill} stroke="#10151f" strokeWidth={.06} /> : <circle cx={settlement.projected[0]} cy={settlement.projected[1]} r={radius} fill={fill} stroke="#10151f" strokeWidth={.06} />}<text x={settlement.projected[0]} y={settlement.projected[1] + radius + .28} textAnchor="middle" className="map-settlement-label" style={{ fontSize: `${labelSize}px`, strokeWidth: ".06px" }}>{settlement.name}</text></g>; })}</g>
    <g className="layer-forces">{forceMarkers.map((force) => {
      const locationLabel = world.provinceById.get(force.provinceId)?.name ?? force.provinceId;
      const destination = force.movement?.destination;
      const destinationLabel = destination === undefined ? "Holding position" : world.provinces.find((province) => provinceContains(province, destination))?.name ?? coordinateLabel(destination);
      const conflict = conflictByForceId.get(force.forceId);
      const details: ForceMapDetails = { forceId: force.forceId, name: force.name, commanderLabel: force.commanderLabel, statusLabel: conflict?.statusLabel ?? "Not in combat", strengthLabel: force.strengthLabel, locationLabel, destinationLabel, progressBps: force.movement?.progressBps ?? null, movementState: force.movement?.state ?? null };
      const flagAsset = forceFlagUrls.get(force.forceId) ?? { url: "/maps/roman-spqr-banner.png", aspectRatio: 4 / 3 };
      const activate = () => onForceClick(details);
      return <g key={force.forceId} className="map-army-token" role="button" tabIndex={0} aria-label={`View ${force.name}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } }}>
        <title>{force.name}</title>
        <ArmyStandard asset={flagAsset} x={force.x} y={force.y} conflictClass={conflict?.conflictClass ?? null} onActivate={activate} />
      </g>;
    })}</g>
  </svg>;
}
