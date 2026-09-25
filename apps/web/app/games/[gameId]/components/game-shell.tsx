"use client";

import { useState, useCallback, useEffect, useMemo, useRef, type PointerEvent } from "react";
import { DynamicMapOverlaySchema, GeoJsonMapSchema, type GeoJsonMap, type DynamicMapOverlay } from "@chronica/shared";

// Module-level cache provides geometry immediately during soft navigation; a
// fresh request below then replaces it if the active scenario map was revised.
const _geoJsonCache = new Map<string, GeoJsonMap>();
import { GeoMap, type ForceFlagAsset, type ForceMapDetails } from "./geo-map";
import { MapViewport, type ViewportTransform, type MapViewportHandle, type DrawCanvasFn } from "./map-viewport";
import { computeViewBox } from "./geo-projection";
import { prepareStaticWorldGeometry, type StaticWorldGeometry } from "./world-geometry";
import { derivePoliticalMapState, deriveWarBorderPaths, type PoliticalMapState, type PoliticalOverlayInput } from "./political-geometry";
import { drawTerrainToCanvas } from "./map-canvas-terrain";
import { MapTooltip, type MapTooltipHandle } from "./map-tooltip";
import { MapControls } from "./map-controls";
import { CharacterPanel, type CharacterPanelProps } from "./character-panel";
import { ChatPanel } from "./chat-panel";
import { CouncilPanel } from "./council-panel";
import { ChroniclePanel } from "./chronicle-panel";
import { BooksPanel } from "./books-panel";
import { Office, type OfficeSurface } from "./office";
import type { RoomStyle } from "./office-objects";
import { ForcesPanel } from "./forces-panel";
import { StandingPanel } from "./standing-panel";
import { MapOrderBar } from "./map-order-bar";
import { unreadCount, useGameView } from "./use-game-view";

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
  readonly elapsedStepLabel: string;
  readonly initialGeoJson: GeoJsonMap | undefined;
  readonly initialOverlay: DynamicMapOverlay | undefined;
  readonly baseImageUrl?: string;
  readonly detailImageUrl?: string;
  readonly characterPanel?: CharacterPanelProps | undefined;
  /** Drives the chat panel: speaking as this character needs their declared knowledgebase. */
  readonly playerCharacterId?: string | undefined;
  /** Drives the council: giving orders only needs a character held in the world. */
  readonly orderingCharacterId?: string | undefined;
  /** Which culture's room the player works in. */
  readonly roomStyle: RoomStyle;
}

/**
 * Loads a map raster into `target` as an ImageBitmap and asks for a repaint.
 * Returns the effect cleanup, which drops a load that finishes too late.
 */
function loadMapBitmap(url: string | undefined, target: { current: ImageBitmap | null }, onReady: () => void): () => void {
  target.current = null;
  if (!url) return () => {};
  let cancelled = false;
  const img = new Image();
  img.src = url;
  img.decode()
    .then(() => createImageBitmap(img))
    .then((bitmap) => {
      if (cancelled) { bitmap.close(); return; }
      target.current = bitmap;
      onReady();
    })
    .catch(() => { /* no raster: the map draws water and fills alone */ });
  return () => {
    cancelled = true;
    target.current?.close();
    target.current = null;
  };
}

export function GameShell({
  gameId,
  gameTitle,
  elapsedStepLabel,
  initialGeoJson,
  initialOverlay,
  baseImageUrl,
  detailImageUrl,
  characterPanel,
  playerCharacterId,
  orderingCharacterId,
  roomStyle,
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
  const [viewport, setViewport] = useState<ViewportTransform>({
    scale: 1,
    tx: 0,
    ty: 0,
  });
  const [selectedForce, setSelectedForce] = useState<ForceMapDetails | null>(null);
  const [forceFlagUrls, setForceFlagUrls] = useState<ReadonlyMap<string, ForceFlagAsset>>(() => new Map());
  const [flagCatalogForce, setFlagCatalogForce] = useState<ForceMapDetails | null>(null);
  const [coins, setCoins] = useState<string | null>(null);
  const [openChatSessionId, setOpenChatSessionId] = useState<string | null>(null);
  /**
   * Which of the game's two places the player is in.
   *
   * One route, and the map never unmounts: its pan/zoom lives in this
   * component, and `derivePoliticalMapState` is memoised against a ref that a
   * remount would throw away, so every return from the Office would pay the
   * label-curve search again.
   *
   * The Office is where you land. A decision waiting on your word and the
   * record of what happened while you were away are both in there.
   */
  const [place, setPlace] = useState<"map" | "office">("office");
  const [surface, setSurface] = useState<OfficeSurface | null>(null);
  /**
   * What is actually in this player's room.
   *
   * Whether a man commands anyone or holds anything is a question only the
   * server can answer. Guessing it from "holds a character" put an arms rack
   * in a private citizen's room. Null until it answers, and an object is not
   * drawn on a guess.
   */
  const [room, setRoom] = useState<{ forces: boolean; standing: boolean; books: boolean; purse: boolean } | null>(null);
  const controller = useGameView(gameId);
  const zoomBand = deriveZoomBand(viewport.scale);

  const openSurface = useCallback((next: OfficeSurface) => {
    lastPickedUp.current = next;
    setSurface(next);
    // Opening the record is what marks it read; the badge clears as the shelf
    // comes off the wall rather than after a round trip.
    if (next === "chronicle") void controller.markRead();
  }, [controller]);
  /**
   * What was picked up last, so putting it down returns focus to it.
   *
   * A <dialog> restores focus by itself; the working panels are asides and do
   * not, so closing one dropped focus to the body and a keyboard player lost
   * their place in the room.
   */
  const lastPickedUp = useRef<OfficeSurface | null>(null);
  const closeSurface = useCallback(() => {
    const id = lastPickedUp.current;
    setSurface(null);
    if (id === null) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-object="${id}"]`)?.focus();
    });
  }, []);

  useEffect(() => {
    let live = true;
    void fetch(`/api/games/${encodeURIComponent(gameId)}/room`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((contents: typeof room) => { if (live && contents !== null) setRoom(contents); })
      .catch(() => undefined);
    return () => { live = false; };
    // Re-read when simulated time has moved: a man given a legion should find
    // an arms rack in his room next time he walks in.
  }, [gameId, controller.view.chronicle.length]);

  // Somebody has come to find the player. The wiring for this has been
  // plumbed through the shell since the chat panel was written and nothing
  // ever set it, because there was nowhere for a conversation to arrive. Now
  // there is a letter tray for it to arrive in.
  useEffect(() => {
    if (openChatSessionId === null) return;
    setPlace("office");
    setSurface("people");
  }, [openChatSessionId]);
  const goToDesk = useCallback(() => { setPlace("office"); setSurface("council"); }, []);

  const { view } = controller;
  const unread = unreadCount(view.chronicle);

  /**
   * What is in the room, and what is not.
   *
   * An object appears only when the thing it stands for is true. A private
   * citizen's room is nearly bare, and the first time an arms rack shows up
   * because somebody gave him a legion is a moment the game has had no way to
   * express.
   */
  const things = useMemo(() => [
    ...(orderingCharacterId === undefined ? [] : [{
      // A sealed document lies on the desk when the world wants an answer.
      id: "council" as const, marked: view.decision !== null,
      state: view.decision !== null ? "sealed" : undefined,
    }]),
    { id: "chronicle" as const, badge: unread },
    ...(playerCharacterId === undefined ? [] : [{ id: "people" as const }]),
    ...(room?.books === true ? [{ id: "books" as const }] : []),
    ...(room?.purse === true ? [{ id: "purse" as const }] : []),
    ...(room?.forces === true ? [{ id: "forces" as const }] : []),
    ...(room?.standing === true ? [{ id: "standing" as const }] : []),
    ...(characterPanel === undefined ? [] : [{ id: "self" as const }]),
  ], [orderingCharacterId, playerCharacterId, characterPanel, room, view.decision, unread]);

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
  // Reused across recomputes so unaffected polities skip the expensive
  // label-curve search entirely — see derivePoliticalMapState's `previous`
  // param. Only valid for the same `world`; a new map load starts fresh.
  const previousPoliticalRef = useRef<{ world: StaticWorldGeometry; political: PoliticalMapState } | null>(null);
  const political = useMemo(() => {
    if (!world) return null;
    const previous = previousPoliticalRef.current?.world === world ? previousPoliticalRef.current.political : null;
    const next = derivePoliticalMapState(world, politicalInput, previous);
    previousPoliticalRef.current = { world, political: next };
    return next;
  }, [world, politicalInput]);
  const countryBorderPath = useMemo(
    () => (political ? deriveWarBorderPaths(political, overlay?.conflicts.wars ?? []) : ""),
    [political, overlay?.conflicts.wars],
  );

  // Raster images for the canvas — loaded once per URL and turned into an
  // ImageBitmap, so it is decoded and on the GPU before the first frame needs
  // it rather than during one (that first draw of a raw <img> took ~180ms).
  const mapViewportRef = useRef<MapViewportHandle>(null);
  const baseImageRef = useRef<ImageBitmap | null>(null);
  const detailImageRef = useRef<ImageBitmap | null>(null);
  const requestRedraw = useCallback(() => mapViewportRef.current?.requestRedraw(), []);

  useEffect(() => loadMapBitmap(baseImageUrl, baseImageRef, requestRedraw), [baseImageUrl, requestRedraw]);
  useEffect(() => loadMapBitmap(detailImageUrl, detailImageRef, requestRedraw), [detailImageUrl, requestRedraw]);

  // Hover lives in a ref, not state: moving the pointer across provinces
  // repaints the canvas and, for unclaimed land, the tooltip — never the
  // whole shell and every panel in it.
  const hoveredProvinceRef = useRef<string | null>(null);
  const tooltipRef = useRef<MapTooltipHandle>(null);

  // The draw function reference is updated during render (safe ref mutation) so
  // the RAF inside MapViewport always calls the latest version without needing
  // the callback itself to change (which would cause extra renders).
  const drawCanvasFnRef = useRef<DrawCanvasFn>(() => { /* awaiting world data */ });
  if (world && political && viewBox) {
    const w = world; const p = political; const vb = viewBox; const cbp = countryBorderPath; const ov = overlay; const flags = forceFlagUrls;
    drawCanvasFnRef.current = (canvas, transform, containerW, containerH, interacting) => {
      drawTerrainToCanvas(canvas, containerW, containerH, transform, vb, w, p, cbp, baseImageRef.current, detailImageRef.current, ov, flags, selectedProvinceId, hoveredProvinceRef.current, interacting, requestRedraw);
    };
  }

  // Stable callback — MapViewport stores this in a ref internally, so it never
  // triggers re-renders even when drawCanvasFnRef.current changes.
  const onDrawCanvas = useCallback<DrawCanvasFn>((canvas, transform, w, h, interacting) => {
    drawCanvasFnRef.current(canvas, transform, w, h, interacting);
  }, []);

  // Trigger canvas redraw whenever the underlying data changes (new overlay, etc.)
  useEffect(() => {
    requestRedraw();
  }, [world, political, countryBorderPath, overlay, forceFlagUrls, selectedProvinceId, requestRedraw]);

  // Settlement-siege and army-conflict frames pulse (see map-canvas-entities.ts's
  // pulseOpacity) — that animation used to be a free CSS `animation` on the SVG
  // shapes, but a canvas paint only ever reflects the moment it was drawn, so
  // driving it here keeps the pulse visible even while the map sits idle.
  // Only runs while something is actually pulsing, so an idle map with no
  // active combat costs nothing extra. 30 repaints a second are plenty for a
  // 1.8s fade, and each one is only a request: during a pan it folds into
  // the frame the gesture is painting anyway instead of painting twice.
  const hasActiveConflict = Boolean(overlay && (overlay.conflicts.battles.length > 0 || overlay.conflicts.sieges.length > 0));
  useEffect(() => {
    // Not while the Office is over it: an opaque layer with a repainting
    // canvas behind it is pure heat.
    if (!hasActiveConflict || place !== "map") return;
    const interval = setInterval(requestRedraw, 1000 / 30);
    return () => clearInterval(interval);
  }, [hasActiveConflict, place, requestRedraw]);

  const allianceLabels = useMemo(() => {
    const names = new Map(overlay?.polities.map((polity) => [polity.polityId, polity.name]) ?? []);
    return (overlay?.politicalRelations ?? []).map((relation) => `${names.get(relation.leaderPolityId) ?? relation.leaderPolityId} allied with ${names.get(relation.memberPolityId) ?? relation.memberPolityId}`);
  }, [overlay]);

  useEffect(() => {
    let cancelled = false;
    // Respects the map route's Cache-Control (a few minutes), so refocusing
    // the tab doesn't force the server to refetch and re-copy this
    // multi-megabyte document when nothing has changed.
    const refreshMap = () => void fetch(`/api/games/${encodeURIComponent(gameId)}/map`)
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

  const setHoveredProvince = useCallback((provinceId: string | null) => {
    if (hoveredProvinceRef.current === provinceId) return;
    hoveredProvinceRef.current = provinceId;
    requestRedraw();
  }, [requestRedraw]);

  const clearMapHover = useCallback(() => {
    setHoveredProvince(null);
    tooltipRef.current?.hide();
  }, [setHoveredProvince]);

  const handleProvinceHover = useCallback(
    (provinceId: string | null, event?: PointerEvent) => {
      if (provinceId === null || !event) {
        clearMapHover();
        return;
      }
      setHoveredProvince(provinceId);
      // A province with a known owner is already named by its curved
      // territory label (e.g. "ROMAN REPUBLIC") -- a second, redundant name
      // tooltip stacked on top of it is just clutter. Only pop up the raw
      // region name for genuinely unclaimed territory, which has no label.
      const owner = political?.ownerByProvince.get(provinceId);
      if (owner != null) {
        tooltipRef.current?.hide();
        return;
      }
      const name = regionNames.get(provinceId) ?? provinceId;
      tooltipRef.current?.show(event.clientX, event.clientY, name);
    },
    [clearMapHover, setHoveredProvince, regionNames, political],
  );

  const handleProvinceClick = useCallback(
    (provinceId: string) => {
      setSelectedProvinceId((prev) =>
        prev === provinceId ? null : provinceId,
      );
    },
    [],
  );

  // GeoMap renders inside MapViewport, so the handle is there whenever this is called.
  const liveTransform = useCallback(() => mapViewportRef.current?.liveTransform() ?? { scale: 1, tx: 0, ty: 0 }, []);

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
  }, [gameId]);

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
        <div className="shell-place-switch" role="tablist" aria-label="Where you are">
          <button
            type="button" role="tab" id="place-map-tab" aria-controls="place-map"
            aria-selected={place === "map"} className="shell-place"
            onClick={() => setPlace("map")}
          >The Map</button>
          <button
            type="button" role="tab" id="place-office-tab" aria-controls="place-office"
            aria-selected={place === "office"} className="shell-place"
            onClick={() => setPlace("office")}
          >
            The Office
            {/* The decision mark is not polish. With the Council behind a door,
                a player standing on the map has nothing else telling them the
                world is waiting on their word. */}
            {controller.view.decision !== null && <span className="shell-place__mark" aria-label="Something needs your word">•</span>}
            {unread > 0 && <span className="shell-place__badge">{unread}</span>}
          </button>
        </div>
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
        <div
          className="game-shell-map"
          id="place-map"
          role="tabpanel"
          aria-labelledby="place-map-tab"
          data-scale={viewport.scale.toFixed(2)}
          data-selected-province={selectedProvinceId ?? undefined}
          inert={place !== "map"}
        >
          <MapViewport ref={mapViewportRef} transform={viewport} onTransformChange={setViewport} onDrawCanvas={onDrawCanvas} onPanStart={clearMapHover}>
            {world && political && (
              <GeoMap
                world={world}
                viewBox={viewBox}
                overlay={overlay}
                zoomBand={zoomBand}
                liveTransform={liveTransform}
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
          <MapTooltip ref={tooltipRef} />
          <MapControls
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            canZoomIn={viewport.scale < MAX_SCALE}
            canZoomOut={viewport.scale > MIN_SCALE}
          />
          {/* Only while the player is actually looking at the map: inert hides
              it from the keyboard but not from the eye, and its own stacking
              put it over the Office. */}
          {place === "map" && orderingCharacterId && <MapOrderBar controller={controller} onGoToDesk={goToDesk} />}
        </div>
        {place === "office" && <Office things={things} style={roomStyle} onOpen={openSurface} onLeave={() => setPlace("map")} />}
      </div>

      {characterPanel && (
        <CharacterPanel {...characterPanel} open={surface === "self"} onClose={closeSurface} />
      )}
      {playerCharacterId && (
        <ChatPanel
          gameId={gameId}
          playerCharacterId={playerCharacterId}
          open={surface === "people"}
          onClose={closeSurface}
          openSessionId={openChatSessionId}
          onOpenSessionConsumed={() => setOpenChatSessionId(null)}
        />
      )}
      {surface === "council" && orderingCharacterId && (
        <CouncilPanel controller={controller} onClose={closeSurface} onOpenChronicle={() => openSurface("chronicle")} />
      )}
      {surface === "chronicle" && <ChroniclePanel controller={controller} onClose={closeSurface} />}
      {(surface === "books" || surface === "purse") && (
        <BooksPanel gameId={gameId} revision={view.chronicle.length} onClose={closeSurface} />
      )}
      {surface === "forces" && (
        <ForcesPanel gameId={gameId} revision={view.chronicle.length} onClose={closeSurface} />
      )}
      {surface === "standing" && (
        <StandingPanel gameId={gameId} revision={view.chronicle.length} onClose={closeSurface} allianceLabels={allianceLabels} />
      )}
    </>
  );
}
