"use client";

import { useState, useCallback, useEffect, useMemo, useRef, type PointerEvent } from "react";
import { applyMapOverlayDelta, DynamicMapOverlaySchema, isGeoJsonMapDocument, MapOverlayDeltaSchema, type GeoJsonMap, type DynamicMapOverlay, type MatterFocus, type RoomStates, MAP_CHANGE_KINDS } from "@chronica/shared";
import type { RoomContents } from "../../../../lib/room-service";

// A map document never changes at its version, so each version is downloaded
// once and kept for soft navigation back into the game.
const _geoJsonCache = new Map<string, GeoJsonMap>();
const mapCacheKey = (gameId: string, version: string) => `${gameId}@${version}`;
import { GeoMap, type ForceFlagAsset, type ForceMapDetails } from "./geo-map";
import { MapViewport, type ViewportTransform, type MapViewportHandle, type DrawCanvasFn } from "./map-viewport";
import { computeViewBox } from "./geo-projection";
import { prepareStaticWorldGeometry, type StaticWorldGeometry } from "./world-geometry";
import { derivePoliticalMapState, deriveWarBorderPaths, type PoliticalMapState, type PoliticalOverlayInput } from "./political-geometry";
import { drawTerrainToCanvas } from "./map-canvas-terrain";
import { seaMaskFromImage, type SeaTest } from "./sea-mask";
import { toneBitmap } from "./tone-client";
import { ReliefLayer } from "./relief-tiles";
import { MapTooltip, type MapTooltipHandle } from "./map-tooltip";
import { MapControls } from "./map-controls";
import { CharacterPanel, type CharacterPanelProps } from "./character-panel";
import { ChatPanel } from "./chat-panel";
import { CouncilPanel } from "./council-panel";
import { ChroniclePanel, type ChronicleFocus } from "./chronicle-panel";
import { BooksPanel } from "./books-panel";
import { Office, type OfficeSurface } from "./office";
import { OFFICE_OBJECTS, ROOM_WIDTH, type RoomStyle } from "./office-objects";
import { rectFor, sceneryFor } from "./office-scenery";
import { Sheet, CloseButton, type SheetSide } from "../../../components/ui/sheet";
import { Era } from "../../../components/ui/era";
import { ForcesPanel } from "./forces-panel";
import { StandingPanel } from "./standing-panel";
import { MapOrderBar } from "./map-order-bar";
import { CalendarLine } from "./calendar-line";
import { LookupBox } from "./lookup-box";
import { GlossaryProvider, ThreadMarks, type ThreadsView } from "./notes";
import { TipRoot } from "../../../components/ui/tip";
import { unreadCount, useGameView } from "./use-game-view";
import { standardFor, standardsForPolity, type ArmyStandard } from "../../../../lib/army-standards";

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

/**
 * Which side of the room a document is laid on: away from the object it was
 * taken from, so the shelf stays in view beside the book. The desk's papers
 * are laid in the middle, in front of it.
 */
function sheetSideFor(style: RoomStyle, id: OfficeSurface): SheetSide {
  if (id === "council") return "center";
  const object = OFFICE_OBJECTS.find((candidate) => candidate.id === id);
  if (object === undefined) return "right";
  const rect = rectFor(sceneryFor(style), id, object.rect);
  return rect.x + rect.w / 2 < ROOM_WIDTH / 2 ? "right" : "left";
}

interface GameShellProps {
  readonly gameId: string;
  readonly gameTitle: string;
  readonly elapsedStepLabel: string;
  /** Names the map document to download (`/api/games/:id/map?v=`); absent when the scenario has none. */
  readonly mapVersion: string | undefined;
  readonly initialOverlay: DynamicMapOverlay | undefined;
  /** Which stored world `initialOverlay` was read from, so the poll can ask only for what changed since. */
  readonly initialOverlayStamp?: string | undefined;
  readonly baseImageUrl?: string;
  /** A folder of relief tiles (relief-tiles.ts) drawn over the base raster where the player looks. */
  readonly reliefUrl?: string;
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
 * The raster, toned into an engraved plate (see atlas-tone.ts), off the main
 * thread. Without a worker, or if toning fails, the raster as it is: a map in
 * the wrong colours beats no map.
 */
async function tonedBitmap(img: HTMLImageElement): Promise<ImageBitmap> {
  const toned = await toneBitmap(await createImageBitmap(img));
  return toned ?? createImageBitmap(img);
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
    .then(() => tonedBitmap(img))
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
  mapVersion: initialMapVersion,
  initialOverlay,
  initialOverlayStamp,
  baseImageUrl,
  reliefUrl,
  detailImageUrl,
  characterPanel,
  playerCharacterId,
  orderingCharacterId,
  roomStyle,
}: GameShellProps) {
  const [mapVersion, setMapVersion] = useState(initialMapVersion);
  const [geoJson, setGeoJson] = useState<GeoJsonMap | undefined>(
    () => initialMapVersion === undefined ? undefined : _geoJsonCache.get(mapCacheKey(gameId, initialMapVersion)),
  );
  const [overlay, setOverlay] = useState<DynamicMapOverlay | null>(
    initialOverlay ?? null,
  );
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  /** The stored-world revision the overlay in state was read at; sent with each poll. */
  const overlayStampRef = useRef<string | null>(initialOverlayStamp ?? null);
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
   *
   * It brings every sheet's contents with it (room-service.ts), so opening
   * the strongbox or the arms rack is a render rather than a round trip.
   */
  const [room, setRoom] = useState<RoomContents | null>(null);
  const controller = useGameView(gameId);
  const zoomBand = deriveZoomBand(viewport.scale);

  /** Set only when the mirror opens the record about the player; any other way in reads it whole. */
  const [chronicleFocus, setChronicleFocus] = useState<ChronicleFocus | null>(null);
  const openSurface = useCallback((next: OfficeSurface) => {
    setChronicleFocus(null);
    lastPickedUp.current = next;
    // Opening the record no longer marks it read: the Chronicle marks each
    // entry as the player reads it, so what is new stays marked until then.
    setSurface(next);
  }, []);
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
  // The mirror's way into the record: filtered to the player, and at the
  // entry behind the line he chose, if he chose one.
  const openChronicleAboutMe = useCallback((entryId: string | null) => {
    openSurface("chronicle");
    setChronicleFocus({
      filter: playerCharacterId === undefined || characterPanel === undefined ? null : { kind: "character", id: playerCharacterId, label: characterPanel.characterName },
      entryId,
    });
  }, [openSurface, playerCharacterId, characterPanel]);
  // A thread's way into the record: at the entry chosen.
  const openChronicleEntry = useCallback((entryId: string) => {
    openSurface("chronicle");
    setChronicleFocus({ filter: null, entryId });
  }, [openSurface]);
  const threadsView = useMemo<ThreadsView>(() => ({
    threads: room?.sheets?.threads ?? {},
    onFollow: (storylineId, followed) => {
      void fetch(`/api/games/${encodeURIComponent(gameId)}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storylineId, followed }),
      }).then(() => setRoomRevision((n) => n + 1)).catch(() => undefined);
    },
    onOpenEntry: openChronicleEntry,
  }), [room, gameId, openChronicleEntry]);
  // Matters in hand's way into the record: at the thread of the row chosen.
  const openChronicleAt = useCallback((focus: MatterFocus) => {
    openSurface("chronicle");
    setChronicleFocus({ filter: focus, entryId: null });
  }, [openSurface]);

  /** Bumped to read the room again when the player changed something in it: a thread followed. */
  const [roomRevision, setRoomRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch(`/api/games/${encodeURIComponent(gameId)}/room`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((contents: typeof room) => { if (live && contents !== null) setRoom(contents); })
      .catch(() => undefined);
    return () => { live = false; };
    // Re-read when simulated time has moved: a man given a legion should find
    // an arms rack in his room next time he walks in.
  }, [gameId, controller.view.chronicle.length, roomRevision]);

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
  /** An order begun somewhere else in the room: the treaties' "Write to them". */
  const [deskDraft, setDeskDraft] = useState<string | null>(null);
  const writeTo = useCallback((polityLabel: string) => {
    setDeskDraft(`Write to ${polityLabel}: `);
    openSurface("council");
  }, [openSurface]);

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
  // Each object's current fact, and whether it wants the player's word: the
  // plaque says it, and the seal mark shows it (room-states.ts).
  const stateOf = (id: keyof RoomStates) => ({ says: room?.states[id]?.says, marked: room?.states[id]?.marked === true });
  // The window looks out on the map: what has changed there since the player
  // last read the record.
  const mapChanges = view.chronicle.filter((entry) => entry.unread).reduce((sum, entry) => sum + entry.changes.filter((change) => MAP_CHANGE_KINDS.has(change.kind as never)).length, 0);
  const things = useMemo(() => [
    ...(orderingCharacterId === undefined ? [] : [{
      // A sealed document lies on the desk when the world wants an answer.
      id: "council" as const,
      says: view.decision !== null ? "Something needs your word" : stateOf("council").says,
      marked: view.decision !== null || stateOf("council").marked,
      state: view.decision !== null ? "sealed" : undefined,
    }]),
    { id: "chronicle" as const, badge: unread },
    ...(playerCharacterId === undefined ? [] : [{ id: "people" as const, ...stateOf("people") }]),
    ...(room?.books === true ? [{ id: "books" as const, ...stateOf("books") }] : []),
    ...(room?.purse === true ? [{ id: "purse" as const, ...stateOf("purse") }] : []),
    ...(room?.forces === true ? [{ id: "forces" as const, ...stateOf("forces") }] : []),
    ...(room?.standing === true ? [{ id: "standing" as const, ...stateOf("standing") }] : []),
    ...(characterPanel === undefined ? [] : [{ id: "self" as const, ...stateOf("self") }]),
    ...(mapChanges > 0 ? [{ id: "window" as const, says: mapChanges === 1 ? "One change on the map since you last read" : `${mapChanges} changes on the map since you last read` }] : []),
  ], [orderingCharacterId, playerCharacterId, characterPanel, room, view.decision, unread, mapChanges]);

  // --- Geometry shared between canvas terrain layer and lightweight SVG overlay ---

  const viewBox = useMemo(() => (geoJson ? computeViewBox(geoJson) : ""), [geoJson]);
  const world = useMemo(() => (geoJson ? prepareStaticWorldGeometry(geoJson) : null), [geoJson]);

  // Stable identity key: only recompute political state when ownership actually changes
  const politicsKey = useMemo(
    () => overlay === null
      ? ""
      : `${overlay.polities.map((p) => `${p.polityId}:${p.name}`).sort().join("|")}#${overlay.provinces.map((p) => `${p.provinceId}:${p.controllerPolityId ?? ""}`).sort().join("|")}#${overlay.politicalRelations.map((r) => `${r.memberPolityId}>${r.leaderPolityId}`).sort().join("|")}`,
    [overlay],
  );
  const politicalInput = useMemo<PoliticalOverlayInput | null>(
    () => overlay === null ? null : ({ polities: overlay.polities, provinces: overlay.provinces, politicalRelations: overlay.politicalRelations }),
    [politicsKey], // intentional: recompute only when ownership or allegiance changes, not on every overlay tick
  );
  // Reused across recomputes so unaffected polities skip the expensive
  // label-curve search entirely — see derivePoliticalMapState's `previous`
  // param. Only valid for the same `world`; a new map load starts fresh.
  // Where the sea is, read from the base raster, so an edge with no neighbour is
  // told to be a shore (outlined) or the edge of empty ground (not). Until it
  // has been read every such edge counts as a shore.
  const [seaMask, setSeaMask] = useState<SeaTest | null>(null);
  useEffect(() => {
    if (!baseImageUrl) return;
    let cancelled = false;
    const img = new Image();
    img.src = baseImageUrl;
    img.decode().then(() => seaMaskFromImage(img)).then((mask) => { if (!cancelled && mask) setSeaMask(() => mask); }).catch(() => { /* every bare edge stays a shore */ });
    return () => { cancelled = true; };
  }, [baseImageUrl]);
  const previousPoliticalRef = useRef<{ world: StaticWorldGeometry; political: PoliticalMapState } | null>(null);
  const political = useMemo(() => {
    if (!world) return null;
    const previous = previousPoliticalRef.current?.world === world ? previousPoliticalRef.current.political : null;
    const next = derivePoliticalMapState(world, politicalInput, previous, undefined, seaMask ?? undefined);
    previousPoliticalRef.current = { world, political: next };
    return next;
  }, [world, politicalInput, seaMask]);
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
  const reliefRef = useRef<ReliefLayer | null>(null);
  useEffect(() => {
    if (!reliefUrl) return;
    const layer = new ReliefLayer(reliefUrl, toneBitmap, requestRedraw);
    reliefRef.current = layer;
    return () => { layer.dispose(); reliefRef.current = null; };
  }, [reliefUrl, requestRedraw]);

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
      drawTerrainToCanvas(canvas, containerW, containerH, transform, vb, w, p, cbp, baseImageRef.current, detailImageRef.current, ov, flags, selectedProvinceId, hoveredProvinceRef.current, interacting, requestRedraw, reliefRef.current);
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

  // The map is fetched once per version, from a URL the browser may keep for
  // good. Refocusing the window asks again only if that fetch has not
  // succeeded yet; a loaded map is never replaced by an equal one.
  useEffect(() => {
    if (mapVersion === undefined) return;
    const key = mapCacheKey(gameId, mapVersion);
    const kept = _geoJsonCache.get(key);
    if (kept !== undefined) { setGeoJson(kept); return; }
    let cancelled = false;
    let loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      void fetch(`/api/games/${encodeURIComponent(gameId)}/map?v=${encodeURIComponent(mapVersion)}`)
        .then((response) => response.ok ? response.json() : null)
        .then((data: unknown) => {
          if (cancelled || !isGeoJsonMapDocument(data)) return;
          _geoJsonCache.set(key, data);
          setGeoJson(data);
          window.removeEventListener("focus", load);
        })
        .catch(() => { /* The compact loading state remains available for a retry. */ })
        .finally(() => { loading = false; });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [gameId, mapVersion]);

  // What each army carries, read from its record. A change the player makes is
  // saved to the world first and only then shown, so a reload shows the same.
  useEffect(() => {
    const flags = new Map<string, ForceFlagAsset>();
    for (const force of overlay?.forces ?? []) {
      const standard = standardFor(force.ownerPolityId, force.flagAssetId);
      flags.set(force.forceId, { url: standard.url, aspectRatio: standard.aspectRatio });
    }
    setForceFlagUrls(flags);
  }, [overlay?.forces]);

  const [forceEdit, setForceEdit] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null });
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => { setForceEdit({ saving: false, error: null }); setRenaming(null); }, [selectedForce?.forceId]);

  /** Renames or re-flags an army through the engine; the map changes once the world has. */
  const reviseForce = useCallback(async (force: ForceMapDetails, change: { name?: string; standardId?: string }): Promise<boolean> => {
    setForceEdit({ saving: true, error: null });
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/forces/${encodeURIComponent(force.forceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const body = await response.json().catch(() => null) as { error?: string; name?: string; standardId?: string | null } | null;
      if (!response.ok) {
        setForceEdit({ saving: false, error: body?.error ?? "The change could not be made." });
        return false;
      }
      const name = body?.name ?? change.name ?? force.name;
      const standardId = body?.standardId ?? change.standardId;
      setOverlay((current) => current === null ? current : {
        ...current,
        forces: current.forces.map((candidate) => candidate.forceId !== force.forceId ? candidate : { ...candidate, name, ...(standardId == null ? {} : { flagAssetId: standardId }) }),
      });
      setSelectedForce((current) => current?.forceId === force.forceId ? { ...current, name } : current);
      setForceEdit({ saving: false, error: null });
      return true;
    } catch {
      setForceEdit({ saving: false, error: "The change could not be sent." });
      return false;
    }
  }, [gameId]);

  const selectForceFlag = useCallback(async (standard: ArmyStandard) => {
    if (!flagCatalogForce) return;
    if (await reviseForce(flagCatalogForce, { standardId: standard.id })) setFlagCatalogForce(null);
  }, [flagCatalogForce, reviseForce]);

  const submitRename = useCallback(async () => {
    if (!selectedForce || renaming === null) return;
    const name = renaming.trim();
    if (name.length === 0 || name === selectedForce.name) { setRenaming(null); return; }
    if (await reviseForce(selectedForce, { name })) setRenaming(null);
  }, [renaming, reviseForce, selectedForce]);

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
  const handleForceHover = useCallback((name: string | null, event?: PointerEvent) => {
    if (name === null || !event) { tooltipRef.current?.hide(); return; }
    tooltipRef.current?.show(event.clientX, event.clientY, name);
  }, []);

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
    let polling = false;
    // Asks for what changed since the stored world the overlay in state was
    // read from: usually "nothing", else the rows that differ. A full overlay
    // comes back only when the server no longer remembers that world.
    const refreshOverlay = async () => {
      if (polling) return;
      polling = true;
      try {
        const since = overlayStampRef.current;
        const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/overlay${since === null ? "" : `?since=${encodeURIComponent(since)}`}`);
        if (!res.ok) return;
        const data = await res.json() as { stamp?: unknown; mapVersion?: unknown; unchanged?: unknown; mapOverlay?: unknown; delta?: unknown } | null;
        if (data === null || typeof data.stamp !== "string" || data.unchanged === true) return;
        let next: DynamicMapOverlay | null = null;
        if (data.delta !== undefined) {
          const delta = MapOverlayDeltaSchema.safeParse(data.delta);
          const current = overlayRef.current;
          if (delta.success && current !== null) next = applyMapOverlayDelta(current, delta.data);
        } else {
          const full = DynamicMapOverlaySchema.safeParse(data.mapOverlay);
          if (full.success) next = full.data;
        }
        // A delta that cannot be applied leaves the stamp alone, so the next poll asks again from the same base.
        if (next === null) return;
        overlayStampRef.current = data.stamp;
        setOverlay(next);
        if (typeof data.mapVersion === "string") setMapVersion(data.mapVersion);
      } catch {
        // Silently retry on next interval
      } finally {
        polling = false;
      }
    };
    const interval = setInterval(() => { void refreshOverlay(); }, 15_000);
    return () => clearInterval(interval);
  }, [gameId]);

  // Both read from the view, which is read again whenever the world moves:
  // a date that stays put after "Let a month pass" says the month did not.
  const dateChip = (
    <div className="shell-date-chip" aria-label="Current date" aria-live="polite">
      <Era text={controller.view.dateLabel ?? elapsedStepLabel} />
    </div>
  );
  const purse = controller.view.coins;
  const coinChip = (
    <a
      className="shell-coin-chip"
      href="/account"
      data-empty={purse?.available === "0" ? "true" : undefined}
      title={purse?.spent != null && purse.cap != null ? `This save has spent ${purse.spent} of its ${purse.cap} coins.` : undefined}
    >
      {purse === undefined ? "—" : purse.available} coins<span className="visually-hidden">, open the wallet</span>
    </a>
  );
  const leave = (
    <div className="shell-top-bar-left">
      <a className="shell-top-bar-exit" href="/">Leave</a>
      <span className="shell-game-title">{gameTitle}</span>
    </div>
  );

  if (!geoJson) {
    return (
      <div className="game" data-culture={roomStyle}>
        <header className="shell-top-bar">
          {leave}
          <span />
          <div className="shell-top-bar-right">{dateChip}{coinChip}</div>
        </header>
        <div className="game-shell">
          <div className="game-shell-map">
            <p className="game-shell-empty quiet">No map data available for this scenario.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <GlossaryProvider glossary={room?.sheets?.glossary ?? {}} threads={threadsView}>
    <div className="game" data-culture={roomStyle}>
      <header className="shell-top-bar">
        <div className="shell-top-bar-start">
          {leave}
          <LookupBox />
        </div>
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
            {controller.view.decision !== null && (
              <span className="shell-place__mark seal-dot"><span className="visually-hidden">Something needs your word</span></span>
            )}
            {unread > 0 && <span className="shell-place__badge badge">{unread}</span>}
          </button>
        </div>
        <div className="shell-top-bar-right">
          {dateChip}
          {/* The notes here live outside any sheet, so they get a root of their own. */}
          <TipRoot>
            <CalendarLine items={room?.sheets?.calendar ?? []} matters={room?.sheets?.matters ?? null} onOpenChronicle={openChronicleAt} />
            <ThreadMarks />
          </TipRoot>
          {coinChip}
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
                onForceHover={handleForceHover}
                onProvinceClick={handleProvinceClick}
                onForceClick={setSelectedForce}
                onMapPointerDown={clearSelectedForce}
              />
            )}
          </MapViewport>
          {selectedForce && (
            <aside className="map-force-details on-papyrus" aria-label={`${selectedForce.name} details`}>
              <div className="map-force-details__head">
                <h2>{selectedForce.name}</h2>
                <CloseButton what="army details" onClick={() => setSelectedForce(null)} />
              </div>
              <dl>
                <dt>Commander</dt><dd>{selectedForce.commanderLabel ?? "Unknown"}</dd>
                <dt>In the field</dt><dd>{selectedForce.statusLabel}</dd>
                <dt>Strength</dt><dd>{selectedForce.strengthLabel}</dd>
                <dt>At</dt><dd>{selectedForce.locationLabel}</dd>
                <dt>Going to</dt><dd>{selectedForce.destinationLabel}</dd>
                <dt>Progress</dt><dd>{selectedForce.progressBps === null ? "Stationary" : `${(selectedForce.progressBps / 100).toFixed(0)}% along the route${selectedForce.movementState === "retreating" ? ", retreating" : ""}`}</dd>
              </dl>
              {selectedForce.commandable && (renaming === null
                ? <div className="map-force-actions">
                    <button type="button" className="btn btn--small" onClick={() => setRenaming(selectedForce.name)} disabled={forceEdit.saving}>Rename</button>
                    <button type="button" className="btn btn--small" onClick={() => setFlagCatalogForce(selectedForce)} disabled={forceEdit.saving}>Change standard</button>
                  </div>
                : <form className="map-force-rename" onSubmit={(event) => { event.preventDefault(); void submitRename(); }}>
                    <label className="visually-hidden" htmlFor="map-force-name">New name</label>
                    <input id="map-force-name" value={renaming} maxLength={120} autoFocus onChange={(event) => setRenaming(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }} />
                    <button type="submit" className="btn btn--small btn--primary" disabled={forceEdit.saving}>{forceEdit.saving ? "Saving…" : "Save"}</button>
                    <button type="button" className="btn btn--small" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>)}
              {forceEdit.error !== null && !flagCatalogForce && <p className="map-force-error" role="alert">{forceEdit.error}</p>}
            </aside>
          )}
          {flagCatalogForce && (
            <Sheet
              label="the army standards"
              title={`A standard for ${flagCatalogForce.name}`}
              width="reading"
              side="center"
              onClose={() => setFlagCatalogForce(null)}
            >
              {forceEdit.error !== null && <p className="map-force-error" role="alert">{forceEdit.error}</p>}
              <div className="map-flag-options">
                {standardsForPolity(flagCatalogForce.ownerPolityId).map((flag) => (
                  <button key={flag.id} type="button" className="map-flag-option" disabled={forceEdit.saving} onClick={() => void selectForceFlag(flag)}>
                    <img src={flag.url} alt="" decoding="sync" />
                    <span><strong>{flag.name}</strong><small>{flag.description}</small></span>
                  </button>
                ))}
              </div>
            </Sheet>
          )}
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
        <CharacterPanel {...characterPanel} mirror={room?.sheets?.self ?? null} story={room?.sheets?.story ?? null} promises={room?.sheets?.promises ?? []} peers={room?.sheets?.peers ?? null} onOpenChronicle={openChronicleAboutMe} gameId={gameId} open={surface === "self"} onClose={closeSurface} side={sheetSideFor(roomStyle, "self")} />
      )}
      {playerCharacterId && (
        <ChatPanel
          gameId={gameId}
          playerCharacterId={playerCharacterId}
          open={surface === "people"}
          onClose={closeSurface}
          side={sheetSideFor(roomStyle, "people")}
          openSessionId={openChatSessionId}
          onOpenSessionConsumed={() => setOpenChatSessionId(null)}
        />
      )}
      {surface === "council" && orderingCharacterId && (
        <CouncilPanel gameId={gameId} controller={controller} underWay={room?.sheets?.underWay ?? []} draft={deskDraft} onDraftTaken={() => setDeskDraft(null)} onClose={closeSurface} onOpenChronicle={() => openSurface("chronicle")} />
      )}
      {surface === "chronicle" && <ChroniclePanel controller={controller} onClose={closeSurface} side={sheetSideFor(roomStyle, "chronicle")} focus={chronicleFocus} />}
      {(surface === "books" || surface === "purse") && (
        <BooksPanel
          which={surface === "purse" ? "own" : "kept"}
          books={room?.sheets?.[surface === "purse" ? "own" : "kept"] ?? null}
          onClose={closeSurface}
          side={sheetSideFor(roomStyle, surface)}
        />
      )}
      {surface === "forces" && (
        <ForcesPanel muster={room?.sheets?.forces ?? null} onClose={closeSurface} side={sheetSideFor(roomStyle, "forces")} />
      )}
      {surface === "standing" && (
        <StandingPanel
          standing={room?.sheets?.standing ?? null}
          state={room?.sheets?.state ?? null}
          onClose={closeSurface}
          side={sheetSideFor(roomStyle, "standing")}
          onWriteTo={orderingCharacterId ? writeTo : undefined}
          onOpenLetters={playerCharacterId ? () => openSurface("people") : undefined}
        />
      )}
    </div>
    </GlossaryProvider>
  );
}
