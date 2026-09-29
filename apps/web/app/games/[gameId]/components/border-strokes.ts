import type { PoliticalBorderSegment, PoliticalMapState } from "./political-geometry";

/**
 * Which line, if any, a border is drawn with.
 *
 * An atlas of six thousand provinces cannot outline all of them the way it
 * outlines a handful of powers. Two kinds of line share the plate:
 *
 * - the OUTLINE, the strong band inside a power's edge, only where that edge
 *   faces another power or the sea. Where it faces empty ground (a desert or a
 *   massif the map has cut out) or unclaimed land it draws nothing: an outline
 *   there shattered a territory into hundreds of slivers and rings around
 *   ground nobody had drawn;
 * - the PROVINCE LINE, thin and low in contrast, between provinces of one power
 *   (`internal`), along a power's edge with unclaimed land (`frontier`), and
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

export function strokeGroupOf(segment: PoliticalBorderSegment, ownerByProvince: ReadonlyMap<string, string | null>, fragments: ReadonlySet<string>): StrokeGroup {
  const a = ownerByProvince.get(segment.provinceA) ?? null;
  const b = segment.provinceB === null ? null : ownerByProvince.get(segment.provinceB) ?? null;
  const detached = fragments.has(segment.provinceA) || (segment.provinceB !== null && fragments.has(segment.provinceB));
  switch (segment.classification) {
    case "void": return a === null ? "unclaimed" : "frontier";
    case "coast": return a === null ? "none" : detached ? "frontier" : "outline";
    case "country_border":
      if (a === null || b === null) return "frontier";
      return detached ? "frontier" : "outline";
    case "internal_province": return a === null ? "unclaimed" : "internal";
  }
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
