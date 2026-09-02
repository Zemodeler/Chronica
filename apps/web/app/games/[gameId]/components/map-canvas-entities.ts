import type { DynamicMapOverlay } from "@chronica/shared";
import type { StaticWorldGeometry } from "./world-geometry";
import { politicalColourWithAlpha } from "./political-geometry";
import { resolveForceMapPosition } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";
import { armyStandardBounds, armyStandardWidthForZoom, type ForceFlagAsset } from "./army-standard";

interface VisibleWorldRect { minX: number; maxX: number; minY: number; maxY: number; }

// Settlement markers and army standards used to be SVG shapes/<image>
// elements — easy to hit-test natively, but every visible one was a live DOM
// node repainted by the browser on every pan/zoom frame, on top of the
// terrain canvas already doing the same work underneath. Drawing them here
// instead keeps everything in one paint pass. Click/hover/keyboard
// interaction for forces stays in geo-map.tsx as small invisible SVG hit
// targets positioned with the same math (armyStandardHitBounds) — only the
// visuals moved.
//
// Mirrors the marker/label floor logic that used to live in geo-map.tsx:
// world-space sizes hold a minimum on-screen size so nothing shrinks to
// illegibility when zoomed out. A ceiling is also held on the settlement
// marker (absent from the old SVG version, which just grew unboundedly with
// zoom) — without one, a fixed world-space radius times a very high
// pixels-per-degree rate at max zoom balloons into an oversized, blurry-edged
// blob that swallows whatever's under it.
const MIN_SETTLEMENT_PIXEL_RADIUS = 6;
const MAX_SETTLEMENT_PIXEL_RADIUS = 22;
const MIN_SETTLEMENT_LABEL_PIXEL_FONT = 9;

// Mirrors MapViewport's zoom bands (far < 2.5 <= medium < 5 <= close) and the
// same-named CSS zoom-visibility rules that used to gate the SVG settlement
// layer (styles.css, "Map: zoom-band visibility"): at "far" zoom only
// capitals show, with no labels at all; at "medium" only settlements/towns
// stay hidden and only capitals keep their label; "close" shows everything.
const MEDIUM_ZOOM_SCALE = 2.5;
const CLOSE_ZOOM_SCALE = 5;

const SETTLEMENT_DEFAULT_FILL = "#c8b88a";
const SETTLEMENT_STROKE = "#10151f";
const CAPITAL_STROKE = "#f4cf68";
const SETTLEMENT_LABEL_FILL = "#dce8e5";
const SETTLEMENT_LABEL_HALO = "rgba(10, 15, 20, 0.7)";
const LABEL_FONT_FAMILY = '"Times New Roman", Times, serif';
const SIEGE_STROKE = "#dc5d5d";
const CONFLICT_COMBAT_STROKE = "#dc5d5d";
const CONFLICT_SIEGE_DEFENDER_STROKE = "#72c783";

/** Triangle wave over [.55, 1] with a 1.8s period — matches the CSS
 *  `map-conflict-pulse` keyframes (0%/100% .55 opacity, 50% 1). */
function pulseOpacity(nowMs: number): number {
  const phase = (nowMs % 1800) / 1800;
  const triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  return 0.55 + 0.45 * triangle;
}

function settlementRadius(type: string, pixelsPerDegree: number): number {
  const base = type === "capital" ? .06 : type === "city" ? .035 : type === "town" ? .015 : type === "fort" || type === "port" ? .04 : .020;
  const onScreenPixels = Math.min(Math.max(base * pixelsPerDegree, MIN_SETTLEMENT_PIXEL_RADIUS), MAX_SETTLEMENT_PIXEL_RADIUS);
  return onScreenPixels / pixelsPerDegree;
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  for (let index = 0; index < 10; index++) {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const size = index % 2 === 0 ? radius : radius * .45;
    const px = x + Math.cos(angle) * size;
    const py = y + Math.sin(angle) * size;
    if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Draws settlement markers (capital stars, city diamonds, forts, towns/ports/
 * villages) and their name labels onto the terrain canvas, applying the same
 * zoom-band and viewport culling the SVG layer used to.
 */
export function drawSettlements(
  ctx: CanvasRenderingContext2D,
  world: StaticWorldGeometry,
  overlay: DynamicMapOverlay | null,
  scale: number,
  pixelsPerDegree: number,
  visibleRect: VisibleWorldRect,
  nowMs: number,
): void {
  const settlementOverlay = new Map((overlay?.settlements ?? []).map((s) => [s.settlementId, s]));
  const besiegedSettlementIds = new Set(overlay?.conflicts.sieges.map((siege) => siege.settlementId) ?? []);
  const showNonCapitals = scale >= MEDIUM_ZOOM_SCALE;
  const showTowns = scale >= CLOSE_ZOOM_SCALE;
  const pulse = pulseOpacity(nowMs);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";

  for (const settlement of world.settlements) {
    const [x, y] = settlement.projected;
    if (x < visibleRect.minX || x > visibleRect.maxX || y < visibleRect.minY || y > visibleRect.maxY) continue;

    const state = settlementOverlay.get(settlement.id);
    const capital = state?.capitalPolityId !== null && state?.capitalPolityId !== undefined;
    if (!capital) {
      if (!showNonCapitals) continue;
      if (!showTowns && (settlement.type === "town" || settlement.type === "village" || settlement.type === "fort" || settlement.type === "port")) continue;
    }

    const radius = settlementRadius(settlement.type, pixelsPerDegree);
    const fill = state?.controllerPolityId ? politicalColourWithAlpha(state.controllerPolityId, .9) : SETTLEMENT_DEFAULT_FILL;
    const underSiege = besiegedSettlementIds.has(settlement.id);

    ctx.fillStyle = fill;
    ctx.strokeStyle = underSiege ? SIEGE_STROKE : (capital ? CAPITAL_STROKE : SETTLEMENT_STROKE);
    // Proportional to the (already on-screen-pixel-clamped) radius, not a
    // fixed world-space width: a fixed width scales with zoom exactly like
    // the marker's natural (uncapped) size would have, so once the radius
    // itself is capped at high zoom a fixed stroke keeps growing past it and
    // swallows the whole marker in a thick dark ring. Tying it to `radius`
    // keeps the border a thin, constant fraction of the marker at every zoom.
    ctx.lineWidth = radius * (underSiege ? .3 : .16);
    ctx.globalAlpha = underSiege ? pulse : 1;

    if (capital) drawStar(ctx, x, y, radius * 1.5);
    else if (settlement.type === "city") drawDiamond(ctx, x, y, radius);
    else if (settlement.type === "fort") ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
    else { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); }
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Far zoom: no labels at all. Medium zoom: only capitals keep theirs.
    // (Mirrors the old `[data-zoom="far"] .map-settlement-label` and
    // `[data-zoom="medium"] .map-settlement:not(.map-settlement-capital)
    // .map-settlement-label { display: none; }` rules.)
    if (!showNonCapitals) continue;
    if (!capital && !showTowns) continue;

    const labelSize = Math.max((state?.importance ?? 50) * .0035, MIN_SETTLEMENT_LABEL_PIXEL_FONT / pixelsPerDegree);
    ctx.font = `500 ${labelSize}px ${LABEL_FONT_FAMILY}`;
    ctx.lineWidth = labelSize * .22;
    ctx.strokeStyle = SETTLEMENT_LABEL_HALO;
    ctx.fillStyle = SETTLEMENT_LABEL_FILL;
    const labelY = y + radius + .28;
    ctx.strokeText(settlement.name, x, labelY);
    ctx.fillText(settlement.name, x, labelY);
  }
}

/**
 * Draws army/fleet standards (flag image + conflict frame) onto the terrain
 * canvas. Flag images are loaded lazily and cached by URL; `requestRedraw` is
 * called once an image finishes loading so the next frame can paint it (the
 * force is otherwise skipped that frame, same as the browser deferring an
 * SVG `<image>` paint until its resource loads).
 */
const _flagImageCache = new Map<string, HTMLImageElement>();

function getFlagImage(url: string, requestRedraw: () => void): HTMLImageElement | null {
  let img = _flagImageCache.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => requestRedraw();
    img.src = url;
    _flagImageCache.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function drawForces(
  ctx: CanvasRenderingContext2D,
  world: StaticWorldGeometry,
  overlay: DynamicMapOverlay | null,
  forceFlagUrls: ReadonlyMap<string, ForceFlagAsset>,
  scale: number,
  pixelsPerDegree: number,
  visibleRect: VisibleWorldRect,
  nowMs: number,
  requestRedraw: () => void,
): void {
  // Mirrors `[data-zoom="far"] .layer-forces { display: none; }`.
  if (scale < MEDIUM_ZOOM_SCALE) return;

  const conflictByForceId = deriveForceConflictStatuses(overlay);
  const armyStandardWidth = armyStandardWidthForZoom(pixelsPerDegree);
  const pulse = pulseOpacity(nowMs);

  for (const force of overlay?.forces ?? []) {
    const position = resolveForceMapPosition(force, world);
    if (position === null) continue;
    const { x, y } = position;
    if (x < visibleRect.minX || x > visibleRect.maxX || y < visibleRect.minY || y > visibleRect.maxY) continue;

    const asset = forceFlagUrls.get(force.forceId) ?? { url: "/maps/generic-merchant-ship-standard.png", aspectRatio: 4 / 3 };
    const bounds = armyStandardBounds(asset, x, y, armyStandardWidth);
    const conflict = conflictByForceId.get(force.forceId);

    if (conflict) {
      const stroke = conflict.conflictClass === "siege-defender" ? CONFLICT_SIEGE_DEFENDER_STROKE : CONFLICT_COMBAT_STROKE;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2 / pixelsPerDegree;
      const inset = .002;
      const rx = .006;
      ctx.beginPath();
      ctx.roundRect(bounds.x + inset, bounds.y + inset, bounds.width - inset * 2, bounds.height - inset * 2, rx);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const img = getFlagImage(asset.url, requestRedraw);
    if (img) ctx.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height);
  }
}
