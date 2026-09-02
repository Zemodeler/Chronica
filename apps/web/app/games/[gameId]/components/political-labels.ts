import type { PoliticalMapState } from "./political-geometry";

export interface PoliticalLabelLayout { readonly id: string; readonly polityId: string; readonly name: string; readonly pathPoints: readonly [[number, number], [number, number], [number, number]]; readonly pathLength: number; readonly usableLength: number; readonly fontSize: number; readonly priority: number; }

// Below these on-screen sizes a label's natural (world-space-derived) size
// reads as unreadable or cramped noise. These used to be hide thresholds —
// a territory below them simply didn't get a label at all — back when
// labels were live SVG <text>/<textPath> DOM nodes and a few hundred of
// them repainting every pan/zoom frame was a real, measured lag source.
// Labels are canvas fillText calls now (see map-canvas-labels.ts), so that
// DOM-node cost is gone; a few hundred extra canvas text draws per frame is
// cheap. So every territory now always gets a label — these two constants
// just act as a floor that GROWS a too-small label up to a legible size
// instead of discarding it, so nothing ever disappears purely for being
// small (see derivePoliticalLabels).
const MIN_LABEL_PIXEL_LENGTH = 40;
const MIN_LABEL_PIXEL_FONT_SIZE = 7;
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
 * Converts political component paths into visible labels. `pixelsPerDegree`
 * — the current on-screen scale, i.e. how many CSS pixels one geographic
 * degree covers — grows an on-screen-too-small label's font/path length up
 * to a legible floor, and hides a territory's label once zoomed in past
 * MAX_LABEL_PIXEL_EXTENT; omit it to skip both adjustments entirely (e.g. in
 * tests that don't care about them).
 *
 * Every territory gets a label at every zoom level (down to the
 * MAX_LABEL_PIXEL_EXTENT ceiling) — there is no lower size cutoff and no
 * collision-based suppression, so nothing is ever hidden just for being
 * small or for overlapping another territory's label. A large empire's
 * label is already comfortably above the floor even zoomed all the way out
 * (its `usableLength`/font size in world units is large); small ones are
 * grown up to the same floor rather than disappearing, so every territory
 * stays identifiable at any zoom.
 */
export function derivePoliticalLabels(state: PoliticalMapState, pixelsPerDegree?: number): PoliticalLabelLayout[] {
  const labels: PoliticalLabelLayout[] = [];
  for (const territory of state.territories) for (const [componentIndex, geometry] of territory.componentLabels.entries()) {
    if (pixelsPerDegree !== undefined && geometry.maxExtent * pixelsPerDegree > MAX_LABEL_PIXEL_EXTENT) continue;
    const usableLength = pixelsPerDegree === undefined ? geometry.usableLength : Math.max(geometry.usableLength, MIN_LABEL_PIXEL_LENGTH / pixelsPerDegree);
    const fontSize = pixelsPerDegree === undefined ? geometry.recommendedFontSize : Math.max(geometry.recommendedFontSize, MIN_LABEL_PIXEL_FONT_SIZE / pixelsPerDegree);
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

/**
 * The largest on-screen font size at which a polity's own territory name is
 * rendered (a fragmented empire has one label per landmass component; the
 * largest is the one a viewer actually reads as "the kingdom's name").
 * Used to cap settlement labels so a city's name can never outgrow the name
 * of the kingdom it sits in — see drawSettlements in map-canvas-entities.ts.
 */
export function derivePolityLabelFontSizes(state: PoliticalMapState, pixelsPerDegree: number): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const label of derivePoliticalLabels(state, pixelsPerDegree)) {
    const current = sizes.get(label.polityId);
    if (current === undefined || label.fontSize > current) sizes.set(label.polityId, label.fontSize);
  }
  return sizes;
}
