"use client";

import { useMemo, useCallback, type KeyboardEvent, type PointerEvent } from "react";
import type { DynamicMapOverlay, GeoJsonMap } from "@chronica/shared";
import { computeViewBox, projectCoordinate } from "./geo-projection";
import { derivePoliticalLabels } from "./political-labels";
import { derivePoliticalMapState, politicalColourWithAlpha, type PoliticalOverlayInput } from "./political-geometry";
import { prepareStaticWorldGeometry } from "./world-geometry";

type ZoomBand = "far" | "medium" | "close";
interface GeoMapProps { readonly geoJson: GeoJsonMap; readonly overlay: DynamicMapOverlay | null; readonly selectedProvinceId: string | null; readonly zoomBand: ZoomBand; readonly scale: number; readonly baseImageUrl: string | undefined; readonly detailImageUrl?: string | undefined; readonly onProvinceHover: (provinceId: string | null, event?: PointerEvent) => void; readonly onProvinceClick: (provinceId: string) => void; }

function settlementRadius(type: string): number { return type === "capital" ? .8 : type === "city" ? .7 : type === "town" ? .45 : type === "fort" || type === "port" ? .5 : .3; }
function politicalIdentity(overlay: DynamicMapOverlay | null) { return overlay === null ? "" : `${overlay.polities.map((polity) => `${polity.polityId}:${polity.name}`).sort().join("|")}#${overlay.provinces.map((province) => `${province.provinceId}:${province.controllerPolityId ?? ""}`).sort().join("|")}`; }

/** SVG view over immutable world geometry and derived political/dynamic map data. */
export function GeoMap({ geoJson, overlay, selectedProvinceId, zoomBand, scale, baseImageUrl, detailImageUrl, onProvinceHover, onProvinceClick }: GeoMapProps) {
  const invScale = 1 / scale;
  const viewBox = useMemo(() => computeViewBox(geoJson), [geoJson]);
  const world = useMemo(() => prepareStaticWorldGeometry(geoJson), [geoJson]);
  const politicsKey = politicalIdentity(overlay);
  const politicalInput = useMemo<PoliticalOverlayInput | null>(() => overlay === null ? null : ({ polities: overlay.polities, provinces: overlay.provinces }), [politicsKey]);
  const political = useMemo(() => derivePoliticalMapState(world, politicalInput), [world, politicalInput]);
  const politicalLabels = useMemo(() => derivePoliticalLabels(political, zoomBand), [political, zoomBand]);
  const settlementOverlay = useMemo(() => new Map(overlay?.settlements.map((settlement) => [settlement.settlementId, settlement]) ?? []), [overlay]);
  const countryBorders = useMemo(() => political.borderSegments.filter((border) => border.classification === "country_border").map((border) => border.svgPath).join(""), [political]);

  const handlePointerEnter = useCallback((event: PointerEvent<SVGPathElement>) => { const id = event.currentTarget.dataset.provinceId; if (id) onProvinceHover(id, event); }, [onProvinceHover]);
  const handlePointerLeave = useCallback(() => onProvinceHover(null), [onProvinceHover]);
  const handleClick = useCallback((event: React.MouseEvent<SVGPathElement>) => { const id = event.currentTarget.dataset.provinceId; if (id) onProvinceClick(id); }, [onProvinceClick]);
  const handleKeyDown = useCallback((event: KeyboardEvent<SVGPathElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const id = event.currentTarget.dataset.provinceId; if (id) onProvinceClick(id); } }, [onProvinceClick]);

  const forceMarkers = useMemo(() => (overlay?.forces ?? []).map((force) => {
    if (force.coordinate) { const [x, y] = projectCoordinate(force.coordinate[0], force.coordinate[1]); return { ...force, x, y }; }
    const province = world.provinceById.get(force.provinceId); const [x, y] = province ? projectCoordinate(province.centroid[0], province.centroid[1]) : [0, 0];
    return { ...force, x, y };
  }), [overlay?.forces, world]);

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
    <g className="layer-settlements">{world.settlements.map((settlement) => { const radius = settlementRadius(settlement.type) * invScale; const state = settlementOverlay.get(settlement.id); const fill = state?.controllerPolityId ? politicalColourWithAlpha(state.controllerPolityId, .9) : "#c8b88a"; return <g key={settlement.id} className={`map-settlement map-settlement-${settlement.type}`}><circle cx={settlement.projected[0]} cy={settlement.projected[1]} r={radius} fill={fill} stroke="#10151f" strokeWidth={.15 * invScale} /><text x={settlement.projected[0]} y={settlement.projected[1] + radius + .8 * invScale} textAnchor="middle" className="map-settlement-label" style={{ fontSize: ".48px", strokeWidth: ".12px" }}>{settlement.name}</text></g>; })}</g>
    <g className="layer-forces">{forceMarkers.map((force) => { const fill = politicalColourWithAlpha(force.ownerPolityId, .9); return <g key={force.forceId}>{force.movement && <path className="geo-map-movement-path" d={force.movement.path.map((position, index) => { const [x, y] = projectCoordinate(position[0], position[1]); return index === 0 ? `M${x} ${y}` : `L${x} ${y}`; }).join("")} />}<rect x={force.x - .8 * invScale} y={force.y - .5 * invScale} width={1.6 * invScale} height={invScale} rx={.15 * invScale} className="map-army-token" fill={fill} /><text x={force.x} y={force.y + 1.3 * invScale} textAnchor="middle" className="map-force-label" style={{ fontSize: `${.5 * invScale}px`, strokeWidth: `${.12 * invScale}px` }}>{force.strengthLabel}</text></g>; })}</g>
  </svg>;
}
