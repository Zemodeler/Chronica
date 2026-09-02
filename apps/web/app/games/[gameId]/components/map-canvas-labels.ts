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

function drawCurvedLabel(ctx: CanvasRenderingContext2D, label: PoliticalLabelLayout, strokeWidth: number): void {
  const text = label.name.toUpperCase();
  if (text.length === 0) return;
  const p0 = projectCoordinate(label.pathPoints[0][0], label.pathPoints[0][1]);
  const p1 = projectCoordinate(label.pathPoints[1][0], label.pathPoints[1][1]);
  const p2 = projectCoordinate(label.pathPoints[2][0], label.pathPoints[2][1]);
  const table = buildArcLengthTable(p0, p1, p2);
  const startDist = (table.total - label.usableLength) / 2;
  const step = text.length > 1 ? label.usableLength / (text.length - 1) : 0;

  ctx.font = `bold ${label.fontSize}px ${LABEL_FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = LABEL_HALO;
  ctx.fillStyle = LABEL_FILL;

  for (let i = 0; i < text.length; i++) {
    const dist = text.length === 1 ? table.total / 2 : startDist + i * step;
    const { x, y, angle } = pointAtDistance(table, dist);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeText(text[i]!, 0, 0);
    ctx.fillText(text[i]!, 0, 0);
    ctx.restore();
  }
}

/**
 * Draws political territory name labels directly onto the terrain canvas.
 * `pixelsPerDegree` is the CSS-pixel-per-world-degree rate (i.e. the canvas
 * transform's scale factor `m`, without the devicePixelRatio multiplier —
 * the size thresholds in political-labels.ts are calibrated in CSS px).
 */
export function drawPoliticalLabels(
  ctx: CanvasRenderingContext2D,
  political: PoliticalMapState,
  pixelsPerDegree: number,
  visibleRect: VisibleWorldRect,
): void {
  // Every candidate that passes the size/extent filters in
  // derivePoliticalLabels is drawn — no collision-based suppression, so all
  // qualifying territory labels are visible at once, overlaps and all.
  const candidates = derivePoliticalLabels(political, pixelsPerDegree);
  for (const label of candidates) {
    const [mx, my] = projectCoordinate(label.pathPoints[1][0], label.pathPoints[1][1]);
    if (mx < visibleRect.minX || mx > visibleRect.maxX || my < visibleRect.minY || my > visibleRect.maxY) continue;
    drawCurvedLabel(ctx, label, label.fontSize * .22);
  }
}
