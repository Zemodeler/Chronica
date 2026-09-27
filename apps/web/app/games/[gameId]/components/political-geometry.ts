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
  /** The component's own bounding box, larger dimension — used to hide the
   *  label once zoomed in far enough that the territory no longer fits the
   *  screen (see MAX_LABEL_PIXEL_EXTENT in political-labels.ts). */
  readonly maxExtent: number;
}
export interface PoliticalTerritory { readonly polityId: string; readonly name: string; readonly colour: string; readonly components: readonly TerritorialComponent[]; readonly primaryComponent: TerritorialComponent; readonly label: PoliticalLabelGeometry; readonly componentLabels: readonly PoliticalLabelGeometry[]; }
export interface PoliticalMapState {
  readonly ownerByProvince: ReadonlyMap<string, string | null>;
  readonly territories: readonly PoliticalTerritory[];
  readonly borderSegments: readonly PoliticalBorderSegment[];
  /** Each ally and the power it follows, so the map can paint a confederation as one family of colours. */
  readonly leaderByPolity: ReadonlyMap<string, string>;
}
export interface PoliticalOverlayInput { readonly polities: DynamicMapOverlay["polities"]; readonly provinces: DynamicMapOverlay["provinces"]; readonly politicalRelations?: DynamicMapOverlay["politicalRelations"]; }

/** Returns only shared country boundaries belonging to an active war pair. */
export function deriveWarBorderPaths(state: PoliticalMapState, wars: DynamicMapOverlay["conflicts"]["wars"]): string {
  const activeWars = new Set(wars.map((war) => `${war.polityAId}:${war.polityBId}`));
  return state.borderSegments.filter((border) => {
    if (border.classification !== "country_border" || border.provinceB === null) return false;
    const a = state.ownerByProvince.get(border.provinceA);
    const b = state.ownerByProvince.get(border.provinceB);
    return a !== null && a !== undefined && b !== null && b !== undefined && activeWars.has(a < b ? `${a}:${b}` : `${b}:${a}`);
  }).map((border) => border.svgPath).join("");
}

function boundsFor(provinces: readonly StaticProvince[]): WorldBounds { return provinces.reduce<WorldBounds>((bounds, province) => ({ minX: Math.min(bounds.minX, province.bounds.minX), minY: Math.min(bounds.minY, province.bounds.minY), maxX: Math.max(bounds.maxX, province.bounds.maxX), maxY: Math.max(bounds.maxY, province.bounds.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }); }
function componentFor(startId: string, available: Set<string>, world: StaticWorldGeometry): TerritorialComponent { const queue = [startId]; available.delete(startId); const provinceIds: string[] = []; while (queue.length) { const id = queue.pop()!; provinceIds.push(id); for (const neighbor of world.provinceById.get(id)?.labelNeighborIds ?? []) if (available.delete(neighbor)) queue.push(neighbor); } const provinces = provinceIds.map((id) => world.provinceById.get(id)!).filter(Boolean); const totalArea = provinces.reduce((sum, province) => sum + province.area, 0); return { provinceIds: provinceIds.sort(), totalArea, weightedCentroid: [provinces.reduce((sum, province) => sum + province.centroid[0] * province.area, 0) / totalArea, provinces.reduce((sum, province) => sum + province.centroid[1] * province.area, 0) / totalArea], bounds: boundsFor(provinces) }; }
function weightedQuantile(samples: readonly { value: number; weight: number }[], quantile: number) { const sorted = [...samples].sort((a, b) => a.value - b.value); const threshold = sorted.reduce((sum, sample) => sum + sample.weight, 0) * quantile; let cumulative = 0; for (const sample of sorted) { cumulative += sample.weight; if (cumulative >= threshold) return sample.value; } return sorted.at(-1)?.value ?? 0; }
const ROMAN_REPUBLIC_RED = "#b21f2d";
const CARTHAGINIAN_PURPLE_BLUE = "#2e245f";
const SYRACUSAN_EARTH = "#80512f";
const MACEDONIAN_BLUE = "#355f91";
const CYRENAIC_GOLD = "#bd9136";
const MAJOR_POLITY_COLOURS: Readonly<Record<string, string>> = {
  rome: ROMAN_REPUBLIC_RED,
  carthage: CARTHAGINIAN_PURPLE_BLUE,
  syracuse: SYRACUSAN_EARTH,
  macedon: MACEDONIAN_BLUE,
  cyrene: CYRENAIC_GOLD,
};
export function politicalColourFromId(polityId: string) { return MAJOR_POLITY_COLOURS[polityId] ?? polityColorFromId(polityId); }

/** Each member of an alliance and the power it follows. */
export function leadersOf(relations: DynamicMapOverlay["politicalRelations"]): ReadonlyMap<string, string> {
  return new Map(relations.map((relation) => [relation.memberPolityId, relation.leaderPolityId]));
}

/**
 * An ally painted as a lighter, softer shade of the power it follows, so Rome's
 * Italy reads at a glance as one confederation of many peoples. Each ally takes
 * its own shade from its id, so neighbouring allies stay apart.
 */
function allyColour(leaderColour: string, allyId: string, alpha: number): string {
  const [hue, saturation, lightness] = hexToHsl(leaderColour);
  let hash = 0x811c9dc5;
  for (let index = 0; index < allyId.length; index++) hash = Math.imul(hash ^ allyId.charCodeAt(index), 0x01000193);
  hash >>>= 0;
  const allyHue = (hue + ((hash & 0xff) / 255) * 16 - 8 + 360) % 360;
  const allySaturation = Math.max(28, saturation * 0.62 + (((hash >>> 8) & 0xff) / 255) * 10);
  const allyLightness = Math.min(70, lightness + 12 + (((hash >>> 16) & 0xff) / 255) * 16);
  return `hsl(${allyHue.toFixed(1)} ${allySaturation.toFixed(1)}% ${allyLightness.toFixed(1)}% / ${alpha})`;
}

function hexToHsl(hex: string): readonly [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness * 100];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60;
  return [hue, saturation * 100, lightness * 100];
}

export function politicalColourWithAlpha(polityId: string, alpha: number, leaderByPolity?: ReadonlyMap<string, string>) {
  const leader = leaderByPolity?.get(polityId);
  const leaderColour = leader === undefined ? undefined : MAJOR_POLITY_COLOURS[leader];
  if (leaderColour !== undefined) return allyColour(leaderColour, polityId, alpha);
  const colour = MAJOR_POLITY_COLOURS[polityId]; return colour === undefined ? polityColorWithAlpha(polityId, alpha) : `${colour}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`; }
const LABEL_PATH_COVERAGE = .85;
// Pair generation/ranking below is O(samples²) but cheap (just a distance
// compare); the expensive containment check only runs on the top few
// ranked candidates until one passes (see longestUsablePath), so this can
// stay high for label-curve quality without a speed cost.
const MAX_BOUNDARY_SAMPLES = 14;
const PATH_SAMPLES = 30;
// A country name may extend outside its territorial component for at most 5% of
// the sampled route, preserving a natural curve without visibly crossing borders.
const MAX_LABEL_OUTSIDE_BORDER_RATIO = .05;

/**
 * Repeated point-in-component tests along one candidate curve land in the
 * same province far more often than not, so trying last winner first turns
 * most of a component's `provinceIds.length` linear scan into O(1) — this
 * matters a lot once a territory spans dozens of small provinces.
 */
function componentContainsTester(component: TerritorialComponent, world: StaticWorldGeometry) {
  const provinces = component.provinceIds.map((id) => world.provinceById.get(id)).filter((province): province is StaticProvince => province !== undefined);
  let hint = 0;
  return (point: GeoJsonPosition): boolean => {
    if (provinces.length === 0) return false;
    if (provinceContains(provinces[hint]!, point)) return true;
    for (let index = 0; index < provinces.length; index++) {
      if (index === hint) continue;
      if (provinceContains(provinces[index]!, point)) { hint = index; return true; }
    }
    return false;
  };
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

/**
 * Finds the longest boundary-to-boundary curve that stays inside the
 * component. The expensive part is the per-candidate containment check
 * (PATH_SAMPLES point-in-territory tests), so instead of running it on
 * every one of the O(samples²) pairs, rank pairs by their cheap chord
 * distance first (longest first) and containment-check in that order,
 * stopping at the first pair that passes — since chord length and curve
 * length track closely, that first success is effectively always the
 * longest valid curve, at a fraction of the containment-test cost.
 */
function longestUsablePath(component: TerritorialComponent, world: StaticWorldGeometry, anchor: GeoJsonPosition) {
  const samples = componentBoundarySamples(component, world);
  const contains = componentContainsTester(component, world);
  const pairsByChordLength: { first: number; second: number }[] = [];
  for (let first = 0; first < samples.length; first++) for (let second = first + 1; second < samples.length; second++) {
    pairsByChordLength.push({ first, second });
  }
  pairsByChordLength.sort((a, b) => distance(samples[b.first]!, samples[b.second]!) - distance(samples[a.first]!, samples[a.second]!));
  const sampleCount = PATH_SAMPLES - 1;
  const maxOutsideAllowed = Math.floor(MAX_LABEL_OUTSIDE_BORDER_RATIO * sampleCount);
  for (const { first, second } of pairsByChordLength) {
    const candidate = gentleCurve(samples[first]!, samples[second]!, anchor);
    let outside = 0;
    // Same accept/reject outcome as scoring every sample and comparing the
    // ratio at the end, but stops as soon as the threshold is unreachable —
    // most candidates here are rejects, so this is where the time goes.
    for (let index = 1; index < PATH_SAMPLES && outside <= maxOutsideAllowed; index++) if (!contains(quadraticPoint(candidate, index / PATH_SAMPLES))) outside++;
    if (outside > maxOutsideAllowed) continue;
    return { points: orientPath(candidate), length: quadraticLength(candidate) };
  }
  return null;
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
  // Width is fixed by SVG textLength, so it already tracks how much of the
  // territory the curve can run through. Height doesn't: a font sized only
  // from the curve's length can still be taller than a thin/small territory
  // is wide, poking the glyphs out past its borders. `smallest` (the minor
  // eigenvalue of the province-centroid covariance, already computed above
  // for the label's rotation) is a rotation-invariant estimate of the
  // territory's extent perpendicular to the label direction — capping the
  // font size to a fraction of that keeps the label's own scale tied to how
  // big the territory actually is, and guarantees it never grows past what
  // the shape can hold.
  // It degenerates to exactly 0 for a single-province component (its only
  // centroid sits exactly on itself, so there's no spread to measure) even
  // though the province obviously still has real width — the component's
  // own bounding box catches that case.
  const boundsExtent = Math.min(component.bounds.maxX - component.bounds.minX, component.bounds.maxY - component.bounds.minY);
  const perpendicularExtent = Math.max(2 * Math.sqrt(Math.max(smallest, 0)), boundsExtent * .5);
  const recommendedFontSize = Math.min(usableLength / glyphUnits * .42, perpendicularExtent * .7);
  const maxExtent = Math.max(component.bounds.maxX - component.bounds.minX, component.bounds.maxY - component.bounds.minY);
  return { componentId: component.provinceIds.join("+"), anchor, pathPoints: route.points, pathLength: route.length, usableLength, territoryArea: component.totalArea, priority: component.totalArea, recommendedFontSize, maxExtent };
}

function provinceSetKey(ids: Iterable<string>): string { return [...ids].sort().join(","); }

/**
 * Derives ownership, territorial components, borders, and labels without
 * renderer state. `previous` is the last state computed for this same
 * `world` (the caller must not pass one computed against a different
 * world/geometry) — any polity whose owned-province set and name are
 * unchanged reuses its old components/label geometry untouched, so a
 * single province changing hands only re-runs the expensive label-curve
 * search for the one or two polities actually affected, not all of them.
 */
export function derivePoliticalMapState(
  world: StaticWorldGeometry,
  overlay: PoliticalOverlayInput | null,
  previous?: PoliticalMapState | null,
  geometryAliases?: ReadonlyMap<string, string>,
): PoliticalMapState {
  const ownerByProvince = new Map<string, string | null>(world.provinces.map((province) => [province.id, null]));
  const leaderByPolity = leadersOf(overlay?.politicalRelations ?? []);
  if (!overlay) return { ownerByProvince, leaderByPolity, territories: [], borderSegments: world.sharedBoundaries.map((boundary) => ({ ...boundary, classification: boundary.provinceB === null ? "coast" as const : "internal_province" as const })) };
  for (const province of overlay.provinces) if (world.provinceById.has(province.provinceId)) ownerByProvince.set(province.provinceId, province.controllerPolityId);
  // A geometry polygon with no gameplay province of its own (several tribal
  // provinces merged onto one real region -- see geometryAliases) never gets
  // an owner from the loop above, since no overlay province carries its
  // exact id. It would otherwise render as permanently unclaimed inside an
  // otherwise fully owned nation. Borrow the controller of any gameplay
  // province known to alias onto it instead.
  const controllerByGameplayId = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
  for (const [gameplayId, geometryId] of geometryAliases ?? []) {
    if (ownerByProvince.get(geometryId) != null) continue;
    if (!world.provinceById.has(geometryId)) continue;
    const controllerId = controllerByGameplayId.get(gameplayId);
    if (controllerId) ownerByProvince.set(geometryId, controllerId);
  }
  const names = new Map(overlay.polities.map((polity) => [polity.polityId, polity.name])); const ownedByPolity = new Map<string, Set<string>>();
  for (const [provinceId, owner] of ownerByProvince) if (owner !== null) { const owned = ownedByPolity.get(owner) ?? new Set<string>(); owned.add(provinceId); ownedByPolity.set(owner, owned); }
  const previousByPolity = new Map((previous?.territories ?? []).map((territory) => [territory.polityId, territory]));
  const territories: PoliticalTerritory[] = [];
  for (const [polityId, owned] of ownedByPolity) {
    const name = names.get(polityId);
    if (!name) continue;
    const previousTerritory = previousByPolity.get(polityId);
    if (previousTerritory && previousTerritory.name === name && provinceSetKey(previousTerritory.components.flatMap((component) => component.provinceIds)) === provinceSetKey(owned)) {
      territories.push(previousTerritory);
      continue;
    }
    const remaining = new Set(owned); const components: TerritorialComponent[] = []; while (remaining.size) components.push(componentFor(remaining.values().next().value as string, remaining, world)); components.sort((a, b) => b.totalArea - a.totalArea || a.provinceIds[0]!.localeCompare(b.provinceIds[0]!)); const primaryComponent = components[0]!; const componentLabels = components.map((component) => labelGeometry(component, world, name)); territories.push({ polityId, name, colour: politicalColourFromId(polityId), components, primaryComponent, label: componentLabels[0]!, componentLabels });
  }
  const borderSegments = world.sharedBoundaries.map((boundary) => { if (boundary.provinceB === null) return { ...boundary, classification: "coast" as const }; const a = ownerByProvince.get(boundary.provinceA) ?? null; const b = ownerByProvince.get(boundary.provinceB) ?? null; return { ...boundary, classification: a !== b ? "country_border" as const : "internal_province" as const }; });
  return { ownerByProvince, leaderByPolity, territories: territories.sort((a, b) => b.label.priority - a.label.priority), borderSegments };
}
