import type { PoliticalMapState } from "./political-geometry";

export type LabelZoomBand = "far" | "medium" | "close";
export interface PoliticalLabelLayout { readonly id: string; readonly polityId: string; readonly name: string; readonly pathPoints: readonly [[number, number], [number, number], [number, number]]; readonly pathLength: number; readonly usableLength: number; readonly fontSize: number; readonly priority: number; }

/** Converts political component paths into visible labels. Labels intentionally have no LOD or collision suppression. */
export function derivePoliticalLabels(state: PoliticalMapState, _zoomBand?: LabelZoomBand): PoliticalLabelLayout[] {
  const labels: PoliticalLabelLayout[] = [];
  for (const territory of state.territories) for (const [componentIndex, geometry] of territory.componentLabels.entries()) {
    labels.push({
      id: `${territory.polityId}:${componentIndex}`,
      polityId: territory.polityId,
      name: territory.name,
      pathPoints: geometry.pathPoints,
      pathLength: geometry.pathLength,
      usableLength: geometry.usableLength,
      fontSize: geometry.recommendedFontSize,
      priority: geometry.priority,
    });
  }
  return labels;
}
