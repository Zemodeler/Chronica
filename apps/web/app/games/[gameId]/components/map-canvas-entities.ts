import type { DynamicMapOverlay } from "@chronica/shared";
import type { StaticWorldGeometry } from "./world-geometry";
import { leadersOf, politicalColourWithAlpha } from "./political-geometry";
import { resolveMapForcePlacements } from "./map-dynamic-geometry";
import { deriveForceConflictStatuses } from "./map-conflict-state";
import { FALLBACK_FORCE_FLAG, FORCES_VISIBLE_FROM_SCALE, armyStandardBounds, armyStandardWidthForZoom, fannedStandardCentre, type ForceFlagAsset } from "./army-standard";
import { labelFontFamily } from "./map-fonts";
import { ATLAS, TOKENS } from "../../../../lib/palette";

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
// Markers and their names are sized in on-screen pixels, times the display
// unit (map-display-unit.ts), not in world degrees. A world-space size held
// to a pixel floor sat on that floor for most of the zoom range and then shot
// up to its ceiling within a few steps, and it read tiny on a large monitor.
// Instead a marker grows gently with the zoom's octave, from its size zoomed
// all the way out to a ceiling it keeps from about scale 32 inwards:
//
//   radius px = unit * type factor * clamp(9 + 1.4 * log2(scale), 9, 16)
//
// A capital is about 7 px on a laptop's map (unit 0.8) and 12 px on a large
// monitor's (unit 1.3); its star reaches half as far again.
const SETTLEMENT_PIXEL_RADIUS_FAR = 9;
const SETTLEMENT_PIXEL_RADIUS_PER_OCTAVE = 1.4;
const MAX_SETTLEMENT_PIXEL_RADIUS = 16;
// A settlement's name is this many times its marker's radius, so the names
// keep the markers' hierarchy, held between a legible floor and a ceiling so
// it stops growing at deep zoom. A capital's name is about 10 px on a laptop
// and 17 px on a large monitor zoomed out.
const SETTLEMENT_LABEL_FONT_PER_RADIUS = 13 / 9;
const MIN_SETTLEMENT_LABEL_PIXEL_FONT = 7;
const MAX_SETTLEMENT_LABEL_PIXEL_FONT = 18;
// Name sizes are held to half-pixel steps: a size that changed a little every
// frame of a zoom would have the browser rasterise each name afresh each frame.
const SETTLEMENT_LABEL_FONT_STEP = .5;
// Screen-pixel gap between a marker's edge and the top of its label, times
// the display unit. Pixel-based rather than a world-space offset, which would
// balloon at high zoom and detach the name from its city.
const SETTLEMENT_LABEL_GAP_PIXELS = 3;
// The share of the font size a name's letters rise above the baseline.
const SETTLEMENT_LABEL_ASCENT = .75;
// Every capital's name claims its space before any other's; among capitals,
// and among the rest, the more important goes first.
const CAPITAL_LABEL_PRIORITY = 1_000_000;

// Mirrors MapViewport's zoom bands (far < 2.5 <= medium < 5 <= close) and the
// same-named CSS zoom-visibility rules that used to gate the SVG settlement
// layer (styles/map.css): at "far" zoom only capitals show, with their
// names; at "medium" towns and the like stay hidden and only capitals keep
// their label; "close" shows everything.
const MEDIUM_ZOOM_SCALE = 2.5;
const CLOSE_ZOOM_SCALE = 5;

// Towns in ink on the plate, like the region names; capitals ringed in lamp
// gold; anything under siege or in battle in the war red. See lib/palette.ts.
const SETTLEMENT_DEFAULT_FILL = TOKENS.papyrus;
const SETTLEMENT_STROKE = TOKENS.ink;
const CAPITAL_STROKE = TOKENS.lamp;
const SETTLEMENT_LABEL_FILL = ATLAS.label;
const SETTLEMENT_LABEL_HALO = ATLAS.labelHalo;
const SIEGE_STROKE = ATLAS.war;
const CONFLICT_COMBAT_STROKE = ATLAS.war;
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

// Each type's share of a capital's marker: the square root of their world
// radii, so the hierarchy (capital > port/fort > city > village > town) holds
// without a town shrinking to a speck.
function settlementTypeFactor(type: string): number {
  return Math.sqrt(settlementTypeBaseRadius(type) / settlementTypeBaseRadius("capital"));
}

/** A settlement marker's radius in CSS pixels at `scale`, for display unit `unit`. */
export function settlementPixelRadius(type: string, scale: number, unit: number): number {
  const octaves = Math.log2(Math.max(scale, 1));
  const grown = Math.min(Math.max(SETTLEMENT_PIXEL_RADIUS_FAR + SETTLEMENT_PIXEL_RADIUS_PER_OCTAVE * octaves, SETTLEMENT_PIXEL_RADIUS_FAR), MAX_SETTLEMENT_PIXEL_RADIUS);
  return unit * settlementTypeFactor(type) * grown;
}

/** A settlement name's font size in CSS pixels at `scale`, for display unit `unit`. */
export function settlementLabelPixelFont(type: string, scale: number, unit: number): number {
  const size = Math.min(Math.max(settlementPixelRadius(type, scale, unit) * SETTLEMENT_LABEL_FONT_PER_RADIUS, MIN_SETTLEMENT_LABEL_PIXEL_FONT * unit), MAX_SETTLEMENT_LABEL_PIXEL_FONT * unit);
  return Math.round(size / SETTLEMENT_LABEL_FONT_STEP) * SETTLEMENT_LABEL_FONT_STEP;
}

/**
 * A capital's name is drawn at every zoom only if the place is large enough to
 * matter on the whole map; the many small powers' capitals keep their star and
 * are named once the player has zoomed in (from the medium band). With six
 * thousand provinces the far view otherwise carried dozens of illegible names.
 */
export const FAR_CAPITAL_LABEL_MIN_IMPORTANCE = 70;

/** Whether a settlement's name is drawn at `scale`: a great capital's always, any other capital's from medium zoom, any other's from close zoom. */
export function settlementLabelShown(capital: boolean, scale: number, importance = 100): boolean {
  if (scale >= CLOSE_ZOOM_SCALE) return true;
  return capital && (scale >= MEDIUM_ZOOM_SCALE || importance >= FAR_CAPITAL_LABEL_MIN_IMPORTANCE);
}

/** A letter of a settlement name is about this share of its font size wide, for reserving its room. */
const SETTLEMENT_LABEL_CHARACTER_WIDTH = .6;

/**
 * The room each visible settlement's marker and name take, in world units, so
 * the political names (map-canvas-labels.ts) are laid out around them rather
 * than under them. It follows drawSettlements' own rules for what is shown.
 * `pixelsPerDegree` is CSS pixels per world degree.
 */
export function settlementObstacles(world: StaticWorldGeometry, overlay: DynamicMapOverlay | null, scale: number, pixelsPerDegree: number, unit: number): { minX: number; minY: number; maxX: number; maxY: number }[] {
  const capitalIds = new Set((overlay?.settlements ?? []).filter((s) => s.capitalPolityId !== null && s.capitalPolityId !== undefined).map((s) => s.settlementId));
  const importanceById = new Map((overlay?.settlements ?? []).map((s) => [s.settlementId, s.importance]));
  const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
  for (const settlement of world.settlements) {
    const capital = capitalIds.has(settlement.id);
    if (!capital) {
      if (scale < MEDIUM_ZOOM_SCALE) continue;
      if (scale < CLOSE_ZOOM_SCALE && (settlement.type === "town" || settlement.type === "village" || settlement.type === "fort" || settlement.type === "port")) continue;
    }
    const [x, y] = settlement.projected;
    const radius = settlementPixelRadius(settlement.type, scale, unit) / pixelsPerDegree;
    const reach = capital ? radius * 1.5 : radius;
    boxes.push({ minX: x - reach, maxX: x + reach, minY: y - reach, maxY: y + reach });
    if (!settlementLabelShown(capital, scale, importanceById.get(settlement.id))) continue;
    const fontSize = settlementLabelPixelFont(settlement.type, scale, unit) / pixelsPerDegree;
    const halfWidth = settlement.name.length * fontSize * SETTLEMENT_LABEL_CHARACTER_WIDTH / 2;
    const baseline = y + reach + SETTLEMENT_LABEL_GAP_PIXELS * unit / pixelsPerDegree + fontSize * SETTLEMENT_LABEL_ASCENT;
    boxes.push({ minX: x - halfWidth, maxX: x + halfWidth, minY: baseline - fontSize, maxY: baseline });
  }
  return boxes;
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
  unit: number,
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

    const radius = settlementPixelRadius(settlement.type, scale, unit) / pixelsPerDegree;
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

    // Capitals are named at every zoom, the whole world included; other
    // settlements only once close.
    if (!settlementLabelShown(capital, scale, state?.importance)) continue;

    const labelSize = settlementLabelPixelFont(settlement.type, scale, unit) / pixelsPerDegree;
    // The baseline sits below the marker (a capital's star reaches 1.5 radii)
    // by the gap plus the letters' own height, so the name never overprints it.
    const markerReach = capital ? radius * 1.5 : radius;
    const labelY = y + markerReach + SETTLEMENT_LABEL_GAP_PIXELS * unit / pixelsPerDegree + labelSize * SETTLEMENT_LABEL_ASCENT;
    labelCandidates.push({ name: settlement.name, x, labelY, fontSize: labelSize, priority: (capital ? CAPITAL_LABEL_PRIORITY : 0) + (state?.importance ?? 50) });
  }

  // Most important settlement (capitals first, then by importance) claims
  // its screen space first; anything whose name would overlap an
  // already-placed one is dropped rather than drawn on top of it — two
  // stacked, unreadable names side by side is worse than one legible name.
  ctx.strokeStyle = SETTLEMENT_LABEL_HALO;
  ctx.fillStyle = SETTLEMENT_LABEL_FILL;
  const placedBoxes: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (const label of labelCandidates.sort((a, b) => b.priority - a.priority)) {
    ctx.font = `500 ${label.fontSize}px ${labelFontFamily()}`;
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
  unit: number,
  visibleRect: VisibleWorldRect,
  nowMs: number,
  requestRedraw: () => void,
): void {
  // Too far out to draw an army; the hit test (geo-map.tsx) refuses the same.
  if (scale < FORCES_VISIBLE_FROM_SCALE) return;

  const conflictByForceId = deriveForceConflictStatuses(overlay);
  const armyStandardWidth = armyStandardWidthForZoom(pixelsPerDegree, unit);
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
      ctx.lineWidth = 1.2 * unit / pixelsPerDegree;
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
      const badgeRadius = Math.max(4 * unit, armyStandardWidth * pixelsPerDegree * 0.16) / pixelsPerDegree;
      const badgeX = bounds.x + bounds.width - badgeRadius * 0.4;
      const badgeY = bounds.y - badgeRadius * 0.4;
      ctx.beginPath();
      ctx.fillStyle = TOKENS.ink;
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = TOKENS.vellum;
      ctx.font = `600 ${badgeRadius * 1.1}px ${labelFontFamily()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(placement.group.size), badgeX, badgeY);
    }
  }
}
