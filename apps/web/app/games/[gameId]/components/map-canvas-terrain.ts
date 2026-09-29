import type { DynamicMapOverlay } from "@chronica/shared";
import type { StaticProvince, StaticWorldGeometry } from "./world-geometry";
import { politicalColourWithAlpha, type PoliticalMapState } from "./political-geometry";
import type { ViewportTransform } from "./map-viewport";
import { drawPoliticalLabels } from "./map-canvas-labels";
import { drawForces, drawSettlements } from "./map-canvas-entities";
import type { ForceFlagAsset } from "./army-standard";
import { displayUnit } from "./map-display-unit";
import { ATLAS } from "../../../../lib/palette";

// The atlas palette lives in lib/palette.ts, beside the stylesheet tokens it
// must agree with; it is read from there rather than from the DOM each frame.
const WATER_FILL = ATLAS.water;
const RIVER_STROKE = ATLAS.rivers;
const BORDER_STROKE = ATLAS.war;

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

// ---------- Off-screen political fill cache ----------
// Zoomed out, hundreds of provinces are on screen, and filling each one every
// frame is the cost worth caching: their terrain tint and political fill are
// baked into one OffscreenCanvas and blitted with a single drawImage.
//
// Only the fills are cached. Water and the raster images are drawn straight
// onto the main canvas every frame — a GPU blit of an ImageBitmap costs well
// under a millisecond, while redrawing a 4000px image into the cache made
// every rebuild ~100ms. Rivers, borders, labels and markers are painted
// directly too, at device resolution.
//
// The cache covers a padded region around the viewport that built it, at a
// resolution tied to that viewport's zoom. It is rebuilt only once the map has
// settled (MapViewport's `interacting`): a rebuild in the middle of a gesture
// froze it for a visible moment. While a gesture outruns the cache, the
// visible provinces are filled directly instead, which is crisp and cheap
// enough for the few frames it lasts.

interface VisibleWorldRect { minX: number; maxX: number; minY: number; maxY: number; }

interface FillCache {
  canvas: OffscreenCanvas;
  world: StaticWorldGeometry;
  political: PoliticalMapState;
  rectVx: number; rectVy: number; rectVw: number; rectVh: number;
  /** The screen resolution (device px per world unit) it was built for. */
  builtForPixelsPerUnit: number;
}

let _fillCache: FillCache | null = null;
const OFFSCREEN_MAX = 4096;
// The cached region is this many extra viewport widths/heights of margin on
// each side, so ordinary panning stays a cache hit — as far as OFFSCREEN_MAX
// allows at FILL_CACHE_RESOLUTION.
const OFFSCREEN_PAD = 1;
// Fraction of the screen's resolution the cache is rendered at. Fill edges at
// this zoom are small; everything crisp is drawn on top at full resolution.
const FILL_CACHE_RESOLUTION = .75;
// Zooming in by more than this factor since the build makes the cache too
// blurry to keep; it is rebuilt once the map settles.
const MAX_CACHE_UPSCALE = 2;
// Below this many visible provinces, fill them directly on the main canvas
// every frame instead of using the cache — few enough to be cheap, and
// pixel-crisp where the fixed-size cache would be stretched.
const DIRECT_RENDER_PROVINCE_THRESHOLD = 60;

function fillCacheCovers(cache: FillCache | null, world: StaticWorldGeometry, political: PoliticalMapState, visibleRect: VisibleWorldRect, screenPixelsPerUnit: number): cache is FillCache {
  if (cache === null || cache.world !== world || cache.political !== political) return false;
  // Zoomed all the way out the cache is exactly the viewport, and a strict
  // comparison then misses by a rounding error — which rebuilt it every frame.
  const slackX = cache.rectVw * 1e-6;
  const slackY = cache.rectVh * 1e-6;
  return visibleRect.minX >= cache.rectVx - slackX && visibleRect.maxX <= cache.rectVx + cache.rectVw + slackX &&
    visibleRect.minY >= cache.rectVy - slackY && visibleRect.maxY <= cache.rectVy + cache.rectVh + slackY &&
    screenPixelsPerUnit <= cache.builtForPixelsPerUnit * MAX_CACHE_UPSCALE;
}

// ---------- A hand-coloured atlas ----------
// Each power is a light wash over its land, and a strong band of the same
// colour just inside its border -- the way an atlas colourist worked, and the
// reason the relief still reads through the fills. The band is a wide stroke
// along the province's outer edges, clipped to the province, so only its
// inner half shows and neighbours never paint over one another.

const _outerEdgeCache = new WeakMap<PoliticalMapState, Map<string, Path2D>>();

/** Each owned province's edges that face another power, unclaimed land or the sea. */
function outerEdges(political: PoliticalMapState): Map<string, Path2D> {
  const cached = _outerEdgeCache.get(political);
  if (cached) return cached;
  const pieces = new Map<string, string[]>();
  const add = (provinceId: string, svgPath: string) => {
    const list = pieces.get(provinceId);
    if (list) list.push(svgPath); else pieces.set(provinceId, [svgPath]);
  };
  for (const segment of political.borderSegments) {
    if (segment.classification === "internal_province") continue;
    if (political.ownerByProvince.get(segment.provinceA)) add(segment.provinceA, segment.svgPath);
    if (segment.provinceB !== null && political.ownerByProvince.get(segment.provinceB)) add(segment.provinceB, segment.svgPath);
  }
  const edges = new Map([...pieces].map(([id, paths]) => [id, new Path2D(paths.join(""))]));
  _outerEdgeCache.set(political, edges);
  return edges;
}

function fillProvinces(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, world: StaticWorldGeometry, political: PoliticalMapState, provinces: readonly StaticProvince[], devicePixelsPerUnit: number): void {
  const owned: StaticProvince[] = [];
  for (const province of provinces) {
    const owner = political.ownerByProvince.get(province.id);
    if (!owner) continue;
    owned.push(province);
    ctx.fillStyle = politicalColourWithAlpha(owner, ATLAS.washAlpha, political.leaderByPolity);
    ctx.fill(getProvincePath(world, province.id, province.svgPath));
  }
  const edges = outerEdges(political);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const bandDevicePixels = Math.min(ATLAS.bandPixels * dpr, devicePixelsPerUnit * ATLAS.bandShareOfDegree);
  // Twice the band's width: the clip keeps only the half inside.
  ctx.lineWidth = (bandDevicePixels * 2) / devicePixelsPerUnit;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const province of owned) {
    const edge = edges.get(province.id);
    if (!edge) continue;
    ctx.save();
    ctx.clip(getProvincePath(world, province.id, province.svgPath));
    ctx.strokeStyle = politicalColourWithAlpha(political.ownerByProvince.get(province.id)!, ATLAS.bandAlpha, political.leaderByPolity);
    ctx.stroke(edge);
    ctx.restore();
  }
}

function provincesInRect(world: StaticWorldGeometry, rect: VisibleWorldRect): StaticProvince[] {
  // Province bounds are geographic (latitude up); the rect is projected (y = -latitude).
  return world.provinces.filter((p) =>
    p.bounds.minX <= rect.maxX && p.bounds.maxX >= rect.minX &&
    -p.bounds.maxY <= rect.maxY && -p.bounds.minY >= rect.minY,
  );
}

function rebuildFillCache(
  visibleRect: VisibleWorldRect,
  screenPixelsPerUnit: number,
  fullViewBox: string,
  world: StaticWorldGeometry,
  political: PoliticalMapState,
): FillCache {
  const [, , fullVw, fullVh] = fullViewBox.split(" ").map(Number) as [number, number, number, number];
  const visibleW = Math.max(visibleRect.maxX - visibleRect.minX, Number.EPSILON);
  const visibleH = Math.max(visibleRect.maxY - visibleRect.minY, Number.EPSILON);
  // As much padding as the pixel budget allows at the target resolution, but
  // never less than the viewport itself.
  const maxSpan = OFFSCREEN_MAX / (screenPixelsPerUnit * FILL_CACHE_RESOLUTION);
  const rectVw = Math.max(visibleW, Math.min(fullVw, visibleW * (1 + 2 * OFFSCREEN_PAD), maxSpan));
  const rectVh = Math.max(visibleH, Math.min(fullVh, visibleH * (1 + 2 * OFFSCREEN_PAD), maxSpan));
  const rectVx = (visibleRect.minX + visibleRect.maxX) / 2 - rectVw / 2;
  const rectVy = (visibleRect.minY + visibleRect.maxY) / 2 - rectVh / 2;
  const pixelsPerUnit = Math.min(OFFSCREEN_MAX / rectVw, OFFSCREEN_MAX / rectVh, screenPixelsPerUnit * FILL_CACHE_RESOLUTION);
  const offw = Math.max(1, Math.round(rectVw * pixelsPerUnit));
  const offh = Math.max(1, Math.round(rectVh * pixelsPerUnit));

  // One canvas, reused: allocating a fresh 4096px texture per rebuild was
  // tens of megabytes of garbage each time.
  const canvas = _fillCache?.canvas ?? new OffscreenCanvas(offw, offh);
  if (canvas.width !== offw || canvas.height !== offh) { canvas.width = offw; canvas.height = offh; }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, offw, offh);
  ctx.setTransform(pixelsPerUnit, 0, 0, pixelsPerUnit, -rectVx * pixelsPerUnit, -rectVy * pixelsPerUnit);
  const rect = { minX: rectVx, maxX: rectVx + rectVw, minY: rectVy, maxY: rectVy + rectVh };
  fillProvinces(ctx, world, political, provincesInRect(world, rect), pixelsPerUnit);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  _fillCache = { canvas, world, political, rectVx, rectVy, rectVw, rectVh, builtForPixelsPerUnit: screenPixelsPerUnit };
  return _fillCache;
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
  baseImage: ImageBitmap | null,
  detailImage: ImageBitmap | null,
  overlay: DynamicMapOverlay | null,
  forceFlagUrls: ReadonlyMap<string, ForceFlagAsset>,
  selectedProvinceId: string | null,
  hoveredProvinceId: string | null,
  interacting: boolean,
  requestRedraw: () => void,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || containerW === 0 || containerH === 0) return;

  const dpr = window.devicePixelRatio || 1;
  // Every fixed on-screen size below (markers, names, label floors, army
  // standards) is multiplied by this, so a large monitor's map is not dotted
  // with a laptop's specks (see map-display-unit.ts).
  const unit = displayUnit(containerW, containerH);
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

  const visibleRect: VisibleWorldRect = { minX: (0 - bx) / m, maxX: (containerW - bx) / m, minY: (0 - by) / m, maxY: (containerH - by) / m };

  // 1-3 — water and raster images, straight onto the canvas every frame,
  // inside the map's own bounds: beyond them the page shows through.
  ctx.save();
  ctx.beginPath();
  ctx.rect(vx, vy, vw, vh);
  ctx.clip();
  ctx.fillStyle = WATER_FILL;
  ctx.fillRect(vx, vy, vw, vh);
  if (baseImage) ctx.drawImage(baseImage, -180, -90, 360, 180);
  // Detail raster (Mediterranean inset)
  if (detailImage) ctx.drawImage(detailImage, -25, -72, 85, 57);
  ctx.restore();

  // 4-5 — terrain tint + political fill: from the cache when many provinces
  // are visible, directly when few are, or while a gesture has outrun the
  // cache (see the fill cache comment above).
  const visibleProvinces = provincesInRect(world, visibleRect);
  const screenPixelsPerUnit = m * dpr;
  let fillCache: FillCache | null = null;
  if (visibleProvinces.length > DIRECT_RENDER_PROVINCE_THRESHOLD) {
    if (fillCacheCovers(_fillCache, world, political, visibleRect, screenPixelsPerUnit)) fillCache = _fillCache;
    else if (!interacting) fillCache = rebuildFillCache(visibleRect, screenPixelsPerUnit, viewBox, world, political);
  }
  if (fillCache) ctx.drawImage(fillCache.canvas, fillCache.rectVx, fillCache.rectVy, fillCache.rectVw, fillCache.rectVh);
  else fillProvinces(ctx, world, political, visibleProvinces, screenPixelsPerUnit);

  // 6 — rivers (non-scaling stroke: visual width stays constant across zoom)
  ctx.strokeStyle = RIVER_STROKE;
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  for (const river of world.rivers) {
    if (
      river.bounds.minX > visibleRect.maxX || river.bounds.maxX < visibleRect.minX ||
      river.bounds.minY > visibleRect.maxY || river.bounds.maxY < visibleRect.minY
    ) continue;
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

  // Province hover/selection used to be a CSS-transformed SVG overlay. During
  // a zoom gesture the browser rasterised that whole overlay, which made the
  // otherwise sharp border turn into the blurred white band seen in the map.
  // Drawing it in the same device-pixel canvas as the terrain keeps the fill
  // and non-scaling outline crisp at every zoom level.
  const selectionProvinceId = selectedProvinceId ?? hoveredProvinceId;
  if (selectionProvinceId) {
    const province = world.provinceById.get(selectionProvinceId);
    if (province) {
      const selected = selectionProvinceId === selectedProvinceId;
      const path = getProvincePath(world, province.id, province.svgPath);
      const exterior = getProvincePath(world, `${province.id}:exterior`, province.exteriorSvgPath);
      ctx.fillStyle = selected ? "rgb(242 198 109 / 14%)" : "rgb(230 217 190 / 10%)";
      ctx.fill(path);
      ctx.strokeStyle = selected ? ATLAS.selected : ATLAS.hover;
      ctx.lineWidth = (selected ? .75 : .5) / m;
      ctx.lineJoin = "round";
      ctx.stroke(exterior);
    }
  }

  // 8 — political territory name labels, blitted from per-label bitmaps
  // (see map-canvas-labels.ts for why they are not drawn as text per frame)
  drawPoliticalLabels(ctx, political, m, dpr, transform.scale, unit, visibleRect, interacting, requestRedraw);

  // 9-10 — settlements and army/fleet standards (see map-canvas-entities.ts
  // for why these moved off the SVG layer too). `m` is CSS pixels per world
  // degree, the same rate the old SVG floor logic converted through.
  const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  drawSettlements(ctx, world, overlay, transform.scale, m, unit, visibleRect, nowMs);
  drawForces(ctx, world, overlay, forceFlagUrls, transform.scale, m, unit, visibleRect, nowMs, requestRedraw);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
