import type { DynamicMapOverlay, GeoJsonPosition } from "@chronica/shared";
import { polityColorFromId, polityColorWithAlpha } from "./geo-projection";
import { provinceContains, type SharedBoundary, type StaticProvince, type StaticWorldGeometry, type WorldBounds } from "./world-geometry";

export type BorderClassification = "internal_province" | "country_border" | "coast";
export interface PoliticalBorderSegment extends SharedBoundary { readonly classification: BorderClassification; }
export interface TerritorialComponent { readonly provinceIds: readonly string[]; readonly totalArea: number; readonly weightedCentroid: GeoJsonPosition; readonly bounds: WorldBounds; }
export interface PoliticalLabelGeometry {
  readonly componentId: string;
  readonly anchor: GeoJsonPosition;
  /** Quadratic Bézier points in world longitude/latitude coordinates. */
  readonly pathPoints: readonly [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition];
  readonly pathLength: number;
  readonly usableLength: number;
  readonly territoryArea: number;
  readonly priority: number;
  readonly recommendedFontSize: number;
}
export interface PoliticalTerritory { readonly polityId: string; readonly name: string; readonly colour: string; readonly components: readonly TerritorialComponent[]; readonly primaryComponent: TerritorialComponent; readonly label: PoliticalLabelGeometry; readonly componentLabels: readonly PoliticalLabelGeometry[]; }
export interface PoliticalMapState { readonly ownerByProvince: ReadonlyMap<string, string | null>; readonly territories: readonly PoliticalTerritory[]; readonly borderSegments: readonly PoliticalBorderSegment[]; }
export interface PoliticalOverlayInput { readonly polities: DynamicMapOverlay["polities"]; readonly provinces: DynamicMapOverlay["provinces"]; }

function boundsFor(provinces: readonly StaticProvince[]): WorldBounds { return provinces.reduce<WorldBounds>((bounds, province) => ({ minX: Math.min(bounds.minX, province.bounds.minX), minY: Math.min(bounds.minY, province.bounds.minY), maxX: Math.max(bounds.maxX, province.bounds.maxX), maxY: Math.max(bounds.maxY, province.bounds.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }); }
function componentFor(startId: string, available: Set<string>, world: StaticWorldGeometry): TerritorialComponent { const queue = [startId]; available.delete(startId); const provinceIds: string[] = []; while (queue.length) { const id = queue.pop()!; provinceIds.push(id); for (const neighbor of world.provinceById.get(id)?.neighborIds ?? []) if (available.delete(neighbor)) queue.push(neighbor); } const provinces = provinceIds.map((id) => world.provinceById.get(id)!).filter(Boolean); const totalArea = provinces.reduce((sum, province) => sum + province.area, 0); return { provinceIds: provinceIds.sort(), totalArea, weightedCentroid: [provinces.reduce((sum, province) => sum + province.centroid[0] * province.area, 0) / totalArea, provinces.reduce((sum, province) => sum + province.centroid[1] * province.area, 0) / totalArea], bounds: boundsFor(provinces) }; }
function weightedQuantile(samples: readonly { value: number; weight: number }[], quantile: number) { const sorted = [...samples].sort((a, b) => a.value - b.value); const threshold = sorted.reduce((sum, sample) => sum + sample.weight, 0) * quantile; let cumulative = 0; for (const sample of sorted) { cumulative += sample.weight; if (cumulative >= threshold) return sample.value; } return sorted.at(-1)?.value ?? 0; }
const ROMAN_REPUBLIC_RED = "#7d2027";
export function politicalColourFromId(polityId: string) { return polityId === "rome" ? ROMAN_REPUBLIC_RED : polityColorFromId(polityId); }
export function politicalColourWithAlpha(polityId: string, alpha: number) { return polityId === "rome" ? `${ROMAN_REPUBLIC_RED}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : polityColorWithAlpha(polityId, alpha); }
const LABEL_PATH_COVERAGE = .85;
const MAX_BOUNDARY_SAMPLES = 48;
const PATH_SAMPLES = 30;
// A country name may extend outside its territorial component for at most 5% of
// the sampled route, preserving a natural curve without visibly crossing borders.
const MAX_LABEL_OUTSIDE_BORDER_RATIO = .05;

function componentContains(component: TerritorialComponent, world: StaticWorldGeometry, point: GeoJsonPosition) {
  return component.provinceIds.some((id) => {
    const province = world.provinceById.get(id);
    return province !== undefined && provinceContains(province, point);
  });
}

function quadraticPoint(points: readonly [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition], t: number): GeoJsonPosition {
  const [start, control, end] = points;
  const inverse = 1 - t;
  return [
    inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0],
    inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1],
  ];
}

function distance(first: GeoJsonPosition, second: GeoJsonPosition) {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

function quadraticLength(points: readonly [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition]) {
  let length = 0;
  let previous = points[0];
  for (let index = 1; index <= PATH_SAMPLES; index++) {
    const current = quadraticPoint(points, index / PATH_SAMPLES);
    length += distance(previous, current);
    previous = current;
  }
  return length;
}

function orientPath(points: readonly [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition]): readonly [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition] {
  const [start, control, end] = points;
  const projectedDy = -end[1] - -start[1];
  return end[0] < start[0] || (Math.abs(end[0] - start[0]) < Number.EPSILON && projectedDy < 0)
    ? [end, control, start]
    : points;
}

function componentBoundarySamples(component: TerritorialComponent, world: StaticWorldGeometry): GeoJsonPosition[] {
  const ids = new Set(component.provinceIds);
  const points: GeoJsonPosition[] = [];
  const seen = new Set<string>();
  const boundaries = new Set(component.provinceIds.flatMap((id) => world.boundariesByProvince.get(id) ?? []));
  for (const boundary of boundaries) {
    const firstOwned = ids.has(boundary.provinceA);
    const secondOwned = boundary.provinceB !== null && ids.has(boundary.provinceB);
    if (firstOwned === secondOwned) continue;
    for (const point of boundary.points) {
      const key = `${point[0]},${point[1]}`;
      if (!seen.has(key)) { seen.add(key); points.push(point); }
    }
  }
  if (points.length <= MAX_BOUNDARY_SAMPLES) return points;
  return Array.from({ length: MAX_BOUNDARY_SAMPLES }, (_, index) => points[Math.floor(index * points.length / MAX_BOUNDARY_SAMPLES)]!);
}

function gentleCurve(start: GeoJsonPosition, end: GeoJsonPosition, anchor: GeoJsonPosition): readonly [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition] {
  const midpoint: GeoJsonPosition = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const chordLength = Math.hypot(dx, dy);
  if (chordLength < Number.EPSILON) return [start, midpoint, end];
  const normal: GeoJsonPosition = [-dy / chordLength, dx / chordLength];
  const anchorOffset = (anchor[0] - midpoint[0]) * normal[0] + (anchor[1] - midpoint[1]) * normal[1];
  const bendMagnitude = Math.max(chordLength * .035, Math.min(chordLength * .12, Math.abs(anchorOffset) * .5));
  const bend = Math.sign(anchorOffset || 1) * bendMagnitude;
  return [start, [midpoint[0] + normal[0] * bend, midpoint[1] + normal[1] * bend], end];
}

function longestUsablePath(component: TerritorialComponent, world: StaticWorldGeometry, anchor: GeoJsonPosition) {
  const samples = componentBoundarySamples(component, world);
  let winner: readonly [GeoJsonPosition, GeoJsonPosition, GeoJsonPosition] | null = null;
  let winnerLength = -Infinity;
  for (let first = 0; first < samples.length; first++) for (let second = first + 1; second < samples.length; second++) {
    const candidate = gentleCurve(samples[first]!, samples[second]!, anchor);
    let inside = 0;
    for (let index = 1; index < PATH_SAMPLES; index++) if (componentContains(component, world, quadraticPoint(candidate, index / PATH_SAMPLES))) inside++;
    if (inside / (PATH_SAMPLES - 1) < 1 - MAX_LABEL_OUTSIDE_BORDER_RATIO) continue;
    const length = quadraticLength(candidate);
    if (length > winnerLength) { winner = candidate; winnerLength = length; }
  }
  return winner === null ? null : { points: orientPath(winner), length: winnerLength };
}

function labelGeometry(component: TerritorialComponent, world: StaticWorldGeometry, name: string): PoliticalLabelGeometry {
  const provinces = component.provinceIds.map((id) => world.provinceById.get(id)!).filter(Boolean); const center = component.weightedCentroid; let cxx = 0; let cxy = 0; let cyy = 0;
  for (const province of provinces) { const x = province.centroid[0] - center[0]; const y = province.centroid[1] - center[1]; cxx += province.area * x * x; cxy += province.area * x * y; cyy += province.area * y * y; }
  cxx /= component.totalArea; cxy /= component.totalArea; cyy /= component.totalArea; const discriminant = Math.sqrt((cxx - cyy) ** 2 + 4 * cxy ** 2); const largest = (cxx + cyy + discriminant) / 2; const smallest = (cxx + cyy - discriminant) / 2; const anisotropy = smallest <= Number.EPSILON ? Infinity : largest / smallest;
  let angle = anisotropy >= 1.3 ? Math.atan2(2 * cxy, cxx - cyy) / 2 * 180 / Math.PI : 0; if (angle > 90) angle -= 180; if (angle <= -90) angle += 180;
  const radians = angle * Math.PI / 180; const axisX = Math.cos(radians); const axisY = Math.sin(radians); const projections = provinces.map((province) => ({ value: (province.centroid[0] - center[0]) * axisX + (province.centroid[1] - center[1]) * axisY, weight: province.area })); const availableLength = Math.max(.8, weightedQuantile(projections, .95) - weightedQuantile(projections, .05));
  const anchor = provinces.some((province) => provinceContains(province, center)) ? center : [...provinces].sort((a, b) => ((a.centroid[0] - center[0]) ** 2 + (a.centroid[1] - center[1]) ** 2) - ((b.centroid[0] - center[0]) ** 2 + (b.centroid[1] - center[1]) ** 2))[0]!.centroid; const glyphUnits = Math.max(2, name.length * .64 + Math.max(0, name.length - 1) * .12);
  const fallbackPoints = orientPath([
    [anchor[0] - axisX * availableLength / 2, anchor[1] - axisY * availableLength / 2],
    anchor,
    [anchor[0] + axisX * availableLength / 2, anchor[1] + axisY * availableLength / 2],
  ]);
  const route = longestUsablePath(component, world, anchor) ?? { points: fallbackPoints, length: quadraticLength(fallbackPoints) };
  const usableLength = route.length * LABEL_PATH_COVERAGE;
  // Width is fixed by SVG textLength; use a deliberately restrained height so
  // country names read as cartographic labels rather than oversized banners.
  return { componentId: component.provinceIds.join("+"), anchor, pathPoints: route.points, pathLength: route.length, usableLength, territoryArea: component.totalArea, priority: component.totalArea, recommendedFontSize: usableLength / glyphUnits * .42 };
}

/** Derives ownership, territorial components, borders, and labels without renderer state. */
export function derivePoliticalMapState(world: StaticWorldGeometry, overlay: PoliticalOverlayInput | null): PoliticalMapState {
  const ownerByProvince = new Map<string, string | null>(world.provinces.map((province) => [province.id, null]));
  if (!overlay) return { ownerByProvince, territories: [], borderSegments: world.sharedBoundaries.map((boundary) => ({ ...boundary, classification: boundary.provinceB === null ? "coast" as const : "internal_province" as const })) };
  for (const province of overlay.provinces) if (world.provinceById.has(province.provinceId)) ownerByProvince.set(province.provinceId, province.controllerPolityId);
  const names = new Map(overlay.polities.map((polity) => [polity.polityId, polity.name])); const ownedByPolity = new Map<string, Set<string>>();
  for (const [provinceId, owner] of ownerByProvince) if (owner !== null) { const owned = ownedByPolity.get(owner) ?? new Set<string>(); owned.add(provinceId); ownedByPolity.set(owner, owned); }
  const territories: PoliticalTerritory[] = [];
  for (const [polityId, owned] of ownedByPolity) { const name = names.get(polityId); if (!name) continue; const remaining = new Set(owned); const components: TerritorialComponent[] = []; while (remaining.size) components.push(componentFor(remaining.values().next().value as string, remaining, world)); components.sort((a, b) => b.totalArea - a.totalArea || a.provinceIds[0]!.localeCompare(b.provinceIds[0]!)); const primaryComponent = components[0]!; const componentLabels = components.map((component) => labelGeometry(component, world, name)); territories.push({ polityId, name, colour: politicalColourFromId(polityId), components, primaryComponent, label: componentLabels[0]!, componentLabels }); }
  const borderSegments = world.sharedBoundaries.map((boundary) => { if (boundary.provinceB === null) return { ...boundary, classification: "coast" as const }; const a = ownerByProvince.get(boundary.provinceA) ?? null; const b = ownerByProvince.get(boundary.provinceB) ?? null; return { ...boundary, classification: a !== b ? "country_border" as const : "internal_province" as const }; });
  return { ownerByProvince, territories: territories.sort((a, b) => b.label.priority - a.label.priority), borderSegments };
}
