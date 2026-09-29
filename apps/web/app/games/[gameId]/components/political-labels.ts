import type { GeoJsonPosition } from "@chronica/shared";
import type { PoliticalLabelGeometry, PoliticalMapState, PoliticalTerritory } from "./political-geometry";
import { FAR_ZOOM_SCALE } from "./map-display-unit";

export interface PoliticalLabelLayout {
  readonly id: string;
  readonly polityId: string;
  readonly name: string;
  readonly pathPoints: readonly [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition];
  readonly pathLength: number;
  readonly usableLength: number;
  readonly fontSize: number;
  readonly priority: number;
  /** One of the few polities named at every far zoom: placed first, and stepped down or slid before it is dropped. */
  readonly guaranteed: boolean;
  /** The smallest font size (world units) a guaranteed label may be stepped down to; its own size otherwise. */
  readonly minFontSize: number;
  /** Set in a straight line through the territory's anchor, because its name did not fit along the curve. */
  readonly straight: boolean;
}

// Every on-screen pixel size below is multiplied by the display unit (see
// map-display-unit.ts), so the floors hold their share of the map on any
// screen.
//
// A label whose natural (world-space-derived) size is a little too small to
// read is grown up to these floors. One far below them is hidden instead: a
// tiny territory's name grown to legibility sprawls across its neighbours,
// and zoomed all the way out a few dozen of those piled into unreadable
// smears. It appears once the player zooms in far enough for it to fit.
const MIN_LABEL_PIXEL_LENGTH = 40;
const MIN_LABEL_PIXEL_FONT_SIZE = 7;
// How far below the floors a label may start and still be grown to them.
const MAX_LABEL_GROWTH = 3;
// Characters are spread evenly along the label's path; closer than this
// fraction of the font size apart, they overprint one another.
const MIN_CHARACTER_SPACING = .6;
// A territory label names the WHOLE territory, so it stops making sense
// once you've zoomed in far enough that the territory no longer fits on
// screen — at that point you're looking at a fragment of it, not the
// polity as a whole. Rather than compare against the actual viewport size
// (not available here), this holds a fixed on-screen-pixel ceiling for the
// component's own bounding box: a large territory's world-space extent
// crosses that ceiling at a lower zoom level than a small territory's does,
// so big empires' labels disappear sooner (in zoom terms) and small
// city-states' labels stay up until you're zoomed in much further — exactly
// mirroring the MIN_LABEL_PIXEL_LENGTH floor below, but at the other end of
// the scale. Not scaled by the display unit: it stands for the screen's size.
const MAX_LABEL_PIXEL_EXTENT = 2200;

// ---------- The guaranteed set ----------
// Zoomed all the way out, the thresholds above hid the names of great powers
// whose shape a curve could not run through, and the whole-world view showed
// a handful of names. So at far zoom the largest polities (by all the land
// they hold, not their largest piece) are always named: this many, times the
// display unit.
const GUARANTEED_LABELS_PER_UNIT = 12;
// The size a guaranteed name may be stepped down to, in CSS px times the unit.
const GUARANTEED_LABEL_PIXEL_FONT_SIZE = 11;
// A guaranteed name that does not fit along its curve at that size is set
// straight through the territory's anchor instead, overhanging its borders if
// it must (the halo keeps it legible). Characters are this many font sizes
// apart, and the line leaves this many font sizes either side to slide in.
const STRAIGHT_LABEL_CHARACTER_ADVANCE = .8;
const STRAIGHT_LABEL_SLIDE_ROOM = 3;
// Along the curve's chord, unless the chord is steeper than this; then level.
const STRAIGHT_LABEL_MAX_TILT = Math.PI / 6;

export interface PoliticalLabelOptions {
  /** The viewport's zoom scale. Below FAR_ZOOM_SCALE each polity is named once, and the guaranteed set applies. */
  readonly scale: number;
  /** The display unit (map-display-unit.ts); 1 when omitted. */
  readonly unit?: number;
}

/** How many polities are always named at far zoom, for display unit `unit`. */
export function guaranteedLabelCount(unit: number): number {
  return Math.round(GUARANTEED_LABELS_PER_UNIT * unit);
}

function polityArea(territory: PoliticalTerritory): number {
  return territory.components.reduce((sum, component) => sum + component.totalArea, 0);
}

/** The polities in the guaranteed set: the largest by total land held. */
export function guaranteedPolityIds(state: PoliticalMapState, unit: number): ReadonlySet<string> {
  const ranked = [...state.territories].sort((a, b) => polityArea(b) - polityArea(a) || a.polityId.localeCompare(b.polityId));
  return new Set(ranked.slice(0, guaranteedLabelCount(unit)).map((territory) => territory.polityId));
}

/** A guaranteed name: along its curve if it fits there at the floor, else straight through the anchor. */
function guaranteedLabel(territory: PoliticalTerritory, geometry: PoliticalLabelGeometry, id: string, priority: number, floorFontSize: number): PoliticalLabelLayout {
  const gaps = territory.name.length - 1;
  const curvedFontSize = Math.max(geometry.recommendedFontSize, floorFontSize);
  const base = { id, polityId: territory.polityId, name: territory.name, priority, guaranteed: true, minFontSize: floorFontSize };
  if (gaps <= 0 || geometry.usableLength / gaps >= curvedFontSize * MIN_CHARACTER_SPACING) {
    return { ...base, pathPoints: geometry.pathPoints, pathLength: geometry.pathLength, usableLength: geometry.usableLength, fontSize: curvedFontSize, straight: false };
  }
  const [start, , end] = geometry.pathPoints;
  // Projected y is -latitude; the chord runs left to right (orientPath).
  let angle = Math.atan2(-(end[1] - start[1]), end[0] - start[0]);
  if (Math.abs(angle) > STRAIGHT_LABEL_MAX_TILT) angle = 0;
  const direction: GeoJsonPosition = [Math.cos(angle), -Math.sin(angle)];
  const usableLength = gaps * floorFontSize * STRAIGHT_LABEL_CHARACTER_ADVANCE;
  const pathLength = usableLength + 2 * STRAIGHT_LABEL_SLIDE_ROOM * floorFontSize;
  const [ax, ay] = geometry.anchor;
  const half = pathLength / 2;
  return {
    ...base,
    id: `${id}:straight`,
    pathPoints: [[ax - direction[0] * half, ay - direction[1] * half], [ax, ay], [ax + direction[0] * half, ay + direction[1] * half]],
    pathLength,
    usableLength,
    fontSize: floorFontSize,
    straight: true,
  };
}

/**
 * Converts political component paths into labels. `pixelsPerDegree` — the
 * current on-screen scale, i.e. how many CSS pixels one geographic degree
 * covers — grows a slightly-too-small label up to a legible floor, hides one
 * far too small to read (see MAX_LABEL_GROWTH) or whose characters would
 * overprint, and hides a territory's label once zoomed in past
 * MAX_LABEL_PIXEL_EXTENT; omit it to skip all of that (e.g. in tests that
 * don't care about it).
 *
 * With `options`, the floors scale by the display unit, and at far zoom each
 * polity is named once, on its largest piece, ranked by all the land it
 * holds; the largest few are the guaranteed set, which bypasses the fit
 * thresholds. Zoomed in, every piece of a polity is labelled on its own.
 *
 * Labels that survive may still collide with one another; the canvas layer
 * resolves that by priority (see map-canvas-labels.ts).
 */
export function derivePoliticalLabels(state: PoliticalMapState, pixelsPerDegree?: number, options?: PoliticalLabelOptions): PoliticalLabelLayout[] {
  const unit = options?.unit ?? 1;
  const far = pixelsPerDegree !== undefined && options !== undefined && options.scale < FAR_ZOOM_SCALE;
  const guaranteed = far ? guaranteedPolityIds(state, unit) : new Set<string>();
  const minPixelLength = MIN_LABEL_PIXEL_LENGTH * unit;
  const minPixelFontSize = MIN_LABEL_PIXEL_FONT_SIZE * unit;
  const labels: PoliticalLabelLayout[] = [];
  for (const territory of state.territories) {
    const components = far ? territory.componentLabels.slice(0, 1) : territory.componentLabels;
    const priority = far ? polityArea(territory) : undefined;
    for (const [componentIndex, geometry] of components.entries()) {
      const id = `${territory.polityId}:${componentIndex}`;
      if (guaranteed.has(territory.polityId)) {
        labels.push(guaranteedLabel(territory, geometry, id, priority!, GUARANTEED_LABEL_PIXEL_FONT_SIZE * unit / pixelsPerDegree!));
        continue;
      }
      let { usableLength } = geometry;
      let fontSize = geometry.recommendedFontSize;
      if (pixelsPerDegree !== undefined) {
        if (geometry.maxExtent * pixelsPerDegree > MAX_LABEL_PIXEL_EXTENT) continue;
        if (fontSize * pixelsPerDegree * MAX_LABEL_GROWTH < minPixelFontSize) continue;
        if (usableLength * pixelsPerDegree * MAX_LABEL_GROWTH < minPixelLength) continue;
        usableLength = Math.max(usableLength, minPixelLength / pixelsPerDegree);
        fontSize = Math.max(fontSize, minPixelFontSize / pixelsPerDegree);
        const gaps = territory.name.length - 1;
        if (gaps > 0 && usableLength / gaps < fontSize * MIN_CHARACTER_SPACING) continue;
      }
      labels.push({
        id,
        polityId: territory.polityId,
        name: territory.name,
        pathPoints: geometry.pathPoints,
        pathLength: geometry.pathLength,
        usableLength,
        fontSize,
        priority: priority ?? geometry.priority,
        guaranteed: false,
        minFontSize: fontSize,
        straight: false,
      });
    }
  }
  return labels;
}
