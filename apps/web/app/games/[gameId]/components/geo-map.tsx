"use client";

import { useMemo, useCallback, type PointerEvent, type KeyboardEvent } from "react";
import type { GeoJsonMap, GeoJsonMapFeature, DynamicMapOverlay } from "@chronica/shared";
import {
  geometryToSvgPath,
  computeViewBox,
  projectCoordinate,
  polityColorWithAlpha,
} from "./geo-projection";
import { derivePoliticalLabels } from "./political-labels";

type ZoomBand = "far" | "medium" | "close";

interface GeoMapProps {
  readonly geoJson: GeoJsonMap;
  readonly overlay: DynamicMapOverlay | null;
  readonly selectedProvinceId: string | null;
  readonly zoomBand: ZoomBand;
  readonly scale: number;
  readonly baseImageUrl: string | undefined;
  readonly detailImageUrl?: string | undefined;
  readonly onProvinceHover: (
    provinceId: string | null,
    event?: PointerEvent,
  ) => void;
  readonly onProvinceClick: (provinceId: string) => void;
}

interface PreparedFeatures {
  provinces: { feature: GeoJsonMapFeature; path: string }[];
  rivers: { feature: GeoJsonMapFeature; path: string }[];
  settlements: { feature: GeoJsonMapFeature; x: number; y: number }[];
}

function prepareFeatures(map: GeoJsonMap): PreparedFeatures {
  const provinces: PreparedFeatures["provinces"] = [];
  const rivers: PreparedFeatures["rivers"] = [];
  const settlements: PreparedFeatures["settlements"] = [];

  for (const feature of map.features) {
    switch (feature.properties.kind) {
      case "province": {
        const path = geometryToSvgPath(feature.geometry);
        if (path) provinces.push({ feature, path });
        break;
      }
      case "river": {
        const path = geometryToSvgPath(feature.geometry);
        if (path) rivers.push({ feature, path });
        break;
      }
      case "settlement": {
        if (feature.geometry.type === "Point") {
          const [x, y] = projectCoordinate(
            feature.geometry.coordinates[0],
            feature.geometry.coordinates[1],
          );
          settlements.push({ feature, x, y });
        }
        break;
      }
    }
  }

  return { provinces, rivers, settlements };
}

function settlementRadius(type: string): number {
  switch (type) {
    case "capital":
      return 0.8;
    case "city":
      return 0.7;
    case "town":
      return 0.45;
    case "fort":
      return 0.5;
    case "port":
      return 0.5;
    default:
      return 0.3;
  }
}

export function GeoMap({
  geoJson,
  overlay,
  selectedProvinceId,
  zoomBand,
  scale,
  baseImageUrl,
  detailImageUrl,
  onProvinceHover,
  onProvinceClick,
}: GeoMapProps) {
  const invScale = 1 / scale;
  const viewBox = useMemo(() => computeViewBox(geoJson), [geoJson]);
  const prepared = useMemo(() => prepareFeatures(geoJson), [geoJson]);

  type ProvinceOverlayEntry = DynamicMapOverlay["provinces"][number];
  type SettlementOverlayEntry = DynamicMapOverlay["settlements"][number];

  const provinceOverlay = useMemo(() => {
    if (!overlay) return new Map<string, ProvinceOverlayEntry>();
    return new Map(overlay.provinces.map((p) => [p.provinceId, p]));
  }, [overlay]);

  const settlementOverlay = useMemo(() => {
    if (!overlay) return new Map<string, SettlementOverlayEntry>();
    return new Map(overlay.settlements.map((s) => [s.settlementId, s]));
  }, [overlay]);

  const politicalLabels = useMemo(
    () => derivePoliticalLabels(geoJson, overlay),
    [geoJson, overlay],
  );

  const handlePointerEnter = useCallback(
    (e: PointerEvent<SVGPathElement>) => {
      const id = e.currentTarget.dataset.provinceId;
      if (id) onProvinceHover(id, e);
    },
    [onProvinceHover],
  );

  const handlePointerLeave = useCallback(() => {
    onProvinceHover(null);
  }, [onProvinceHover]);

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGPathElement>) => {
      const id = e.currentTarget.dataset.provinceId;
      if (id) onProvinceClick(id);
    },
    [onProvinceClick],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<SVGPathElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const id = e.currentTarget.dataset.provinceId;
        if (id) onProvinceClick(id);
      }
    },
    [onProvinceClick],
  );

  const forceMarkers = useMemo(() => {
    if (!overlay) return [];
    return overlay.forces.map((force) => {
      if (force.coordinate) {
        const [x, y] = projectCoordinate(force.coordinate[0], force.coordinate[1]);
        return { ...force, x, y };
      }
      const province = prepared.provinces.find(
        (r) => r.feature.id === force.provinceId,
      );
      if (province && province.feature.geometry.type !== "Point") {
        const coords =
          province.feature.geometry.type === "Polygon"
            ? province.feature.geometry.coordinates[0]
            : province.feature.geometry.type === "MultiPolygon"
              ? province.feature.geometry.coordinates[0]?.[0]
              : undefined;
        if (coords && coords.length > 0) {
          let cx = 0;
          let cy = 0;
          const n = coords.length - 1;
          for (let i = 0; i < n; i++) {
            cx += coords[i]![0];
            cy += coords[i]![1];
          }
          const [x, y] = projectCoordinate(cx / n, cy / n);
          return { ...force, x, y };
        }
      }
      return { ...force, x: 0, y: 0 };
    });
  }, [overlay, prepared.provinces]);

  return (
    <svg
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      data-zoom={zoomBand}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Layer 1: Water background (fallback when no base image) */}
      <rect
        x="-180"
        y="-90"
        width="360"
        height="180"
        className="geo-map-water"
      />

      {/* Layer 2: Base image (full-world ocean/terrain background) */}
      {baseImageUrl && (
        <image
          href={baseImageUrl}
          x="-180"
          y="-90"
          width="360"
          height="180"
          preserveAspectRatio="none"
          className="geo-map-base-image"
        />
      )}

      {/* Layer 2b: Regional detail image (Europe + North Africa, lon -25..60, lat 15..72) */}
      {detailImageUrl && (
        <image
          href={detailImageUrl}
          x="-25"
          y="-72"
          width="85"
          height="57"
          preserveAspectRatio="none"
          className="geo-map-base-image"
        />
      )}

      {/* Layer 3: Terrain polygons */}
      <g className="map-layer-terrain">
        {prepared.provinces.map(({ feature, path }) => (
          <path key={feature.id} d={path} />
        ))}
      </g>

      {/* Layer 4: Rivers */}
      <g className="layer-rivers">
        {prepared.rivers.map(({ feature, path }) => {
          const cls =
            feature.properties.kind === "river"
              ? `geo-map-river geo-map-river-${feature.properties.class}`
              : "geo-map-river";
          return <path key={feature.id} d={path} className={cls} />;
        })}
      </g>

      {/* Layer 5: Political overlays */}
      <g className="map-layer-political">
        {prepared.provinces.map(({ feature, path }) => {
          const prov = provinceOverlay.get(feature.id);
          if (!prov?.controllerPolityId) return null;
          const fill = polityColorWithAlpha(prov.controllerPolityId, 0.45);
          return <path key={feature.id} d={path} fill={fill} />;
        })}
      </g>

      {/* Layer 6: Province borders */}
      <g className="layer-borders">
        {prepared.provinces.map(({ feature, path }) => (
          <path
            key={feature.id}
            d={path}
            className="geo-map-minor-border"
          />
        ))}
      </g>

      {/* Layer 7: Interactive hit areas */}
      <g className="layer-hit-areas">
        {prepared.provinces.map(({ feature, path }) => {
          const name =
            feature.properties.kind === "province"
              ? feature.properties.name
              : feature.id;
          return (
            <path
              key={feature.id}
              d={path}
              className="geo-map-region"
              data-province-id={feature.id}
              data-selected={
                selectedProvinceId === feature.id ? "true" : undefined
              }
              tabIndex={0}
              role="button"
              aria-label={name}
              onPointerEnter={handlePointerEnter}
              onPointerLeave={handlePointerLeave}
              onClick={handleClick}
              onKeyDown={handleKeyDown}
            />
          );
        })}
      </g>

      {/* Layer 8: Primary political labels */}
      {zoomBand !== "close" && (
        <g className="layer-political-labels">
          {politicalLabels.map((label) => {
            const [x, y] = projectCoordinate(label.coordinate[0], label.coordinate[1]);
            return (
              <text
                key={label.polityId}
                x={x}
                y={y}
                textAnchor="middle"
                className="map-political-label"
                style={{
                  fontSize: `${3.5 * invScale}px`,
                  letterSpacing: `${0.45 * invScale}px`,
                  strokeWidth: `${0.18 * invScale}px`,
                }}
              >
                {label.name.toUpperCase()}
              </text>
            );
          })}
        </g>
      )}

      {/* Layer 9: Settlement markers */}
      <g className="layer-settlements">
        {prepared.settlements.map(({ feature, x, y }) => {
          const props = feature.properties;
          if (props.kind !== "settlement") return null;
          const r = settlementRadius(props.type) * invScale;
          const so = settlementOverlay.get(feature.id);
          const fill = so?.controllerPolityId
            ? polityColorWithAlpha(so.controllerPolityId, 0.9)
            : "#c8b88a";
          const labelOffset = 0.8 * invScale;
          const fontSize = 0.55 * invScale;
          const labelStroke = 0.12 * invScale;
          return (
            <g key={feature.id} className={`map-settlement map-settlement-${props.type}`}>
              <circle cx={x} cy={y} r={r} fill={fill} stroke="#10151f" strokeWidth={0.15 * invScale} />
              <text
                x={x}
                y={y + r + labelOffset}
                textAnchor="middle"
                className="map-settlement-label"
                style={{
                  fill: "#dce8e5",
                  font: `500 ${fontSize}px system-ui, sans-serif`,
                  pointerEvents: "none",
                  paintOrder: "stroke",
                  stroke: "rgb(10 15 20 / 70%)",
                  strokeWidth: `${labelStroke}px`,
                }}
              >
                {props.name}
              </text>
            </g>
          );
        })}
      </g>

      {/* Layer 10: Force markers */}
      <g className="layer-forces">
        {forceMarkers.map((force) => {
          const fill = polityColorWithAlpha(force.ownerPolityId, 0.9);
          return (
            <g key={force.forceId}>
              {force.movement && (
                <path
                  className="geo-map-movement-path"
                  d={force.movement.path
                    .map((pos, i) => {
                      const [px, py] = projectCoordinate(pos[0], pos[1]);
                      return i === 0 ? `M${px} ${py}` : `L${px} ${py}`;
                    })
                    .join("")}
                />
              )}
              <rect
                x={force.x - 0.8 * invScale}
                y={force.y - 0.5 * invScale}
                width={1.6 * invScale}
                height={invScale}
                rx={0.15 * invScale}
                className="map-army-token"
                fill={fill}
              />
              <text
                x={force.x}
                y={force.y + 1.3 * invScale}
                textAnchor="middle"
                style={{
                  fill: "#dce8e5",
                  font: `600 ${0.5 * invScale}px system-ui, sans-serif`,
                  pointerEvents: "none",
                  paintOrder: "stroke",
                  stroke: "rgb(10 15 20 / 70%)",
                  strokeWidth: `${0.12 * invScale}px`,
                }}
              >
                {force.strengthLabel}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
