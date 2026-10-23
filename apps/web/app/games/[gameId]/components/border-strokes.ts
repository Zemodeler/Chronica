import type { PoliticalBorderSegment, PoliticalMapState } from "./political-geometry";
import { provinceContains, type StaticWorldGeometry } from "./world-geometry";

/**
 * Which line, if any, a border is drawn with.
 *
 * An atlas of six thousand provinces cannot outline all of them the way it
 * outlines a handful of powers. Two kinds of line share the plate:
 *
 * - the OUTLINE, the strong band inside a power's edge, including where it
 *   faces missing geometry or unclaimed land. Those edges must remain visible
 *   so a country's outline does not stop midway round its territory;
 *   enclosed empty holes are suppressed, leaving only the country's exterior;
 * - the PROVINCE LINE, thin and low in contrast, between provinces of one power
 *   (`internal`), around small detached pieces (`frontier`), and
 *   between unclaimed provinces or around bare ground (`unclaimed`, fainter).
 *
 * A power's detached fragment of fewer than MIN_OUTLINE_PROVINCES provinces,
 * when the power has a larger body elsewhere, is not ringed either: a ring
 * round three provinces is noise, and the wash already says whose they are.
 * Its edges take the frontier line instead.
 */
export type StrokeGroup = "outline" | "internal" | "frontier" | "unclaimed" | "none";

export const MIN_OUTLINE_PROVINCES = 4;

/** The provinces in a power's small detached pieces (never its largest piece). */
export function detachedFragmentProvinces(state: Pick<PoliticalMapState, "territories">): ReadonlySet<string> {
  const fragments = new Set<string>();
  for (const territory of state.territories) {
    for (const component of territory.components) {
      if (component === territory.primaryComponent || component.provinceIds.length >= MIN_OUTLINE_PROVINCES) continue;
      for (const id of component.provinceIds) fragments.add(id);
    }
  }
  return fragments;
}

export function strokeGroupOf(segment: PoliticalBorderSegment, ownerByProvince: ReadonlyMap<string, string | null>, fragments: ReadonlySet<string>, enclosedGaps: ReadonlySet<PoliticalBorderSegment> = new Set()): StrokeGroup {
  if (enclosedGaps.has(segment)) return "none";
  const a = ownerByProvince.get(segment.provinceA) ?? null;
  const b = segment.provinceB === null ? null : ownerByProvince.get(segment.provinceB) ?? null;
  const detached = fragments.has(segment.provinceA) || (segment.provinceB !== null && fragments.has(segment.provinceB));
  switch (segment.classification) {
    case "void": return a === null ? "unclaimed" : "outline";
    case "coast": return a === null ? "none" : detached ? "frontier" : "outline";
    case "country_border":
      if (a === null || b === null) return a === null && b === null ? "unclaimed" : detached ? "frontier" : "outline";
      return detached ? "frontier" : "outline";
    case "internal_province": return a === null ? "unclaimed" : "internal";
  }
}

/** Trace each country's perimeter with owned land on the left. Clockwise
 * loops are holes; hide them only if every edge faces empty land, retaining
 * borders around another country's enclave and gaps open to the exterior.
 */
export function enclosedGapBorders(world: StaticWorldGeometry, state: Pick<PoliticalMapState, "borderSegments" | "ownerByProvince">): ReadonlySet<PoliticalBorderSegment> {
  type Edge = { segment: PoliticalBorderSegment; points: readonly (readonly [number, number])[]; empty: boolean };
  const byOwner = new Map<string, Edge[]>();
  const key = (point: readonly [number, number]) => `${point[0]},${point[1]}`;
  for (const segment of state.borderSegments) {
    const a = state.ownerByProvince.get(segment.provinceA) ?? null;
    const b = segment.provinceB === null ? null : state.ownerByProvince.get(segment.provinceB) ?? null;
    if (a === b) continue;
    for (const [owner, provinceId, other] of [[a, segment.provinceA, b], [b, segment.provinceB, a]] as const) {
      if (owner === null || provinceId === null) continue;
      const province = world.provinceById.get(provinceId);
      if (!province) continue;
      let points = segment.points;
      // Use the longest edge so a tiny or repeated vertex cannot choose the side.
      let longest = 0; let at = 0;
      for (let i = 1; i < points.length; i++) {
        const length = Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
        if (length > longest) { longest = length; at = i; }
      }
      if (longest === 0) continue;
      const first = points[at - 1]!; const last = points[at]!;
      const probe = Math.min(longest * .01, .000001);
      const left: [number, number] = [(first[0] + last[0]) / 2 - (last[1] - first[1]) / longest * probe,
        (first[1] + last[1]) / 2 + (last[0] - first[0]) / longest * probe];
      if (!provinceContains(province, left)) points = [...points].reverse();
      const edges = byOwner.get(owner) ?? [];
      edges.push({ segment, points, empty: other === null });
      byOwner.set(owner, edges);
    }
  }
  const hidden = new Set<PoliticalBorderSegment>();
  for (const edges of byOwner.values()) {
    const outgoing = new Map<string, Edge[]>();
    for (const edge of edges) {
      const start = key(edge.points[0]!);
      const list = outgoing.get(start) ?? [];
      list.push(edge); outgoing.set(start, list);
    }
    const visited = new Set<Edge>();
    for (const start of edges) {
      if (visited.has(start)) continue;
      const loop: Edge[] = []; let current: Edge | undefined = start;
      let area = 0;
      while (current && !visited.has(current)) {
        visited.add(current); loop.push(current);
        const points = current.points;
        for (let i = 1; i < points.length; i++) area += points[i - 1]![0] * points[i]![1] - points[i]![0] * points[i - 1]![1];
        const end = points[points.length - 1]!;
        const previous = points[points.length - 2]!;
        const reverse = Math.atan2(previous[1] - end[1], previous[0] - end[0]);
        const candidates: Edge[] = outgoing.get(key(end)) ?? [];
        // The clockwise successor of the incoming edge keeps this face on the left.
        let turn = Infinity; let next: Edge | undefined;
        for (const candidate of candidates) {
          const direction = candidate.points[1]!; const origin = candidate.points[0]!;
          const angle = Math.atan2(direction[1] - origin[1], direction[0] - origin[0]);
          const clockwise = (reverse - angle + 2 * Math.PI) % (2 * Math.PI);
          if (clockwise < turn) { turn = clockwise; next = candidate; }
        }
        current = next;
      }
      if (current === start && area < -1e-12 && loop.every((edge) => edge.empty)) {
        for (const edge of loop) hidden.add(edge.segment);
      }
    }
  }
  return hidden;
}

/** How the province lines are drawn at `scale`: a faint texture zoomed out, plainly visible from about 4. */
export interface ProvinceLineStyle { readonly tier: number; readonly widthCssPixels: number; readonly alpha: number; }
const LINE_TIERS = 8;
export function provinceLineStyle(scale: number): ProvinceLineStyle {
  const t = Math.min(1, Math.max(0, Math.log2(Math.max(scale, 1)) / 2));
  const tier = Math.round(t * LINE_TIERS);
  const eased = tier / LINE_TIERS;
  return { tier, widthCssPixels: 0.5 + 0.3 * eased, alpha: 0.1 + 0.32 * eased };
}
/** Each group's strength as a share of the style's alpha. */
export const GROUP_STRENGTH: Readonly<Record<"internal" | "frontier" | "unclaimed", number>> = { internal: 1, frontier: 0.8, unclaimed: 0.45 };
/** The engraving's ink: the dark end of the sepia the relief is toned to (lib/palette.ts ATLAS.sepiaDark). */
export const PROVINCE_LINE_RGB = "52 40 28";
