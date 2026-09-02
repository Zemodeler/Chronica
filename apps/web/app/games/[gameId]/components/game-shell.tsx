"use client";

import { useState, useCallback, useEffect, useMemo, useRef, type PointerEvent } from "react";
import { DynamicMapOverlaySchema, GeoJsonMapSchema, type GeoJsonMap, type DynamicMapOverlay, type GamePhase } from "@chronica/shared";

// Module-level cache provides geometry immediately during soft navigation; a
// fresh request below then replaces it if the active scenario map was revised.
const _geoJsonCache = new Map<string, GeoJsonMap>();
import { GeoMap, type ForceFlagAsset, type ForceMapDetails } from "./geo-map";
import { MapViewport, type ViewportTransform, type MapViewportHandle, type DrawCanvasFn } from "./map-viewport";
import { computeViewBox } from "./geo-projection";
import { prepareStaticWorldGeometry } from "./world-geometry";
import { derivePoliticalMapState, deriveWarBorderPaths, type PoliticalOverlayInput } from "./political-geometry";
import { drawTerrainToCanvas } from "./map-canvas-terrain";
import { MapTooltip } from "./map-tooltip";
import { MapControls } from "./map-controls";
import { CharacterPanel, type CharacterPanelProps } from "./character-panel";
import { ChatPanel } from "./chat-panel";
import { OrdersPanel } from "./orders-panel";
import { ChroniclePanel } from "./chronicle-panel";

type ZoomBand = "far" | "medium" | "close";

const MIN_SCALE = 1;
const MAX_SCALE = 80;
const ZOOM_STEP = 1.35;
const MEDIUM_THRESHOLD = 2.5;
const CLOSE_THRESHOLD = 5;

type FlagFaction = "rome" | "carthage" | "gauls" | "generic";
type FlagCatalogEntry = Readonly<{
  id: string;
  factions: readonly FlagFaction[];
  name: string;
  description: string;
  url: string;
  aspectRatio: number;
  contentBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

const FLAG_CATALOG = [
  { id: "legio-i-adiutrix", factions: ["rome"], name: "Capricorn standard", description: "Roman legionary Capricorn emblem", url: "/maps/legio-i-adiutrix-standard.png", aspectRatio: 1, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "spqr", factions: ["rome"], name: "SPQR standard", description: "The Roman Senate and People", url: "/maps/roman-spqr-banner.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  // These PNGs have transparent padding.  The same normalized rectangle is
  // used for rendering and pointer hit-testing, so their combat outline can
  // never activate army details.
  { id: "eagle", factions: ["rome"], name: "Legion eagle", description: "Gold eagle on crimson", url: "/maps/roman-eagle-banner.png", aspectRatio: 4 / 3, contentBounds: { x: 18 / 160, y: 13 / 120, width: 125 / 160, height: 89 / 120 } },
  { id: "laurel", factions: ["rome"], name: "Laurel standard", description: "Victory wreath on deep red", url: "/maps/roman-laurel-banner.png", aspectRatio: 4 / 3, contentBounds: { x: 18 / 160, y: 13 / 120, width: 125 / 160, height: 89 / 120 } },
  { id: "roman-wolf", factions: ["rome"], name: "Wolf signum", description: "Early Roman animal standard", url: "/maps/roman-wolf-signum.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "roman-boar", factions: ["rome"], name: "Boar signum", description: "Early Roman animal standard", url: "/maps/roman-boar-signum.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "roman-minotaur", factions: ["rome"], name: "Minotaur signum", description: "Early Roman animal standard", url: "/maps/roman-minotaur-signum.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "roman-horse", factions: ["rome"], name: "Horse signum", description: "Early Roman animal standard", url: "/maps/roman-horse-signum.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "roman-fasces", factions: ["rome"], name: "Fasces vexillum", description: "Roman civic emblem on a reconstructed banner", url: "/maps/roman-fasces-vexillum.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "roman-victory", factions: ["rome"], name: "Victory vexillum", description: "Roman Victoria motif on a reconstructed banner", url: "/maps/roman-victory-vexillum.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "carthage-tanit", factions: ["carthage"], name: "Sign of Tanit", description: "Punic religious symbol attested on stelae", url: "/maps/carthaginian-tanit-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "carthage-horse", factions: ["carthage"], name: "Punic horse", description: "Horse motif attested on Carthaginian coinage", url: "/maps/carthaginian-horse-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "carthage-palm", factions: ["carthage"], name: "Punic palm", description: "Palm motif from Punic coin imagery", url: "/maps/carthaginian-palm-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "carthage-crescent", factions: ["carthage"], name: "Crescent and disk", description: "Punic celestial motif on a reconstructed vexillum", url: "/maps/carthaginian-crescent-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "carthage-elephant", factions: ["carthage"], name: "Punic elephant", description: "War elephant motif attested in Punic warfare", url: "/maps/carthaginian-elephant-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "carthage-solar-disk", factions: ["carthage"], name: "Punic solar disk", description: "Solar emblem on a reconstructed Punic banner", url: "/maps/carthaginian-solar-disk-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "carthage-horse-head", factions: ["carthage"], name: "Punic horse head", description: "Horse-head motif attested on Carthaginian coinage", url: "/maps/carthaginian-horse-head-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "carthage-palm-disk", factions: ["carthage"], name: "Palm and disk", description: "Punic palm and celestial imagery", url: "/maps/carthaginian-palm-disk-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "hellenic-owl", factions: ["generic"], name: "Hellenic owl", description: "Athena's owl, widely attested in Greek civic imagery", url: "/maps/generic-hellenic-owl-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "macedonian-sun", factions: ["generic"], name: "Macedonian sun", description: "Argead star emblem", url: "/maps/generic-macedonian-sun-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "hellenic-gorgon", factions: ["generic"], name: "Gorgon emblem", description: "Apotropaic Hellenic shield motif", url: "/maps/generic-gorgon-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "merchant-ship", factions: ["generic"], name: "Merchant ship", description: "Mediterranean maritime standard", url: "/maps/generic-merchant-ship-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "syracusan-dolphin", factions: ["generic"], name: "Syracusan dolphin", description: "Dolphin imagery from Syracusan coinage", url: "/maps/generic-syracusan-dolphin-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "corinthian-pegasus", factions: ["generic"], name: "Corinthian Pegasus", description: "Pegasus motif from Corinthian coinage", url: "/maps/generic-corinthian-pegasus-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "spartan-lambda", factions: ["generic"], name: "Spartan lambda", description: "Lacedaemonian shield emblem", url: "/maps/generic-spartan-lambda-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "samnite-bull", factions: ["generic"], name: "Samnite bull", description: "Italic bull motif from regional coinage", url: "/maps/generic-samnite-bull-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "numidian-horse", factions: ["generic"], name: "Numidian horse", description: "North African cavalry motif", url: "/maps/generic-numidian-horse-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "iberian-horseman", factions: ["generic"], name: "Iberian horseman", description: "Horseman motif from Iberian coinage", url: "/maps/generic-iberian-horseman-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "sicilian-triskelion", factions: ["generic"], name: "Sicilian triskelion", description: "Ancient Sicilian three-legged emblem", url: "/maps/generic-sicilian-triskelion-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "etruscan-sphinx", factions: ["generic"], name: "Etruscan sphinx", description: "Etruscan decorative motif on a reconstructed banner", url: "/maps/generic-etruscan-sphinx-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "gallic-boar", factions: ["gauls"], name: "Gallic boar", description: "Celtic boar standard based on surviving martial imagery", url: "/maps/gallic-boar-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
  { id: "gallic-carnyx", factions: ["gauls"], name: "Gallic carnyx", description: "War-horn standard inspired by Celtic carnyces", url: "/maps/gallic-carnyx-standard.png", aspectRatio: 4 / 3, contentBounds: { x: 0, y: 0, width: 1, height: 1 } },
] as const satisfies readonly FlagCatalogEntry[];
type FlagId = (typeof FLAG_CATALOG)[number]["id"];

function flagsForPolity(polityId: string) {
  return FLAG_CATALOG.filter((flag) => {
    const factions = flag.factions as readonly FlagFaction[];
    return factions.includes(polityId as FlagFaction) || factions.includes("generic");
  });
}

function defaultFlagForPolity(polityId: string) {
  return flagsForPolity(polityId)[0] ?? FLAG_CATALOG.find((flag) => flag.id === "merchant-ship")!;
}

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
  readonly characterPanel?: CharacterPanelProps | undefined;
  readonly playerCharacterId?: string | undefined;
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
  characterPanel,
  playerCharacterId,
}: GameShellProps) {
  const [geoJson, setGeoJson] = useState<GeoJsonMap | undefined>(
    () => initialGeoJson ?? _geoJsonCache.get(gameId),
  );
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
  const [selectedForce, setSelectedForce] = useState<ForceMapDetails | null>(null);
  const [forceFlagUrls, setForceFlagUrls] = useState<ReadonlyMap<string, ForceFlagAsset>>(() => new Map());
  const [flagCatalogForce, setFlagCatalogForce] = useState<ForceMapDetails | null>(null);
  const [coins, setCoins] = useState<string | null>(null);
  const [chronicleOpen, setChronicleOpen] = useState(false);
  const zoomBand = deriveZoomBand(viewport.scale);

  // --- Geometry shared between canvas terrain layer and lightweight SVG overlay ---

  const viewBox = useMemo(() => (geoJson ? computeViewBox(geoJson) : ""), [geoJson]);
  const world = useMemo(() => (geoJson ? prepareStaticWorldGeometry(geoJson) : null), [geoJson]);

  // Stable identity key: only recompute political state when ownership actually changes
  const politicsKey = useMemo(
    () => overlay === null
      ? ""
      : `${overlay.polities.map((p) => `${p.polityId}:${p.name}`).sort().join("|")}#${overlay.provinces.map((p) => `${p.provinceId}:${p.controllerPolityId ?? ""}`).sort().join("|")}`,
    [overlay],
  );
  const politicalInput = useMemo<PoliticalOverlayInput | null>(
    () => overlay === null ? null : ({ polities: overlay.polities, provinces: overlay.provinces }),
    [politicsKey], // intentional: recompute only when ownership changes, not on every overlay tick
  );
  const political = useMemo(
    () => (world ? derivePoliticalMapState(world, politicalInput) : null),
    [world, politicalInput],
  );
  const countryBorderPath = useMemo(
    () => (political ? deriveWarBorderPaths(political, overlay?.conflicts.wars ?? []) : ""),
    [political, overlay?.conflicts.wars],
  );

  // Raster images for the canvas — loaded once per URL, trigger a redraw on load
  const mapViewportRef = useRef<MapViewportHandle>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const detailImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!baseImageUrl) { baseImageRef.current = null; return; }
    const img = new Image();
    img.onload = () => { baseImageRef.current = img; mapViewportRef.current?.redrawCanvas(); };
    img.src = baseImageUrl;
    return () => { img.onload = null; };
  }, [baseImageUrl]);

  useEffect(() => {
    if (!detailImageUrl) { detailImageRef.current = null; return; }
    const img = new Image();
    img.onload = () => { detailImageRef.current = img; mapViewportRef.current?.redrawCanvas(); };
    img.src = detailImageUrl;
    return () => { img.onload = null; };
  }, [detailImageUrl]);

  // The draw function reference is updated during render (safe ref mutation) so
  // the RAF inside MapViewport always calls the latest version without needing
  // the callback itself to change (which would cause extra renders).
  const drawCanvasFnRef = useRef<DrawCanvasFn>(() => { /* awaiting world data */ });
  if (world && political && viewBox) {
    const w = world; const p = political; const vb = viewBox; const cbp = countryBorderPath;
    drawCanvasFnRef.current = (canvas, transform, containerW, containerH) => {
      drawTerrainToCanvas(canvas, containerW, containerH, transform, vb, w, p, cbp, baseImageRef.current, detailImageRef.current);
    };
  }

  // Stable callback — MapViewport stores this in a ref internally, so it never
  // triggers re-renders even when drawCanvasFnRef.current changes.
  const onDrawCanvas = useCallback<DrawCanvasFn>((canvas, transform, w, h) => {
    drawCanvasFnRef.current(canvas, transform, w, h);
  }, []);

  // Trigger canvas redraw whenever the underlying data changes (new overlay, etc.)
  useEffect(() => {
    mapViewportRef.current?.redrawCanvas();
  }, [world, political, countryBorderPath]);

  const allianceLabels = useMemo(() => {
    const names = new Map(overlay?.polities.map((polity) => [polity.polityId, polity.name]) ?? []);
    return (overlay?.politicalRelations ?? []).map((relation) => `${names.get(relation.leaderPolityId) ?? relation.leaderPolityId} allied with ${names.get(relation.memberPolityId) ?? relation.memberPolityId}`);
  }, [overlay]);

  useEffect(() => {
    let cancelled = false;
    const refreshMap = () => void fetch(`/api/games/${encodeURIComponent(gameId)}/map`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: unknown) => {
        const parsed = GeoJsonMapSchema.safeParse(data);
        if (!cancelled && parsed.success) {
          _geoJsonCache.set(gameId, parsed.data);
          setGeoJson(parsed.data);
        }
      })
      .catch(() => { /* The compact loading state remains available for a retry. */ });
    if (initialGeoJson !== undefined) {
      _geoJsonCache.set(gameId, initialGeoJson);
      setGeoJson(initialGeoJson);
    }
    refreshMap();
    window.addEventListener("focus", refreshMap);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshMap);
    };
  }, [gameId, initialGeoJson]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/coins", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ coins: string | null }> : null)
      .then((data) => { if (!cancelled && data?.coins !== null && data !== null) setCoins(data.coins); })
      .catch(() => { /* An unauthenticated map remains usable. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const savedFlags = new Map<string, ForceFlagAsset>();
    for (const force of overlay?.forces ?? []) {
      let savedId: string | null = null;
      try {
        savedId = window.sessionStorage.getItem(`chronica:force-flag:${gameId}:${force.forceId}`);
      } catch {
        // Storage is optional; the scenario's current standard still renders.
      }
      const flag = flagsForPolity(force.ownerPolityId).find((candidate) => candidate.id === (savedId ?? force.flagAssetId)) ?? defaultFlagForPolity(force.ownerPolityId);
      if (flag) savedFlags.set(force.forceId, { url: flag.url, aspectRatio: flag.aspectRatio, contentBounds: flag.contentBounds });
    }
    setForceFlagUrls(savedFlags);
  }, [gameId, overlay?.forces]);

  const selectForceFlag = useCallback((flagId: FlagId) => {
    if (!flagCatalogForce) return;
    const flag = flagsForPolity(flagCatalogForce.ownerPolityId).find((candidate) => candidate.id === flagId);
    if (!flag) return;
    setForceFlagUrls((current) => new Map(current).set(flagCatalogForce.forceId, { url: flag.url, aspectRatio: flag.aspectRatio, contentBounds: flag.contentBounds }));
    try {
      window.sessionStorage.setItem(`chronica:force-flag:${gameId}:${flagCatalogForce.forceId}`, flag.id);
    } catch {
      // The selection still applies while this page remains open.
    }
    setFlagCatalogForce(null);
  }, [flagCatalogForce, gameId]);

  const regionNames = useMemo(() => {
    if (!geoJson) return new Map<string, string>();
    const names = new Map<string, string>();
    for (const feature of geoJson.features) {
      if (feature.properties.kind === "province") {
        names.set(feature.id, feature.properties.name);
      }
    }
    return names;
  }, [geoJson]);

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

  const clearSelectedForce = useCallback(() => setSelectedForce(null), []);

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
    const refreshOverlay = async () => {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/overlay`);
        if (!res.ok) return;
        const data: unknown = await res.json();
        const candidate = typeof data === "object" && data !== null && "mapOverlay" in data ? data.mapOverlay : null;
        const parsed = DynamicMapOverlaySchema.safeParse(candidate);
        if (parsed.success) {
          const next = parsed.data;
          setOverlay((current) => current?.revision === next.revision ? current : next);
        }
      } catch {
        // Silently retry on next interval
      }
    };
    const interval = setInterval(() => { void refreshOverlay(); }, 15_000);
    return () => clearInterval(interval);
  }, [gameId, phase]);

  if (!geoJson) {
    return (
      <>
        <header className="shell-top-bar">
          <a className="shell-top-bar-exit" href="/">
            Exit
          </a>
          <div className="shell-top-bar-center">
            <span className="shell-game-title">{gameTitle}</span>
          </div>
          <div className="shell-top-bar-right">
            <div className="shell-date-chip" aria-label="Current date">
              <span className="shell-date-arrow" aria-hidden="true">‹</span>
              <span>{elapsedStepLabel}</span>
              <span className="shell-date-arrow" aria-hidden="true">›</span>
            </div>
            <a className="shell-coin-chip" href="/account" aria-label="Open coin wallet">◉ {coins ?? "—"} coins</a>
          </div>
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
        </div>
        <div className="shell-top-bar-right">
          <div className="shell-date-chip" aria-label="Current date">
            <span className="shell-date-arrow" aria-hidden="true">‹</span>
            <span>{elapsedStepLabel}</span>
            <span className="shell-date-arrow" aria-hidden="true">›</span>
          </div>
          <a className="shell-coin-chip" href="/account" aria-label="Open coin wallet">◉ {coins ?? "—"} coins</a>
        </div>
      </header>
      <div className="game-shell">
        <div className="game-shell-map">
          <MapViewport ref={mapViewportRef} transform={viewport} onTransformChange={setViewport} onDrawCanvas={onDrawCanvas}>
            {world && political && (
              <GeoMap
                world={world}
                political={political}
                viewBox={viewBox}
                overlay={overlay}
                selectedProvinceId={selectedProvinceId}
                zoomBand={zoomBand}
                scale={viewport.scale}
                tx={viewport.tx}
                ty={viewport.ty}
                forceFlagUrls={forceFlagUrls}
                onProvinceHover={handleProvinceHover}
                onProvinceClick={handleProvinceClick}
                onForceClick={setSelectedForce}
                onMapPointerDown={clearSelectedForce}
              />
            )}
          </MapViewport>
          {selectedForce && <aside className="map-force-details" aria-label={`${selectedForce.name} details`}>
            <button type="button" className="map-force-details-close" onClick={() => setSelectedForce(null)} aria-label="Close army details">×</button>
            <strong>{selectedForce.name}</strong>
            <span>Commander: {selectedForce.commanderLabel ?? "Unknown"}</span>
            <span>Combat status: {selectedForce.statusLabel}</span>
            <span>Army size: {selectedForce.strengthLabel}</span>
            <span>Current region: {selectedForce.locationLabel}</span>
            <span>Going to: {selectedForce.destinationLabel}</span>
            <span>Progress: {selectedForce.progressBps === null ? "Stationary" : `${(selectedForce.progressBps / 100).toFixed(0)}% along route${selectedForce.movementState === "retreating" ? " (retreating)" : ""}`}</span>
            <button type="button" className="map-force-flag-button" onClick={() => setFlagCatalogForce(selectedForce)}>Change standard</button>
          </aside>}
          {flagCatalogForce && <div className="map-flag-catalog-backdrop" role="presentation" onMouseDown={() => setFlagCatalogForce(null)}>
            <section className="map-flag-catalog" role="dialog" aria-modal="true" aria-labelledby="flag-catalog-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="map-flag-catalog-header"><div><p>Army standard</p><h2 id="flag-catalog-title">Choose a banner for {flagCatalogForce.name}</h2></div><button type="button" className="map-force-details-close" onClick={() => setFlagCatalogForce(null)} aria-label="Close flag catalog">×</button></div>
              <div className="map-flag-options">{flagsForPolity(flagCatalogForce.ownerPolityId).map((flag) => <button key={flag.id} type="button" className="map-flag-option" onClick={() => selectForceFlag(flag.id)}><img src={flag.url} alt="" decoding="sync" /><span><strong>{flag.name}</strong><small>{flag.description}</small></span></button>)}</div>
            </section>
          </div>}
          {tooltip && (
            <MapTooltip x={tooltip.x} y={tooltip.y} name={tooltip.name} />
          )}
          <MapControls
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            canZoomIn={viewport.scale < MAX_SCALE}
            canZoomOut={viewport.scale > MIN_SCALE}
          />
          {allianceLabels.length > 0 && <aside className="map-political-context" aria-label="Political relationships">
            <strong>Political ties</strong>
            <span>{allianceLabels.join(" · ")}</span>
          </aside>}
        </div>
      </div>
      {characterPanel && <CharacterPanel {...characterPanel} />}
      {playerCharacterId && <ChatPanel gameId={gameId} playerCharacterId={playerCharacterId} />}
      {playerCharacterId && (
        <OrdersPanel
          gameId={gameId}
          onResolutionComplete={() => { setChronicleOpen(true); }}
        />
      )}
      <ChroniclePanel
        gameId={gameId}
        phase={phase}
        forceOpen={chronicleOpen}
        onForceOpenConsumed={() => setChronicleOpen(false)}
        onDisplayPatch={(patch) => {
          // Apply chronicle display patches to the live overlay
          // Patches are arrays of { kind, ... } objects written by buildDisplayPatch()
          if (!Array.isArray(patch)) return;
          setOverlay((current) => {
            if (!current) return current;
            let next = current;
            for (const p of patch as Array<{ kind: string; provinceId?: string; newControllerPolityId?: string; forceId?: string; newLocationId?: string }>) {
              if (p.kind === "province_control" && p.provinceId && p.newControllerPolityId) {
                // Overlay province control changes are reflected in the next poll;
                // for now just bump the revision so the map re-renders.
                next = { ...next, revision: next.revision + 1 };
              }
            }
            return next;
          });
        }}
      />
    </>
  );
}
