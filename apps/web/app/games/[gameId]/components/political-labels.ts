import type { PoliticalMapState } from "./political-geometry";

export type LabelZoomBand = "far" | "medium" | "close";
export interface PoliticalLabelLayout { readonly polityId: string; readonly name: string; readonly x: number; readonly y: number; readonly angle: number; readonly fontSize: number; readonly letterSpacing: number; readonly priority: number; }
interface Rect { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; }

function overlap(first: Rect, second: Rect) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const shared = width * height;
  return shared / Math.min((first.right - first.left) * (first.bottom - first.top), (second.right - second.left) * (second.bottom - second.top));
}

/** Applies zoom LOD and deterministic, lightweight collision suppression. */
export function derivePoliticalLabels(state: PoliticalMapState, zoomBand: LabelZoomBand): PoliticalLabelLayout[] {
  const minimumArea = zoomBand === "far" ? 7 : zoomBand === "medium" ? 1.5 : .35;
  const accepted: { label: PoliticalLabelLayout; box: Rect }[] = [];
  for (const territory of state.territories) {
    const geometry = territory.label;
    if (geometry.territoryArea < minimumArea || geometry.availableLength < .8) continue;
    const fontSize = geometry.recommendedFontSize;
    const width = territory.name.length * fontSize * .64 + Math.max(0, territory.name.length - 1) * geometry.recommendedTracking;
    const height = fontSize * 1.25;
    const label = { polityId: territory.polityId, name: territory.name, x: geometry.anchor[0], y: -geometry.anchor[1], angle: -geometry.angle, fontSize, letterSpacing: geometry.recommendedTracking, priority: geometry.priority };
    const radians = label.angle * Math.PI / 180;
    const boxWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
    const boxHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
    const box = { left: label.x - boxWidth / 2, right: label.x + boxWidth / 2, top: label.y - boxHeight / 2, bottom: label.y + boxHeight / 2 };
    if (accepted.some((entry) => overlap(entry.box, box) > .3)) continue;
    accepted.push({ label, box });
  }
  return accepted.map((entry) => entry.label);
}
