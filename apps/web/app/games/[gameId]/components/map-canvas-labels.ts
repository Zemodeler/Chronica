import { projectCoordinate } from "./geo-projection";
import { derivePoliticalLabels, type PoliticalLabelLayout } from "./political-labels";
import type { PoliticalMapState } from "./political-geometry";

const LABEL_FILL = "#f4f0df";
const LABEL_HALO = "rgba(10, 15, 20, 0.78)";
const LABEL_FONT_FAMILY = '"Times New Roman", Times, serif';
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

/** Where each character of a label sits, along its curve. */
function layoutCharacters(label: PoliticalLabelLayout): { char: string; x: number; y: number; angle: number }[] {
  const text = label.name.toUpperCase();
  if (text.length === 0) return [];
  const p0 = projectCoordinate(label.pathPoints[0][0], label.pathPoints[0][1]);
  const p1 = projectCoordinate(label.pathPoints[1][0], label.pathPoints[1][1]);
  const p2 = projectCoordinate(label.pathPoints[2][0], label.pathPoints[2][1]);
  const table = buildArcLengthTable(p0, p1, p2);
  const startDist = (table.total - label.usableLength) / 2;
  const step = text.length > 1 ? label.usableLength / (text.length - 1) : 0;
  return [...text].map((char, i) => ({ char, ...pointAtDistance(table, text.length === 1 ? table.total / 2 : startDist + i * step) }));
}

function drawCurvedLabel(ctx: OffscreenCanvasRenderingContext2D, label: PoliticalLabelLayout, characters: ReturnType<typeof layoutCharacters>): void {
  ctx.font = `bold ${label.fontSize}px ${LABEL_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = label.fontSize * .22;
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

// Each character's footprint, as a fraction of the font size either side of
// its anchor. A little wider than the glyph so neighbours keep some air.
const CHARACTER_HALF_BOX = .55;

interface PlacedLabel { readonly label: PoliticalLabelLayout; readonly characters: ReturnType<typeof layoutCharacters>; }
interface Box { minX: number; minY: number; maxX: number; maxY: number; }

const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

function placeLabels(political: PoliticalMapState, cssPixelsPerDegree: number): PlacedLabel[] {
  const placed: { entry: PlacedLabel; bounds: Box; boxes: Box[] }[] = [];
  for (const label of derivePoliticalLabels(political, cssPixelsPerDegree).sort((a, b) => b.priority - a.priority)) {
    const characters = layoutCharacters(label);
    if (characters.length === 0) continue;
    const half = label.fontSize * CHARACTER_HALF_BOX;
    const boxes = characters.map(({ x, y }) => ({ minX: x - half, minY: y - half, maxX: x + half, maxY: y + half }));
    const bounds = boxes.reduce((acc, b) => ({ minX: Math.min(acc.minX, b.minX), minY: Math.min(acc.minY, b.minY), maxX: Math.max(acc.maxX, b.maxX), maxY: Math.max(acc.maxY, b.maxY) }));
    const collides = placed.some((other) => overlaps(bounds, other.bounds) && boxes.some((box) => overlaps(box, other.bounds) && other.boxes.some((o) => overlaps(box, o))));
    if (!collides) placed.push({ entry: { label, characters }, bounds, boxes });
  }
  return placed.map((p) => p.entry);
}

interface LabelBitmap { readonly canvas: OffscreenCanvas; readonly x: number; readonly y: number; readonly w: number; readonly h: number; }

// political → level → the placed labels, and their bitmaps by label id
interface LabelLevel { readonly placed: readonly PlacedLabel[]; readonly bitmaps: Map<string, LabelBitmap> }
const _labelCache = new WeakMap<PoliticalMapState, Map<number, LabelLevel>>();

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
 * political-labels.ts are calibrated in CSS px).
 */
export function drawPoliticalLabels(
  ctx: CanvasRenderingContext2D,
  political: PoliticalMapState,
  pixelsPerDegree: number,
  dpr: number,
  visibleRect: VisibleWorldRect,
  interacting: boolean,
  requestRedraw: () => void,
): void {
  const level = Math.round(Math.log2(pixelsPerDegree * dpr) * LEVELS_PER_OCTAVE);
  const devicePixelsPerUnit = 2 ** (level / LEVELS_PER_OCTAVE);
  let levels = _labelCache.get(political);
  if (!levels) { levels = new Map(); _labelCache.set(political, levels); }
  for (const cached of levels.keys()) if (Math.abs(cached - level) > KEEP_LEVELS) levels.delete(cached);
  let current = levels.get(level);
  if (!current) { current = { placed: placeLabels(political, devicePixelsPerUnit / dpr), bitmaps: new Map() }; levels.set(level, current); }
  const nearestLevels = [...levels.keys()].filter((l) => l !== level).sort((a, b) => Math.abs(a - level) - Math.abs(b - level));

  const deadline = performance.now() + LABEL_RENDER_BUDGET_MS;
  let deferred = false;
  for (const entry of current.placed) {
    const { label } = entry;
    const [mx, my] = projectCoordinate(label.pathPoints[1][0], label.pathPoints[1][1]);
    if (mx < visibleRect.minX || mx > visibleRect.maxX || my < visibleRect.minY || my > visibleRect.maxY) continue;
    let bitmap = current.bitmaps.get(label.id);
    if (bitmap === undefined) {
      const fallback = nearestLevels.map((l) => levels.get(l)!.bitmaps.get(label.id)).find((b) => b !== undefined);
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
