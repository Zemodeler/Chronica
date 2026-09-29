import { projectCoordinate } from "./geo-projection";
import { derivePoliticalLabels, type PoliticalLabelLayout } from "./political-labels";
import type { PoliticalMapState } from "./political-geometry";
import { labelFontFamily, whenLabelFontReady } from "./map-fonts";
import { FAR_ZOOM_SCALE } from "./map-display-unit";
import { ATLAS } from "../../../../lib/palette";

// Ink on the plate, lifted off the relief by a thin paper-coloured halo.
const LABEL_FILL = ATLAS.label;
const LABEL_HALO = ATLAS.labelHalo;
const CURVE_SAMPLES = 24;

interface VisibleWorldRect { minX: number; maxX: number; minY: number; maxY: number; }

// Political labels used to be SVG <text><textPath> elements — legible and
// nicely curved, but each one is a real DOM node plus a <defs> path, and a
// world with hundreds of small territories meant hundreds of live elements
// repainted on every pan/zoom frame. Drawing them onto the same canvas the
// terrain already uses (see map-canvas-terrain.ts) keeps the exact curved,
// haloed look with zero DOM cost — a draw call vanishes the moment the next
// frame clears the canvas, instead of sitting in the layout tree.
//
// Canvas has no text-on-path primitive, so this walks the label's quadratic
// Bézier (sampled once per label, cheap — see CURVE_SAMPLES) to build an
// arc-length table, then places each character at its own point and
// rotation along that table. Uniform per-character spacing across
// `usableLength` mirrors the old `lengthAdjust="spacing"` behaviour.
function buildArcLengthTable(p0: readonly [number, number], p1: readonly [number, number], p2: readonly [number, number]) {
  const points: [number, number][] = [];
  const cumulative: number[] = [0];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    const mt = 1 - t;
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    points.push([x, y]);
    if (i > 0) cumulative.push(cumulative[i - 1]! + Math.hypot(x - points[i - 1]![0], y - points[i - 1]![1]));
  }
  return { points, cumulative, total: cumulative[CURVE_SAMPLES]! };
}

/** Point and tangent angle at arc-length `dist` along a sampled curve table. */
function pointAtDistance(table: ReturnType<typeof buildArcLengthTable>, dist: number): { x: number; y: number; angle: number } {
  const { points, cumulative, total } = table;
  const clamped = Math.max(0, Math.min(total, dist));
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i]! < clamped) i++;
  const segStart = cumulative[i - 1]!;
  const segEnd = cumulative[i]!;
  const segT = segEnd > segStart ? (clamped - segStart) / (segEnd - segStart) : 0;
  const [x0, y0] = points[i - 1]!;
  const [x1, y1] = points[i]!;
  return { x: x0 + (x1 - x0) * segT, y: y0 + (y1 - y0) * segT, angle: Math.atan2(y1 - y0, x1 - x0) };
}

/**
 * Where each character of a label sits, along its curve. `offset` slides the
 * run of characters along the path from its centred position, in world units;
 * the caller keeps it within the path's spare length (see slideRoom).
 */
function layoutCharacters(label: PoliticalLabelLayout, offset = 0): { char: string; x: number; y: number; angle: number }[] {
  const text = label.name.toUpperCase();
  if (text.length === 0) return [];
  const p0 = projectCoordinate(label.pathPoints[0][0], label.pathPoints[0][1]);
  const p1 = projectCoordinate(label.pathPoints[1][0], label.pathPoints[1][1]);
  const p2 = projectCoordinate(label.pathPoints[2][0], label.pathPoints[2][1]);
  const table = buildArcLengthTable(p0, p1, p2);
  const startDist = (table.total - label.usableLength) / 2 + offset;
  const step = text.length > 1 ? label.usableLength / (text.length - 1) : 0;
  return [...text].map((char, i) => ({ char, ...pointAtDistance(table, text.length === 1 ? table.total / 2 + offset : startDist + i * step) }));
}

function drawCurvedLabel(ctx: OffscreenCanvasRenderingContext2D, label: PoliticalLabelLayout, characters: ReturnType<typeof layoutCharacters>): void {
  ctx.font = `500 ${label.fontSize}px ${labelFontFamily()}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = label.fontSize * .18;
  ctx.strokeStyle = LABEL_HALO;
  ctx.fillStyle = LABEL_FILL;
  for (const { char, x, y, angle } of characters) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeText(char, 0, 0);
    ctx.fillText(char, 0, 0);
    ctx.restore();
  }
}

// ---------- Label bitmap cache ----------
// Drawing the labels straight onto the map canvas was the map's worst lag:
// every character sits at its own angle, and during a zoom at its own new
// size every frame, so the browser could reuse no rendered glyph and
// rasterised each one — outline and halo — from scratch. 1,600 characters
// cost ~140ms a frame at rest and seconds per frame while zooming.
//
// So each label is drawn once into its own small bitmap for a zoom level,
// and a frame only blits those. Levels are eighth-octave steps of the
// screen's resolution; the layout is derived at the level's resolution, so
// a floored (minimum-size) label is at most ~4% off its floor between steps.
// While the map is moving, labels reuse the nearest level they already have;
// new bitmaps are made once it settles. Either way a frame spends at most a
// few milliseconds making them, and the rest follow on later frames.

const LEVELS_PER_OCTAVE = 8;
const MAX_LABEL_BITMAP_PX = 4096;
// How long one frame may spend rasterising new label bitmaps; the rest wait
// for the next frame (a redraw is requested), still shown at a nearby level.
const LABEL_RENDER_BUDGET_MS = 6;
// Levels further than this from the current one are dropped.
const KEEP_LEVELS = LEVELS_PER_OCTAVE * 2;

// ---------- Label placement ----------
// Most important first (a territory's area), a label whose characters would
// overlap one already placed is dropped: a stack of names where every one
// is unreadable is worse than one name you can read. Worked out once per
// zoom level and cached, since it depends on nothing else.
//
// At far zoom the guaranteed set (political-labels.ts) is placed before any
// other name. When two of them collide, both are stepped down toward their
// floor; if that is not enough, the newcomer slides along its path; only
// then is it dropped. The rest fill in around them as before.

// Each character's footprint, as a fraction of the font size either side of
// its anchor. A little wider than the glyph so neighbours keep some air.
const CHARACTER_HALF_BOX = .55;

// Each step down multiplies a colliding guaranteed label's size by this,
// until it reaches its floor.
const GUARANTEED_STEP_DOWN = .85;
// Positions tried either side of the centre when sliding along the path.
const SLIDE_STEPS = 4;
// A backstop on the stepping loop; .85 reaches a fifth of the size in ten.
const MAX_STEPS_DOWN = 12;

export interface PlacedLabel { readonly label: PoliticalLabelLayout; readonly characters: ReturnType<typeof layoutCharacters>; }
interface Box { minX: number; minY: number; maxX: number; maxY: number; }
interface Footprint { readonly entry: PlacedLabel; readonly bounds: Box; readonly boxes: readonly Box[]; }
interface Slot { footprint: Footprint; readonly original: PoliticalLabelLayout; }

const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

function footprint(label: PoliticalLabelLayout, offset = 0): Footprint | null {
  const characters = layoutCharacters(label, offset);
  if (characters.length === 0) return null;
  const half = label.fontSize * CHARACTER_HALF_BOX;
  const boxes = characters.map(({ x, y }) => ({ minX: x - half, minY: y - half, maxX: x + half, maxY: y + half }));
  const bounds = boxes.reduce((acc, b) => ({ minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY), maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY) }));
  return { entry: { label, characters }, bounds, boxes };
}

const collide = (a: Footprint, b: Footprint) => overlaps(a.bounds, b.bounds) && a.boxes.some((box) => overlaps(box, b.bounds) && b.boxes.some((o) => overlaps(box, o)));

/** A label at `factor` of its full size (never below its floor), its characters drawn in along the same path. */
function steppedDown(label: PoliticalLabelLayout, factor: number): PoliticalLabelLayout {
  const floorFactor = label.minFontSize / label.fontSize;
  if (factor >= 1 || floorFactor >= 1) return label;
  // Exactly the floor once clamped, so "at the floor" compares exactly.
  if (factor <= floorFactor) return { ...label, fontSize: label.minFontSize, usableLength: label.usableLength * floorFactor };
  return { ...label, fontSize: label.fontSize * factor, usableLength: label.usableLength * factor };
}

/** How far a label's run of characters may slide either way before leaving its path. */
function slideRoom(label: PoliticalLabelLayout): number {
  return Math.max(0, (label.pathLength - label.usableLength) / 2);
}

function placeGuaranteed(slots: Slot[], label: PoliticalLabelLayout): void {
  const first = footprint(label);
  if (!first) return;
  const blockers = slots.filter((slot) => collide(first, slot.footprint));
  if (blockers.length === 0) { slots.push({ footprint: first, original: label }); return; }
  const others = slots.filter((slot) => !blockers.includes(slot));
  const clear = (candidate: Footprint, shrunk: readonly Footprint[]) => !others.some((slot) => collide(candidate, slot.footprint)) && !shrunk.some((b) => collide(candidate, b));
  const commit = (candidate: Footprint, shrunk: readonly Footprint[]) => {
    blockers.forEach((slot, index) => { slot.footprint = shrunk[index]!; });
    slots.push({ footprint: candidate, original: label });
  };
  // Step the newcomer and every label it hits down together, never growing
  // one already stepped further.
  const shrinkBlockers = (factor: number) => blockers.map((slot) => {
    const current = slot.footprint.entry.label;
    const next = steppedDown(slot.original, factor);
    return next.fontSize < current.fontSize ? footprint(next) ?? slot.footprint : slot.footprint;
  });
  let factor = 1;
  let atFloor = label.minFontSize >= label.fontSize && blockers.every((slot) => slot.original.minFontSize >= slot.footprint.entry.label.fontSize);
  for (let attempt = 0; !atFloor && attempt < MAX_STEPS_DOWN; attempt++) {
    factor *= GUARANTEED_STEP_DOWN;
    const candidateLabel = steppedDown(label, factor);
    const candidate = footprint(candidateLabel);
    if (!candidate) return;
    const shrunk = shrinkBlockers(factor);
    if (clear(candidate, shrunk)) { commit(candidate, shrunk); return; }
    atFloor = candidateLabel.fontSize <= label.minFontSize && blockers.every((slot) => slot.original.minFontSize >= steppedDown(slot.original, factor).fontSize);
  }
  // At the floor, slide along the path, nearest positions first.
  const floor = steppedDown(label, 0);
  const shrunk = shrinkBlockers(0);
  const room = slideRoom(floor);
  for (let step = 0; step <= SLIDE_STEPS; step++) for (const sign of step === 0 ? [0] : [1, -1]) {
    const candidate = footprint(floor, sign * room * step / SLIDE_STEPS);
    if (candidate && clear(candidate, shrunk)) { commit(candidate, shrunk); return; }
  }
}

/**
 * Chooses which political labels are drawn and where, for one zoom level:
 * the guaranteed set first (see placeGuaranteed), then the rest, most
 * important first, each dropped if it would overlap one already placed.
 */
export function placeLabels(political: PoliticalMapState, cssPixelsPerDegree: number, scale?: number, unit = 1): PlacedLabel[] {
  return placeLabelLayouts(derivePoliticalLabels(political, cssPixelsPerDegree, scale === undefined ? undefined : { scale, unit }));
}

/** placeLabels for labels already derived. */
export function placeLabelLayouts(derived: readonly PoliticalLabelLayout[]): PlacedLabel[] {
  const labels = [...derived].sort((a, b) => b.priority - a.priority);
  const slots: Slot[] = [];
  for (const label of labels) if (label.guaranteed) placeGuaranteed(slots, label);
  for (const label of labels) {
    if (label.guaranteed) continue;
    const candidate = footprint(label);
    if (candidate && !slots.some((slot) => collide(candidate, slot.footprint))) slots.push({ footprint: candidate, original: label });
  }
  return slots.map((slot) => slot.footprint.entry);
}

interface LabelBitmap { readonly canvas: OffscreenCanvas; readonly x: number; readonly y: number; readonly w: number; readonly h: number; }

// political → level key → the placed labels, and their bitmaps by label id.
// A level's key is its zoom step, the display unit and whether it is far zoom
// (where the guaranteed set applies): the same screen resolution lays labels
// out differently on a different-sized map, so a resize never reuses them.
interface LabelLevel { readonly level: number; readonly unit: number; readonly placed: readonly PlacedLabel[]; readonly bitmaps: Map<string, LabelBitmap> }
const _labelCache = new WeakMap<PoliticalMapState, Map<string, LabelLevel>>();
// Bitmaps made before the label face loaded are in the fallback face; they
// are all thrown away once, when it arrives.
let _labelFontReady = false;

function renderLabelBitmap({ label, characters }: PlacedLabel, devicePixelsPerUnit: number): LabelBitmap {
  // Each glyph fits inside a square of its font size around its anchor
  // (uppercase serif plus the halo), whatever its rotation.
  const pad = label.fontSize;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const { x, y } of characters) { minX = Math.min(minX, x - pad); minY = Math.min(minY, y - pad); maxX = Math.max(maxX, x + pad); maxY = Math.max(maxY, y + pad); }
  const w = maxX - minX; const h = maxY - minY;
  const resolution = Math.min(devicePixelsPerUnit, MAX_LABEL_BITMAP_PX / w, MAX_LABEL_BITMAP_PX / h);
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(w * resolution)), Math.max(1, Math.ceil(h * resolution)));
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(resolution, 0, 0, resolution, -minX * resolution, -minY * resolution);
  drawCurvedLabel(ctx, label, characters);
  return { canvas, x: minX, y: minY, w, h };
}

/**
 * Draws political territory name labels onto the terrain canvas.
 * `pixelsPerDegree` is the CSS-pixel-per-world-degree rate (the canvas
 * transform's scale `m`, without devicePixelRatio — the size thresholds in
 * political-labels.ts are calibrated in CSS px). `scale` is the viewport's
 * zoom and `unit` the display unit (map-display-unit.ts).
 */
export function drawPoliticalLabels(
  ctx: CanvasRenderingContext2D,
  political: PoliticalMapState,
  pixelsPerDegree: number,
  dpr: number,
  scale: number,
  unit: number,
  visibleRect: VisibleWorldRect,
  interacting: boolean,
  requestRedraw: () => void,
): void {
  const level = Math.round(Math.log2(pixelsPerDegree * dpr) * LEVELS_PER_OCTAVE);
  const devicePixelsPerUnit = 2 ** (level / LEVELS_PER_OCTAVE);
  let levels = _labelCache.get(political);
  if (!_labelFontReady && whenLabelFontReady(requestRedraw)) {
    _labelFontReady = true;
    levels?.clear();
  }
  if (!levels) { levels = new Map(); _labelCache.set(political, levels); }
  const far = scale < FAR_ZOOM_SCALE;
  const key = `${level}:${unit}:${far ? "far" : "near"}`;
  for (const [cachedKey, cached] of levels) if (Math.abs(cached.level - level) > KEEP_LEVELS || cached.unit !== unit) levels.delete(cachedKey);
  let current = levels.get(key);
  if (!current) { current = { level, unit, placed: placeLabels(political, devicePixelsPerUnit / dpr, scale, unit), bitmaps: new Map() }; levels.set(key, current); }
  const nearestLevels = [...levels.values()].filter((l) => l !== current).sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level));

  const deadline = performance.now() + LABEL_RENDER_BUDGET_MS;
  let deferred = false;
  for (const entry of current.placed) {
    const { label } = entry;
    const [mx, my] = projectCoordinate(label.pathPoints[1][0], label.pathPoints[1][1]);
    if (mx < visibleRect.minX || mx > visibleRect.maxX || my < visibleRect.minY || my > visibleRect.maxY) continue;
    let bitmap = current.bitmaps.get(label.id);
    if (bitmap === undefined) {
      const fallback = nearestLevels.map((l) => l.bitmaps.get(label.id)).find((b) => b !== undefined);
      // While moving, only a label with nothing to show yet gets a new
      // bitmap; one that is over budget appears a frame or two later.
      if ((!interacting || fallback === undefined) && performance.now() < deadline) {
        bitmap = renderLabelBitmap(entry, devicePixelsPerUnit);
        current.bitmaps.set(label.id, bitmap);
      } else {
        bitmap = fallback;
        deferred = true;
      }
    }
    if (bitmap) ctx.drawImage(bitmap.canvas, bitmap.x, bitmap.y, bitmap.w, bitmap.h);
  }
  // Finish the rest on following frames. A gesture keeps painting frames of
  // its own, and its settle repaint picks up whatever is left.
  if (deferred && !interacting) requestRedraw();
}
