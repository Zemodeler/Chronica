import type { DynamicMapOverlay } from "@chronica/shared";
import type { StaticWorldGeometry } from "./world-geometry";
import { politicalColourWithAlpha, type PoliticalMapState } from "./political-geometry";
import type { ViewportTransform } from "./map-viewport";
import { drawPoliticalLabels } from "./map-canvas-labels";
import { derivePolityLabelFontSizes } from "./political-labels";
import { drawForces, drawSettlements } from "./map-canvas-entities";
import type { ForceFlagAsset } from "./army-standard";

// CSS colours extracted from styles.css (hard-coded to avoid DOM reads each frame)
const WATER_FILL = "#09233a";
const TERRAIN_TINT = "rgba(58,72,56,0.35)";
const RIVER_STROKE = "#84b4ca";
const BORDER_STROKE = "#dc5d5d";

const RIVER_WIDTH: Record<string, number> = { minor: 0.55, major: 1.1, navigable: 1.55 };
const RIVER_ALPHA: Record<string, number> = { minor: 0.7, major: 1, navigable: 1 };

// WeakMap-keyed caches — entries are GC'd together with the world object
const _provinceCache = new WeakMap<StaticWorldGeometry, Map<string, Path2D>>();
const _riverCache = new WeakMap<StaticWorldGeometry, Map<string, Path2D>>();

function getProvincePath(world: StaticWorldGeometry, id: string, svgPath: string): Path2D {
  let map = _provinceCache.get(world);
  if (!map) { map = new Map(); _provinceCache.set(world, map); }
  let p = map.get(id);
  if (!p) { p = new Path2D(svgPath); map.set(id, p); }
  return p;
}

function getRiverPath(world: StaticWorldGeometry, id: string, svgPath: string): Path2D {
  let map = _riverCache.get(world);
  if (!map) { map = new Map(); _riverCache.set(world, map); }
  let p = map.get(id);
  if (!p) { p = new Path2D(svgPath); map.set(id, p); }
  return p;
}

// Cache the war-border Path2D to avoid recreating it every frame
let _lastBorderString: string | null = null;
let _borderPath2D: Path2D | null = null;

function getBorderPath(borderPath: string): Path2D | null {
  if (!borderPath) return null;
  if (borderPath !== _lastBorderString) {
    _lastBorderString = borderPath;
    _borderPath2D = new Path2D(borderPath);
  }
  return _borderPath2D;
}

// ---------- Off-screen static layer cache ----------
// The static layers (water, raster images, terrain tint, political fills) are
// pre-rendered to an OffscreenCanvas keyed on data identity. During pan/zoom
// each visible frame just calls drawImage() — a single GPU blit instead of
// 200+ Path2D fill operations.
//
// The offscreen covers a padded region around the CURRENT viewport, not the
// whole map, so its fixed pixel budget (OFFSCREEN_MAX) buys far more detail
// per world-unit once the player zooms in — otherwise a texture sized for
// "all of Europe" is still only that size when a player is looking at one
// province, and gets blurrily upscaled. Panning within the padded region is
// still a cache hit; panning past its edge, or zooming enough that the
// cached resolution falls behind, triggers a re-render of just that region.
//
// Rivers and borders are still drawn directly per-frame because they use
// non-scaling strokes (visual width stays constant regardless of zoom level).

interface VisibleWorldRect { minX: number; maxX: number; minY: number; maxY: number; }

interface OffscreenEntry {
  canvas: OffscreenCanvas;
  world: StaticWorldGeometry;
  political: PoliticalMapState;
  borderPath: string;
  baseImage: HTMLImageElement | null;
  detailImage: HTMLImageElement | null;
  includeProvinceFills: boolean;
  rectVx: number; rectVy: number; rectVw: number; rectVh: number;
  pixelsPerUnit: number;
}

// Two independent slots: the "full" cache (province fills baked in — used
// when too many provinces are visible to fill one-by-one every frame) and
// the "backdrop" cache (water/raster only — used when zoomed in far enough
// that province fills are drawn directly at native resolution instead, see
// drawTerrainToCanvas). Keeping them separate means switching between the
// two modes at a zoom threshold doesn't thrash a single cache slot.
let _offscreenFull: OffscreenEntry | null = null;
let _offscreenBackdrop: OffscreenEntry | null = null;
const OFFSCREEN_MAX = 4096;
// The cached region is this many extra widths/heights of margin around the
// viewport that requested it, so ordinary panning stays a cache hit.
const OFFSCREEN_PAD = 1;
// Re-render once the cached texture's resolution drops below this fraction
// of what the current zoom actually needs, instead of only on pan overflow.
const OFFSCREEN_MIN_RESOLUTION_RATIO = .8;
// Below this many visible provinces, fill them directly on the main canvas
// every frame instead of baking them into the fixed-resolution offscreen —
// see the comment in drawTerrainToCanvas.
const DIRECT_RENDER_PROVINCE_THRESHOLD = 60;

function getOrRenderOffscreen(
  visibleRect: VisibleWorldRect,
  screenPixelsPerUnit: number,
  fullViewBox: string,
  world: StaticWorldGeometry,
  political: PoliticalMapState,
  countryBorderPath: string,
  baseImage: HTMLImageElement | null,
  detailImage: HTMLImageElement | null,
  includeProvinceFills: boolean,
): OffscreenEntry {
  const cached = includeProvinceFills ? _offscreenFull : _offscreenBackdrop;
  // Reuse if nothing changed, the viewport is still inside the cached
  // region, and that region is still high-enough resolution for this zoom.
  if (
    cached &&
    cached.world === world &&
    cached.political === political &&
    cached.borderPath === countryBorderPath &&
    cached.baseImage === baseImage &&
    cached.detailImage === detailImage &&
    visibleRect.minX >= cached.rectVx && visibleRect.maxX <= cached.rectVx + cached.rectVw &&
    visibleRect.minY >= cached.rectVy && visibleRect.maxY <= cached.rectVy + cached.rectVh &&
    cached.pixelsPerUnit >= screenPixelsPerUnit * OFFSCREEN_MIN_RESOLUTION_RATIO
  ) {
    return cached;
  }

  const [, , fullVw, fullVh] = fullViewBox.split(" ").map(Number) as [number, number, number, number];
  const visibleW = Math.max(visibleRect.maxX - visibleRect.minX, Number.EPSILON);
  const visibleH = Math.max(visibleRect.maxY - visibleRect.minY, Number.EPSILON);
  const rectVw = Math.min(fullVw, visibleW * (1 + 2 * OFFSCREEN_PAD));
  const rectVh = Math.min(fullVh, visibleH * (1 + 2 * OFFSCREEN_PAD));
  const centerX = (visibleRect.minX + visibleRect.maxX) / 2;
  const centerY = (visibleRect.minY + visibleRect.maxY) / 2;
  const rectVx = centerX - rectVw / 2;
  const rectVy = centerY - rectVh / 2;

  // Size the offscreen to the covered rect's aspect ratio, max OFFSCREEN_MAX on the longer side
  const aspect = rectVw / rectVh;
  const offw = aspect >= 1 ? OFFSCREEN_MAX : Math.round(OFFSCREEN_MAX * aspect);
  const offh = aspect >= 1 ? Math.round(OFFSCREEN_MAX / aspect) : OFFSCREEN_MAX;

  const offscreen = new OffscreenCanvas(offw, offh);
  const ctx = offscreen.getContext("2d")!;

  // Map world coordinates → offscreen pixels
  const sx = offw / rectVw;
  const sy = offh / rectVh;
  ctx.setTransform(sx, 0, 0, sy, -rectVx * sx, -rectVy * sy);

  // 1 — water background
  ctx.fillStyle = WATER_FILL;
  ctx.fillRect(rectVx, rectVy, rectVw, rectVh);

  // 2 — base raster image
  if (baseImage?.complete && baseImage.naturalWidth > 0) {
    ctx.drawImage(baseImage, -180, -90, 360, 180);
  }

  // 3 — detail raster image (Mediterranean inset)
  if (detailImage?.complete && detailImage.naturalWidth > 0) {
    ctx.drawImage(detailImage, -25, -72, 85, 57);
  }

  // 4-5 — terrain tint + political fill, baked in only when there are too
  // many visible provinces to fill them one-by-one on the main canvas every
  // frame (see drawTerrainToCanvas) — otherwise this stays a plain backdrop
  // and the caller draws fills directly at native (unblurred) resolution.
  if (includeProvinceFills) {
    ctx.fillStyle = TERRAIN_TINT;
    for (const province of world.provinces) {
      ctx.fill(getProvincePath(world, province.id, province.svgPath));
    }
    for (const province of world.provinces) {
      const owner = political.ownerByProvince.get(province.id);
      if (owner) {
        ctx.fillStyle = politicalColourWithAlpha(owner, 0.76);
        ctx.fill(getProvincePath(world, province.id, province.svgPath));
      }
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const entry: OffscreenEntry = { canvas: offscreen, world, political, borderPath: countryBorderPath, baseImage, detailImage, includeProvinceFills, rectVx, rectVy, rectVw, rectVh, pixelsPerUnit: sx };
  if (includeProvinceFills) _offscreenFull = entry; else _offscreenBackdrop = entry;
  return entry;
}

/**
 * Draws the static terrain layers onto the canvas.
 *
 * The canvas sits OUTSIDE the CSS-transformed wrapper so it is never rasterised
 * by the compositor.  We replicate the CSS+SVG viewBox transform manually so
 * every draw call reflects the current pan/zoom state.
 *
 * Call this on every animation frame during a gesture (MapViewport does this via
 * the onDrawCanvas prop) and whenever the underlying data changes (game-shell
 * calls redrawCanvas() on the MapViewport handle).
 */
export function drawTerrainToCanvas(
  canvas: HTMLCanvasElement,
  containerW: number,
  containerH: number,
  transform: ViewportTransform,
  viewBox: string,
  world: StaticWorldGeometry,
  political: PoliticalMapState,
  countryBorderPath: string,
  baseImage: HTMLImageElement | null,
  detailImage: HTMLImageElement | null,
  overlay: DynamicMapOverlay | null,
  forceFlagUrls: ReadonlyMap<string, ForceFlagAsset>,
  requestRedraw: () => void,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || containerW === 0 || containerH === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(containerW * dpr);
  const ph = Math.round(containerH * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }

  // Mirror SVG "xMidYMid meet" to find the viewBox-to-pixel mapping
  const [vx, vy, vw, vh] = viewBox.split(" ").map(Number) as [number, number, number, number];
  const sf = Math.min(containerW / vw, containerH / vh);
  const ox = (containerW - vw * sf) / 2;
  const oy = (containerH - vh * sf) / 2;

  // Combined transform: SVG meet scaling + CSS viewport pan/zoom
  // World point (wx, wy) → canvas pixel (wx*m*dpr + bx*dpr, wy*m*dpr + by*dpr)
  const m = sf * transform.scale;
  const bx = (ox - vx * sf) * transform.scale + transform.tx;
  const by = (oy - vy * sf) * transform.scale + transform.ty;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(m * dpr, 0, 0, m * dpr, bx * dpr, by * dpr);

  // 1-5 — static layers: single drawImage from an offscreen pre-rendered for
  //   the current viewport's region (water, raster images, terrain tint,
  //   political fills — re-used across frames until panning/zooming moves
  //   past the cached region, see getOrRenderOffscreen).
  //
  //   The offscreen has a fixed pixel budget (OFFSCREEN_MAX): fine when many
  //   provinces are visible (few pixels each anyway), but once zoomed in far
  //   enough that only a handful of provinces are on screen, baking their
  //   fills into that same fixed-size texture and stretching it blurs their
  //   edges. Below DIRECT_RENDER_PROVINCE_THRESHOLD visible provinces, skip
  //   baking fills into the offscreen (keep it a backdrop-only cache) and
  //   fill just those few provinces directly on the main canvas instead —
  //   pixel-crisp at native resolution, and cheap precisely because there
  //   are only a few of them.
  const visibleRect: VisibleWorldRect = { minX: (0 - bx) / m, maxX: (containerW - bx) / m, minY: (0 - by) / m, maxY: (containerH - by) / m };
  const visibleProvinces = world.provinces.filter((p) =>
    p.bounds.minX <= visibleRect.maxX && p.bounds.maxX >= visibleRect.minX &&
    -p.bounds.maxY <= visibleRect.maxY && -p.bounds.minY >= visibleRect.minY,
  );
  const directRenderFills = visibleProvinces.length <= DIRECT_RENDER_PROVINCE_THRESHOLD;
  const offscreen = getOrRenderOffscreen(visibleRect, m * dpr, viewBox, world, political, countryBorderPath, baseImage, detailImage, !directRenderFills);
  ctx.drawImage(offscreen.canvas, offscreen.rectVx, offscreen.rectVy, offscreen.rectVw, offscreen.rectVh);

  if (directRenderFills) {
    ctx.fillStyle = TERRAIN_TINT;
    for (const province of visibleProvinces) ctx.fill(getProvincePath(world, province.id, province.svgPath));
    for (const province of visibleProvinces) {
      const owner = political.ownerByProvince.get(province.id);
      if (owner) {
        ctx.fillStyle = politicalColourWithAlpha(owner, 0.76);
        ctx.fill(getProvincePath(world, province.id, province.svgPath));
      }
    }
  }

  // 6 — rivers (non-scaling stroke: visual width stays constant across zoom)
  ctx.strokeStyle = RIVER_STROKE;
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  for (const river of world.rivers) {
    const w = RIVER_WIDTH[river.className] ?? 0.55;
    const alpha = RIVER_ALPHA[river.className] ?? 1;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = w / m;
    ctx.stroke(getRiverPath(world, river.id, river.svgPath));
  }
  ctx.globalAlpha = 1;

  // 7 — war/country borders (dashed, non-scaling stroke)
  const borderPath = getBorderPath(countryBorderPath);
  if (borderPath) {
    ctx.strokeStyle = BORDER_STROKE;
    ctx.lineWidth = 0.7 / m;
    ctx.setLineDash([1.5 / m, 2 / m]);
    ctx.stroke(borderPath);
    ctx.setLineDash([]);
  }

  // 8 — political territory name labels (see map-canvas-labels.ts for why
  // these are drawn here instead of as SVG text)
  drawPoliticalLabels(ctx, political, m, visibleRect);

  // 9-10 — settlements and army/fleet standards (see map-canvas-entities.ts
  // for why these moved off the SVG layer too). `m` is CSS pixels per world
  // degree, the same rate the old SVG floor logic converted through.
  const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  const polityLabelFontSizes = derivePolityLabelFontSizes(political, m);
  drawSettlements(ctx, world, overlay, transform.scale, m, visibleRect, nowMs, polityLabelFontSizes);
  drawForces(ctx, world, overlay, forceFlagUrls, transform.scale, m, visibleRect, nowMs, requestRedraw);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- Pick canvas ----------
// Encode each province as a unique solid RGB (index → r,g,b).  Sampling one
// pixel on mousemove/click is O(1) and replaces 200 SVG hit-area paths.

function indexToColor(index: number): [number, number, number] {
  return [(index >> 16) & 0xff, (index >> 8) & 0xff, index & 0xff];
}

// Cache: pick canvas is invalidated when world or viewport changes
interface PickEntry {
  world: StaticWorldGeometry;
  vx: number; vy: number; vw: number; vh: number;
  scale: number; tx: number; ty: number;
  canvas: OffscreenCanvas;
}
let _pick: PickEntry | null = null;

/** Draw a color-coded province map for pixel-based hit testing. */
export function drawPickCanvas(
  containerW: number,
  containerH: number,
  transform: ViewportTransform,
  viewBox: string,
  world: StaticWorldGeometry,
): OffscreenCanvas {
  const [vx, vy, vw, vh] = viewBox.split(" ").map(Number) as [number, number, number, number];
  const { scale, tx, ty } = transform;

  if (
    _pick &&
    _pick.world === world &&
    _pick.vx === vx && _pick.vy === vy && _pick.vw === vw && _pick.vh === vh &&
    _pick.scale === scale && _pick.tx === tx && _pick.ty === ty &&
    _pick.canvas.width === containerW && _pick.canvas.height === containerH
  ) {
    return _pick.canvas;
  }

  const offscreen = new OffscreenCanvas(containerW, containerH);
  const ctx = offscreen.getContext("2d", { willReadFrequently: true })!;

  const sf = Math.min(containerW / vw, containerH / vh);
  const ox = (containerW - vw * sf) / 2;
  const oy = (containerH - vh * sf) / 2;
  const m = sf * scale;
  const bx = (ox - vx * sf) * scale + tx;
  const by = (oy - vy * sf) * scale + ty;

  ctx.clearRect(0, 0, containerW, containerH);
  ctx.setTransform(m, 0, 0, m, bx, by);

  for (let index = 0; index < world.provinces.length; index++) {
    const province = world.provinces[index]!;
    const [r, g, b] = indexToColor(index + 1); // 0 = no province (background)
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill(getProvincePath(world, province.id, province.svgPath));
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  _pick = { world, vx, vy, vw, vh, scale, tx, ty, canvas: offscreen };
  return offscreen;
}

/** Decode a province index from a sampled pixel color (0 = background/no province). */
export function pickProvinceAt(
  pickCanvas: OffscreenCanvas,
  x: number,
  y: number,
): number {
  const ctx = pickCanvas.getContext("2d", { willReadFrequently: true })!;
  const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return ((pixel[0]! << 16) | (pixel[1]! << 8) | pixel[2]!) || 0;
}
