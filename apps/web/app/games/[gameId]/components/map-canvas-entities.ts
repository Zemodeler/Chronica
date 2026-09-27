import type { DynamicMapOverlay } from "@chronica/shared";
import type { StaticWorldGeometry } from "./world-geometry";
import { leadersOf, politicalColourWithAlpha } from "./political-geometry";
import { resolveMapForcePlacements } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";
import { FALLBACK_FORCE_FLAG, FORCES_VISIBLE_FROM_SCALE, armyStandardBounds, armyStandardWidthForZoom, fannedStandardCentre, type ForceFlagAsset } from "./army-standard";

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
const MIN_SETTLEMENT_LABEL_PIXEL_FONT = 4.5;
// Screen-pixel gap between a marker's edge and its label's baseline. Must be
// pixel-based (divided through by pixelsPerDegree at use, like the radius
// constants above) rather than a flat world-space degree offset — a flat
// degree gap is invisible at low zoom but balloons into a huge on-screen gap
// at high zoom (nothing caps it the way MAX_SETTLEMENT_PIXEL_RADIUS caps the
// marker), which is what made labels read as detached from their city.
const SETTLEMENT_LABEL_GAP_PIXELS = 3;

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

function settlementTypeBaseRadius(type: string): number {
  return type === "capital" ? .06 : type === "city" ? .035 : type === "town" ? .015 : type === "fort" || type === "port" ? .04 : .020;
}

function settlementRadius(type: string, pixelsPerDegree: number): number {
  const base = settlementTypeBaseRadius(type);
  const onScreenPixels = Math.min(Math.max(base * pixelsPerDegree, MIN_SETTLEMENT_PIXEL_RADIUS), MAX_SETTLEMENT_PIXEL_RADIUS);
  return onScreenPixels / pixelsPerDegree;
}

// A settlement's label size scales directly off the same per-type base radius
// used for its marker above, so labels keep the exact size hierarchy the
// markers already have (capital > port/fort > city > village > town). The
// scale factor is calibrated so a capital's label renders at 0.175 world-space
// units — half the former 0.35 world-space size — for every settlement of a
// given type, everywhere, independent of polity ownership or territory shape.
const LABEL_FONT_SIZE_PER_RADIUS_UNIT = 0.175 / settlementTypeBaseRadius("capital");

function settlementLabelBaseFontSize(type: string): number {
  return settlementTypeBaseRadius(type) * LABEL_FONT_SIZE_PER_RADIUS_UNIT;
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
  const leaderByPolity = leadersOf(overlay?.politicalRelations ?? []);
  const showNonCapitals = scale >= MEDIUM_ZOOM_SCALE;
  const showTowns = scale >= CLOSE_ZOOM_SCALE;
  const pulse = pulseOpacity(nowMs);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";

  // Labels are collected here and drawn in a second pass (see below) instead
  // of inline, so two settlements close enough on screen for their names to
  // collide can be resolved by priority (capitals, then importance) rather
  // than just letting whichever iterates second stamp over the first.
  const labelCandidates: { name: string; x: number; labelY: number; fontSize: number; priority: number }[] = [];

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
    const fill = state?.controllerPolityId ? politicalColourWithAlpha(state.controllerPolityId, .9, leaderByPolity) : SETTLEMENT_DEFAULT_FILL;
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
    else if (settlement.type === "fort") { ctx.beginPath(); ctx.rect(x - radius, y - radius, radius * 2, radius * 2); }
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

    const legibleFloor = MIN_SETTLEMENT_LABEL_PIXEL_FONT / pixelsPerDegree;
    const labelSize = Math.max(settlementLabelBaseFontSize(settlement.type), legibleFloor);
    const labelY = y + radius + SETTLEMENT_LABEL_GAP_PIXELS / pixelsPerDegree;
    labelCandidates.push({ name: settlement.name, x, labelY, fontSize: labelSize, priority: capital ? Number.POSITIVE_INFINITY : (state?.importance ?? 50) });
  }

  // Most important settlement (capitals first, then by importance) claims
  // its screen space first; anything whose name would overlap an
  // already-placed one is dropped rather than drawn on top of it — two
  // stacked, unreadable names side by side is worse than one legible name.
  ctx.strokeStyle = SETTLEMENT_LABEL_HALO;
  ctx.fillStyle = SETTLEMENT_LABEL_FILL;
  const placedBoxes: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (const label of labelCandidates.sort((a, b) => b.priority - a.priority)) {
    ctx.font = `500 ${label.fontSize}px ${LABEL_FONT_FAMILY}`;
    const halfWidth = ctx.measureText(label.name).width / 2;
    const box = { minX: label.x - halfWidth, maxX: label.x + halfWidth, minY: label.labelY - label.fontSize, maxY: label.labelY };
    if (placedBoxes.some((p) => box.minX < p.maxX && box.maxX > p.minX && box.minY < p.maxY && box.maxY > p.minY)) continue;
    placedBoxes.push(box);
    ctx.lineWidth = label.fontSize * .22;
    ctx.strokeText(label.name, label.x, label.labelY);
    ctx.fillText(label.name, label.x, label.labelY);
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
  // Too far out to draw an army; the hit test (geo-map.tsx) refuses the same.
  if (scale < FORCES_VISIBLE_FROM_SCALE) return;

  const conflictByForceId = deriveForceConflictStatuses(overlay);
  const armyStandardWidth = armyStandardWidthForZoom(pixelsPerDegree);
  const pulse = pulseOpacity(nowMs);
  const placements = resolveMapForcePlacements(overlay?.forces ?? [], world, overlay ?? null);
  const forceById = new Map((overlay?.forces ?? []).map((force) => [force.forceId, force]));

  for (const placement of placements) {
    // A non-primary member of a deliberate group (docs/19 Phase 3) is
    // represented by its group's one marker only, never drawn twice.
    if (placement.group?.isPrimary === false) continue;
    const force = forceById.get(placement.forceId);
    if (!force) continue;
    const { x, y } = fannedStandardCentre(placement, armyStandardWidth);
    if (x < visibleRect.minX || x > visibleRect.maxX || y < visibleRect.minY || y > visibleRect.maxY) continue;

    const asset = forceFlagUrls.get(force.forceId) ?? FALLBACK_FORCE_FLAG;
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

    // A group's marker (both sides of a battle, or several forces jointly
    // besieging one settlement) carries a small count badge instead of a
    // second flag, per docs/19 Phase 3's "one marker with count/summary".
    if (placement.group && placement.group.size > 1) {
      const badgeRadius = Math.max(4, armyStandardWidth * pixelsPerDegree * 0.16) / pixelsPerDegree;
      const badgeX = bounds.x + bounds.width - badgeRadius * 0.4;
      const badgeY = bounds.y - badgeRadius * 0.4;
      ctx.beginPath();
      ctx.fillStyle = "#1a1a1a";
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `${badgeRadius * 1.1}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(placement.group.size), badgeX, badgeY);
    }
  }
}
