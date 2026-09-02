import type { StaticWorldGeometry } from "./world-geometry";
import { politicalColourWithAlpha, type PoliticalMapState } from "./political-geometry";
import type { ViewportTransform } from "./map-viewport";

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

  // 1 — water background
  ctx.fillStyle = WATER_FILL;
  ctx.fillRect(-180, -90, 360, 180);

  // 2 — base raster image (full world)
  if (baseImage?.complete && baseImage.naturalWidth > 0) {
    ctx.drawImage(baseImage, -180, -90, 360, 180);
  }

  // 3 — detail raster image (Mediterranean inset)
  if (detailImage?.complete && detailImage.naturalWidth > 0) {
    ctx.drawImage(detailImage, -25, -72, 85, 57);
  }

  // 4 — terrain tint (35% dark-olive overlay on land, matching CSS)
  ctx.fillStyle = TERRAIN_TINT;
  for (const province of world.provinces) {
    ctx.fill(getProvincePath(world, province.id, province.svgPath));
  }

  // 5 — political fill (polity colour per owned province)
  for (const province of world.provinces) {
    const owner = political.ownerByProvince.get(province.id);
    if (owner) {
      ctx.fillStyle = politicalColourWithAlpha(owner, 0.76);
      ctx.fill(getProvincePath(world, province.id, province.svgPath));
    }
  }

  // 6 — rivers  (non-scaling stroke: keep visual width constant like SVG's
  //    vector-effect:non-scaling-stroke by dividing by the combined scale m)
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

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
