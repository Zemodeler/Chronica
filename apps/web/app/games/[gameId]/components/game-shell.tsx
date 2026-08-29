"use client";

import { useState, useCallback, useEffect, type PointerEvent } from "react";
import type { GeoJsonMap, DynamicMapOverlay, GamePhase } from "@chronica/shared";
import { GeoMap } from "./geo-map";
import { MapViewport, type ViewportTransform } from "./map-viewport";
import { MapTooltip } from "./map-tooltip";
import { MapControls } from "./map-controls";

type ZoomBand = "far" | "medium" | "close";

const MIN_SCALE = 1;
const MAX_SCALE = 80;
const ZOOM_STEP = 1.35;
const MEDIUM_THRESHOLD = 2.5;
const CLOSE_THRESHOLD = 5;

function deriveZoomBand(scale: number): ZoomBand {
  if (scale >= CLOSE_THRESHOLD) return "close";
  if (scale >= MEDIUM_THRESHOLD) return "medium";
  return "far";
}

interface GameShellProps {
  readonly gameId: string;
  readonly gameTitle: string;
  readonly phase: GamePhase;
  readonly elapsedStepLabel: string;
  readonly initialGeoJson: GeoJsonMap | undefined;
  readonly initialOverlay: DynamicMapOverlay | undefined;
  readonly baseImageUrl?: string;
  readonly detailImageUrl?: string;
}

export function GameShell({
  gameId,
  gameTitle,
  phase,
  elapsedStepLabel,
  initialGeoJson,
  initialOverlay,
  baseImageUrl,
  detailImageUrl,
}: GameShellProps) {
  const [overlay, setOverlay] = useState<DynamicMapOverlay | null>(
    initialOverlay ?? null,
  );
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(
    null,
  );
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    name: string;
  } | null>(null);
  const [viewport, setViewport] = useState<ViewportTransform>({
    scale: 1,
    tx: 0,
    ty: 0,
  });

  const zoomBand = deriveZoomBand(viewport.scale);

  const regionNames = useState(() => {
    if (!initialGeoJson) return new Map<string, string>();
    const names = new Map<string, string>();
    for (const feature of initialGeoJson.features) {
      if (feature.properties.kind === "province") {
        names.set(feature.id, feature.properties.name);
      }
    }
    return names;
  })[0];

  const handleProvinceHover = useCallback(
    (provinceId: string | null, event?: PointerEvent) => {
      if (provinceId === null || !event) {
        setTooltip(null);
        return;
      }
      const name = regionNames.get(provinceId) ?? provinceId;
      setTooltip({ x: event.clientX, y: event.clientY, name });
    },
    [regionNames],
  );

  const handleProvinceClick = useCallback(
    (provinceId: string) => {
      setSelectedProvinceId((prev) =>
        prev === provinceId ? null : provinceId,
      );
    },
    [],
  );

  const handleZoomIn = useCallback(() => {
    setViewport((v) => ({
      ...v,
      scale: Math.min(MAX_SCALE, v.scale * ZOOM_STEP),
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewport((v) => ({
      ...v,
      scale: Math.max(MIN_SCALE, v.scale / ZOOM_STEP),
    }));
  }, []);

  useEffect(() => {
    if (phase === "finished" || phase === "failed") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/overlay`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.mapOverlay) {
          const next = data.mapOverlay as DynamicMapOverlay;
          setOverlay((current) => current?.revision === next.revision ? current : next);
        }
      } catch {
        // Silently retry on next interval
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [gameId, phase]);

  if (!initialGeoJson) {
    return (
      <>
        <header className="shell-top-bar">
          <a className="shell-top-bar-exit" href="/">
            Exit
          </a>
          <div className="shell-top-bar-center">
            <span className="shell-game-title">{gameTitle}</span>
            <span className="shell-turn-meta">{elapsedStepLabel}</span>
          </div>
          <div />
        </header>
        <div className="game-shell">
          <div className="game-shell-map">
            <p style={{ padding: "2rem", color: "var(--text-muted)" }}>
              No map data available for this scenario.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="shell-top-bar">
        <a className="shell-top-bar-exit" href="/">
          Exit
        </a>
        <div className="shell-top-bar-center">
          <span className="shell-game-title">{gameTitle}</span>
          <span className="shell-turn-meta">{elapsedStepLabel}</span>
        </div>
        <div />
      </header>
      <div className="game-shell">
        <div className="game-shell-map">
          <MapViewport transform={viewport} onTransformChange={setViewport}>
            <GeoMap
              geoJson={initialGeoJson}
              overlay={overlay}
              selectedProvinceId={selectedProvinceId}
              zoomBand={zoomBand}
              scale={viewport.scale}
              baseImageUrl={baseImageUrl}
              detailImageUrl={detailImageUrl}
              onProvinceHover={handleProvinceHover}
              onProvinceClick={handleProvinceClick}
            />
          </MapViewport>
          {tooltip && (
            <MapTooltip x={tooltip.x} y={tooltip.y} name={tooltip.name} />
          )}
          <MapControls
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            canZoomIn={viewport.scale < MAX_SCALE}
            canZoomOut={viewport.scale > MIN_SCALE}
          />
        </div>
      </div>
    </>
  );
}
