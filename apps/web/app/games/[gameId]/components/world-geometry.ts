import type { GeoJsonGeometry, GeoJsonMap, GeoJsonPosition } from "@chronica/shared";
import { geometryToSvgPath, projectCoordinate } from "./geo-projection";

export interface WorldBounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; }
export interface StaticProvince { readonly id: string; readonly name: string; readonly geometry: GeoJsonGeometry; readonly svgPath: string; /** Only the outside edge of a possibly multi-part territory, for hover/selection outlines. */ readonly exteriorSvgPath: string; readonly area: number; readonly centroid: GeoJsonPosition; readonly bounds: WorldBounds; readonly neighborIds: readonly string[]; /** Other provinces close enough to share a single political label. Never use for game adjacency. */ readonly labelNeighborIds: readonly string[]; }
export interface SharedBoundary { readonly provinceA: string; readonly provinceB: string | null; readonly points: readonly [GeoJsonPosition, GeoJsonPosition]; readonly svgPath: string; }
export interface StaticSettlement { readonly id: string; readonly name: string; readonly type: string; readonly provinceId: string; readonly coordinate: GeoJsonPosition; readonly projected: readonly [number, number]; }
export interface StaticRiver { readonly id: string; readonly className: string; readonly svgPath: string; }
export interface StaticWorldGeometry { readonly provinces: readonly StaticProvince[]; readonly provinceById: ReadonlyMap<string, StaticProvince>; readonly sharedBoundaries: readonly SharedBoundary[]; readonly boundariesByProvince: ReadonlyMap<string, readonly SharedBoundary[]>; readonly settlements: readonly StaticSettlement[]; readonly rivers: readonly StaticRiver[]; }
interface BoundaryOccurrence { readonly provinceId: string; readonly points: readonly [GeoJsonPosition, GeoJsonPosition]; }

function ringCentroid(ring: readonly GeoJsonPosition[]) {
  let twiceArea = 0; let x = 0; let y = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    const [x1, y1] = ring[index]!; const [x2, y2] = ring[index + 1]!; const cross = x1 * y2 - x2 * y1;
    twiceArea += cross; x += (x1 + x2) * cross; y += (y1 + y2) * cross;
  }
  if (Math.abs(twiceArea) < Number.EPSILON) return null;
  return { centroid: [x / (3 * twiceArea), y / (3 * twiceArea)] as GeoJsonPosition, area: Math.abs(twiceArea / 2) };
}

function geometryMetrics(geometry: GeoJsonGeometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  let area = 0; let weightedX = 0; let weightedY = 0; let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const polygon of polygons) {
    const exterior = ringCentroid(polygon[0] ?? []); if (!exterior) continue;
    let polygonArea = exterior.area; let x = exterior.centroid[0] * exterior.area; let y = exterior.centroid[1] * exterior.area;
    for (const hole of polygon.slice(1)) { const metrics = ringCentroid(hole); if (metrics) { polygonArea -= metrics.area; x -= metrics.centroid[0] * metrics.area; y -= metrics.centroid[1] * metrics.area; } }
    if (polygonArea > Number.EPSILON) { area += polygonArea; weightedX += x; weightedY += y; }
    for (const ring of polygon) for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  return { area, centroid: area > Number.EPSILON ? [weightedX / area, weightedY / area] as GeoJsonPosition : [0, 0] as GeoJsonPosition, bounds: { minX, minY, maxX, maxY } };
}

function geometryRings(geometry: GeoJsonGeometry): readonly (readonly GeoJsonPosition[])[] { return geometry.type === "Polygon" ? geometry.coordinates : geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : []; }
function pointKey([x, y]: GeoJsonPosition) { return `${x},${y}`; }
function edgeKey(first: GeoJsonPosition, second: GeoJsonPosition) { const a = pointKey(first); const b = pointKey(second); return a < b ? `${a}|${b}` : `${b}|${a}`; }
function boundaryPath([first, second]: readonly [GeoJsonPosition, GeoJsonPosition]) { const [x1, y1] = projectCoordinate(first[0], first[1]); const [x2, y2] = projectCoordinate(second[0], second[1]); return `M${x1} ${y1}L${x2} ${y2}`; }

/**
 * A generated historical territory may cross several source ADM1 polygons.
 * Draw only edges that occur once so hovering it never exposes those retired
 * source borders as white lines inside the same territory.
 */
function exteriorSvgPath(geometry: GeoJsonGeometry): string {
  const edges = new Map<string, { readonly points: readonly [GeoJsonPosition, GeoJsonPosition]; count: number }>();
  for (const ring of geometryRings(geometry)) for (let index = 1; index < ring.length; index++) {
    const points = [ring[index - 1]!, ring[index]!] as const;
    const key = edgeKey(points[0], points[1]);
    const existing = edges.get(key);
    if (existing) existing.count++;
    else edges.set(key, { points, count: 1 });
  }
  return [...edges.values()].filter((edge) => edge.count === 1).map((edge) => boundaryPath(edge.points)).join("");
}

// Labels should survive tiny gaps between separately sourced boundaries and
// narrow straits, without redefining province adjacency for game rules.
const LABEL_COMPONENT_GAP_DEGREES = .22;
function boundsDistance(first: WorldBounds, second: WorldBounds) {
  const dx = Math.max(0, first.minX - second.maxX, second.minX - first.maxX);
  const dy = Math.max(0, first.minY - second.maxY, second.minY - first.maxY);
  return Math.hypot(dx, dy);
}

/** Compiles immutable GeoJSON into reusable world-space map data. */
export function prepareStaticWorldGeometry(map: GeoJsonMap): StaticWorldGeometry {
  const preliminary: Omit<StaticProvince, "neighborIds" | "labelNeighborIds">[] = []; const boundaries = new Map<string, BoundaryOccurrence[]>(); const settlements: StaticSettlement[] = []; const rivers: StaticRiver[] = [];
  for (const feature of map.features) {
    if (feature.properties.kind === "province") {
      preliminary.push({ id: feature.id, name: feature.properties.name, geometry: feature.geometry, svgPath: geometryToSvgPath(feature.geometry), exteriorSvgPath: exteriorSvgPath(feature.geometry), ...geometryMetrics(feature.geometry) });
      for (const ring of geometryRings(feature.geometry)) for (let index = 0; index < ring.length - 1; index++) { const points = [ring[index]!, ring[index + 1]!] as const; const entries = boundaries.get(edgeKey(points[0], points[1])) ?? []; entries.push({ provinceId: feature.id, points }); boundaries.set(edgeKey(points[0], points[1]), entries); }
    } else if (feature.properties.kind === "settlement" && feature.geometry.type === "Point") {
      const coordinate = feature.geometry.coordinates; settlements.push({ id: feature.id, name: feature.properties.name, type: feature.properties.type, provinceId: feature.properties.provinceId, coordinate, projected: projectCoordinate(coordinate[0], coordinate[1]) });
    } else if (feature.properties.kind === "river") rivers.push({ id: feature.id, className: feature.properties.class, svgPath: geometryToSvgPath(feature.geometry) });
  }
  const neighbors = new Map(preliminary.map((province) => [province.id, new Set<string>()])); const sharedBoundaries: SharedBoundary[] = [];
  for (const occurrences of boundaries.values()) {
    const first = occurrences[0]!; const other = occurrences.find((candidate) => candidate.provinceId !== first.provinceId);
    // A dissolved territory can retain separate source polygons. A repeated
    // edge within that same territory is internal, not a coastline.
    if (other === undefined && occurrences.length > 1) continue;
    if (other) { neighbors.get(first.provinceId)?.add(other.provinceId); neighbors.get(other.provinceId)?.add(first.provinceId); }
    sharedBoundaries.push({ provinceA: first.provinceId, provinceB: other?.provinceId ?? null, points: first.points, svgPath: boundaryPath(first.points) });
  }
  const boundariesByProvince = new Map(preliminary.map((province) => [province.id, [] as SharedBoundary[]]));
  for (const boundary of sharedBoundaries) {
    boundariesByProvince.get(boundary.provinceA)?.push(boundary);
    if (boundary.provinceB !== null) boundariesByProvince.get(boundary.provinceB)?.push(boundary);
  }
  const labelNeighbors = new Map(preliminary.map((province) => [province.id, new Set(neighbors.get(province.id) ?? [])]));
  for (let firstIndex = 0; firstIndex < preliminary.length; firstIndex++) for (let secondIndex = firstIndex + 1; secondIndex < preliminary.length; secondIndex++) {
    const first = preliminary[firstIndex]!; const second = preliminary[secondIndex]!;
    if (boundsDistance(first.bounds, second.bounds) > LABEL_COMPONENT_GAP_DEGREES) continue;
    labelNeighbors.get(first.id)?.add(second.id);
    labelNeighbors.get(second.id)?.add(first.id);
  }
  const provinces = preliminary.map((province) => ({ ...province, neighborIds: [...(neighbors.get(province.id) ?? [])].sort(), labelNeighborIds: [...(labelNeighbors.get(province.id) ?? [])].sort() }));
  return { provinces, provinceById: new Map(provinces.map((province) => [province.id, province])), sharedBoundaries, boundariesByProvince, settlements, rivers };
}

export function provinceContains(province: StaticProvince, point: GeoJsonPosition): boolean {
  const { bounds } = province;
  if (point[0] < bounds.minX || point[0] > bounds.maxX || point[1] < bounds.minY || point[1] > bounds.maxY) return false;
  const polygons = province.geometry.type === "Polygon" ? [province.geometry.coordinates] : province.geometry.type === "MultiPolygon" ? province.geometry.coordinates : [];
  const inRing = (ring: readonly GeoJsonPosition[]) => { let inside = false; for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) { const [x, y] = ring[index]!; const [px, py] = ring[previous]!; if ((y > point[1]) !== (py > point[1]) && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x) inside = !inside; } return inside; };
  return polygons.some((polygon) => polygon[0] !== undefined && inRing(polygon[0]) && !polygon.slice(1).some(inRing));
}
