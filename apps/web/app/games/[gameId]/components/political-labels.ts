import type { PoliticalMapState } from "./political-geometry";

export interface PoliticalLabelLayout { readonly id: string; readonly polityId: string; readonly name: string; readonly pathPoints: readonly [[number, number], [number, number], [number, number]]; readonly pathLength: number; readonly usableLength: number; readonly fontSize: number; readonly priority: number; }

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
// the scale.
const MAX_LABEL_PIXEL_EXTENT = 2200;

/**
 * Converts political component paths into labels. `pixelsPerDegree` — the
 * current on-screen scale, i.e. how many CSS pixels one geographic degree
 * covers — grows a slightly-too-small label up to a legible floor, hides one
 * far too small to read (see MAX_LABEL_GROWTH) or whose characters would
 * overprint, and hides a territory's label once zoomed in past
 * MAX_LABEL_PIXEL_EXTENT; omit it to skip all of that (e.g. in tests that
 * don't care about it).
 *
 * Labels that survive may still collide with one another; the canvas layer
 * resolves that by priority (see map-canvas-labels.ts).
 */
export function derivePoliticalLabels(state: PoliticalMapState, pixelsPerDegree?: number): PoliticalLabelLayout[] {
  const labels: PoliticalLabelLayout[] = [];
  for (const territory of state.territories) for (const [componentIndex, geometry] of territory.componentLabels.entries()) {
    let { usableLength } = geometry;
    let fontSize = geometry.recommendedFontSize;
    if (pixelsPerDegree !== undefined) {
      if (geometry.maxExtent * pixelsPerDegree > MAX_LABEL_PIXEL_EXTENT) continue;
      if (fontSize * pixelsPerDegree * MAX_LABEL_GROWTH < MIN_LABEL_PIXEL_FONT_SIZE) continue;
      if (usableLength * pixelsPerDegree * MAX_LABEL_GROWTH < MIN_LABEL_PIXEL_LENGTH) continue;
      usableLength = Math.max(usableLength, MIN_LABEL_PIXEL_LENGTH / pixelsPerDegree);
      fontSize = Math.max(fontSize, MIN_LABEL_PIXEL_FONT_SIZE / pixelsPerDegree);
      const gaps = territory.name.length - 1;
      if (gaps > 0 && usableLength / gaps < fontSize * MIN_CHARACTER_SPACING) continue;
    }
    labels.push({
      id: `${territory.polityId}:${componentIndex}`,
      polityId: territory.polityId,
      name: territory.name,
      pathPoints: geometry.pathPoints,
      pathLength: geometry.pathLength,
      usableLength,
      fontSize,
      priority: geometry.priority,
    });
  }
  return labels;
}
