import type { GeoJsonGeometry, GeoJsonMap, GeoJsonPosition } from "@chronica/shared";
import { geometryToSvgPath, projectCoordinate } from "./geo-projection";

export interface WorldBounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; }
export interface StaticProvince {
  readonly id: string; readonly name: string; readonly geometry: GeoJsonGeometry;
  /** Built on first use: most provinces of a dense map are never drawn on their own. */
  readonly svgPath: string;
  /** Only the outside edge of a possibly multi-part territory, for hover/selection outlines. Built on first use. */
  readonly exteriorSvgPath: string;
  readonly area: number; readonly centroid: GeoJsonPosition; readonly bounds: WorldBounds; readonly neighborIds: readonly string[];
  /** Other provinces close enough to share a single political label. Never use for game adjacency. */
  readonly labelNeighborIds: readonly string[];
}
/**
 * A run of consecutive edges shared by the same two provinces (`provinceB` null on a coast),
 * in the order the provinces' rings list them. `points` are the run's vertices; `svgPath`
 * draws each edge as its own `M..L..` subpath, so a dashed stroke restarts on every edge as it always has.
 */
export interface SharedBoundary { readonly provinceA: string; readonly provinceB: string | null; readonly points: readonly GeoJsonPosition[]; readonly svgPath: string; }
export interface StaticSettlement { readonly id: string; readonly name: string; readonly type: string; readonly provinceId: string; readonly coordinate: GeoJsonPosition; readonly projected: readonly [number, number]; }
export interface StaticRiver { readonly id: string; readonly className: string; readonly svgPath: string; readonly bounds: WorldBounds; }
export interface StaticWorldGeometry { readonly provinces: readonly StaticProvince[]; readonly provinceById: ReadonlyMap<string, StaticProvince>; readonly sharedBoundaries: readonly SharedBoundary[]; readonly boundariesByProvince: ReadonlyMap<string, readonly SharedBoundary[]>; readonly settlements: readonly StaticSettlement[]; readonly rivers: readonly StaticRiver[]; }

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

function geometryBounds(geometry: GeoJsonGeometry): WorldBounds {
  const positions: readonly GeoJsonPosition[] = geometry.type === "Point"
    ? [geometry.coordinates]
    : geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.type === "MultiLineString"
        ? geometry.coordinates.flat()
        : geometry.type === "Polygon"
          ? geometry.coordinates.flat()
          : geometry.coordinates.flat(2);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of positions) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
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

/** A uniform grid over bounding boxes, so a rectangle or a point finds its few candidates instead of scanning every province. */
const GRID_CELL_DEGREES = 0.5;
const gridKey = (cx: number, cy: number) => (cx + 8192) * 16384 + (cy + 8192);
class BoundsGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly stamp: Int32Array;
  private generation = 0;
  constructor(private readonly bounds: readonly WorldBounds[], private readonly cellSize: number) {
    this.stamp = new Int32Array(bounds.length);
    bounds.forEach((box, index) => {
      if (!Number.isFinite(box.minX) || !Number.isFinite(box.maxX) || !Number.isFinite(box.minY) || !Number.isFinite(box.maxY)) return;
      for (let cx = this.cell(box.minX); cx <= this.cell(box.maxX); cx++) for (let cy = this.cell(box.minY); cy <= this.cell(box.maxY); cy++) {
        const key = gridKey(cx, cy);
        const list = this.cells.get(key);
        if (list) list.push(index); else this.cells.set(key, [index]);
      }
    });
  }
  private cell(value: number) { return Math.floor(value / this.cellSize); }
  /** Indices of every box overlapping the rectangle (touching counts), ascending. */
  query(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const found: number[] = [];
    const generation = ++this.generation;
    for (let cx = this.cell(minX); cx <= this.cell(maxX); cx++) for (let cy = this.cell(minY); cy <= this.cell(maxY); cy++) {
      const list = this.cells.get(gridKey(cx, cy));
      if (list === undefined) continue;
      for (const index of list) {
        if (this.stamp[index] === generation) continue;
        this.stamp[index] = generation;
        const box = this.bounds[index]!;
        if (box.minX <= maxX && box.maxX >= minX && box.minY <= maxY && box.maxY >= minY) found.push(index);
      }
    }
    return found.sort((a, b) => a - b);
  }
}
const _grids = new WeakMap<StaticWorldGeometry, BoundsGrid>();
function gridOf(world: StaticWorldGeometry): BoundsGrid {
  let grid = _grids.get(world);
  if (grid === undefined) { grid = new BoundsGrid(world.provinces.map((province) => province.bounds), GRID_CELL_DEGREES); _grids.set(world, grid); }
  return grid;
}

/** Provinces whose bounds meet a geographic rectangle, in draw order. */
export function provincesInRect(world: StaticWorldGeometry, minX: number, minLat: number, maxX: number, maxLat: number): StaticProvince[] {
  return gridOf(world).query(minX, minLat, maxX, maxLat).map((index) => world.provinces[index]!);
}

/** The province under a point: the last drawn by default (it is on top), or the first drawn. */
export function provinceAtPoint(world: StaticWorldGeometry, point: GeoJsonPosition, which: "topmost" | "first" = "topmost"): StaticProvince | undefined {
  const candidates = gridOf(world).query(point[0], point[1], point[0], point[1]);
  if (which === "first") { for (const index of candidates) if (provinceContains(world.provinces[index]!, point)) return world.provinces[index]; return undefined; }
  for (let at = candidates.length - 1; at >= 0; at--) if (provinceContains(world.provinces[candidates[at]!]!, point)) return world.provinces[candidates[at]!];
  return undefined;
}

function once<T>(build: () => T): () => T { let value: T | undefined; let built = false; return () => { if (!built) { value = build(); built = true; } return value as T; }; }

function chainPath(points: readonly GeoJsonPosition[]): string {
  const parts: string[] = [];
  for (let index = 1; index < points.length; index++) parts.push(boundaryPath([points[index - 1]!, points[index]!]));
  return parts.join("");
}

/** Numbers each distinct coordinate pair once. Open addressing over the doubles' own bits: a nested Map of floats spent most of the build here. */
class VertexTable {
  private static readonly view = new DataView(new ArrayBuffer(8));
  private slots = new Int32Array(1 << 16).fill(-1);
  private xs: number[] = []; private ys: number[] = [];
  idOf(x: number, y: number): number {
    const view = VertexTable.view;
    view.setFloat64(0, x); let hash = Math.imul(view.getInt32(0) ^ 0x9e3779b9, 0x85ebca6b) ^ view.getInt32(4);
    view.setFloat64(0, y); hash = Math.imul(hash ^ (hash >>> 15), 0xc2b2ae35) ^ view.getInt32(0); hash = Math.imul(hash ^ (hash >>> 13), 0x27d4eb2f) ^ view.getInt32(4);
    hash ^= hash >>> 16;
    const mask = this.slots.length - 1;
    let slot = hash & mask;
    for (;;) {
      const id = this.slots[slot]!;
      if (id === -1) break;
      if (this.xs[id] === x && this.ys[id] === y) return id;
      slot = (slot + 1) & mask;
    }
    const id = this.xs.length;
    this.xs.push(x); this.ys.push(y);
    this.slots[slot] = id;
    if (this.xs.length * 2 > this.slots.length) this.grow();
    return id;
  }
  private grow() {
    const slots = new Int32Array(this.slots.length * 2).fill(-1); const mask = slots.length - 1;
    const view = VertexTable.view;
    for (let id = 0; id < this.xs.length; id++) {
      view.setFloat64(0, this.xs[id]!); let hash = Math.imul(view.getInt32(0) ^ 0x9e3779b9, 0x85ebca6b) ^ view.getInt32(4);
      view.setFloat64(0, this.ys[id]!); hash = Math.imul(hash ^ (hash >>> 15), 0xc2b2ae35) ^ view.getInt32(0); hash = Math.imul(hash ^ (hash >>> 13), 0x27d4eb2f) ^ view.getInt32(4);
      hash ^= hash >>> 16;
      let slot = hash & mask;
      while (slots[slot] !== -1) slot = (slot + 1) & mask;
      slots[slot] = id;
    }
    this.slots = slots;
  }
}

/** Compiles immutable GeoJSON into reusable world-space map data.
 *
 * `geometryAliases` maps a gameplay province id with no polygon of its own
 * onto the real polygon of the region it falls within (e.g. several tribal
 * client provinces sharing one modern-region polygon). It only extends
 * lookup by id -- it does not add entries to `provinces`, so nothing is
 * drawn twice and no area is double-counted; it exists purely so a force or
 * label at an aliased province still resolves to a real position instead of
 * silently vanishing.
 *
 * Built for maps of thousands of provinces: vertices are interned to integers so an
 * edge is one number, path strings are built when first read, and label neighbours
 * come from a grid rather than comparing every pair.
 */
export function prepareStaticWorldGeometry(map: GeoJsonMap, geometryAliases?: ReadonlyMap<string, string>): StaticWorldGeometry {
  interface Prelim { readonly id: string; readonly name: string; readonly geometry: GeoJsonGeometry; readonly area: number; readonly centroid: GeoJsonPosition; readonly bounds: WorldBounds; }
  const preliminary: Prelim[] = []; const settlements: StaticSettlement[] = []; const rivers: StaticRiver[] = [];

  // Vertices interned by exact coordinates; an edge is the pair of vertex numbers.
  const vertices = new VertexTable();
  const vertexOf = ([x, y]: GeoJsonPosition) => vertices.idOf(x, y);
  // Per edge, in order of first appearance: the province that wrote it first, the first
  // *different* province to write it, how often it was written, and its two ends as first seen.
  const edgeHead: number[] = []; const edgeLink: number[] = []; const edgeHigh: number[] = [];
  const edgeFirst: number[] = []; const edgeOther: number[] = []; const edgeCount: number[] = [];
  const edgeFrom: GeoJsonPosition[] = []; const edgeTo: GeoJsonPosition[] = []; const edgeFromId: number[] = []; const edgeToId: number[] = [];

  for (const feature of map.features) {
    if (feature.properties.kind === "province") {
      const provinceIndex = preliminary.length;
      preliminary.push({ id: feature.id, name: feature.properties.name, geometry: feature.geometry, ...geometryMetrics(feature.geometry) });
      for (const ring of geometryRings(feature.geometry)) {
        let previousId = ring.length > 0 ? vertexOf(ring[0]!) : 0;
        for (let index = 0; index < ring.length - 1; index++) {
          const nextId = vertexOf(ring[index + 1]!);
          const low = previousId < nextId ? previousId : nextId; const high = previousId < nextId ? nextId : previousId;
          let existing = edgeHead[low] ?? -1;
          while (existing !== -1 && edgeHigh[existing] !== high) existing = edgeLink[existing]!;
          if (existing === -1) {
            edgeLink.push(edgeHead[low] ?? -1); edgeHigh.push(high); edgeHead[low] = edgeFirst.length;
            edgeFirst.push(provinceIndex); edgeOther.push(-1); edgeCount.push(1);
            edgeFrom.push(ring[index]!); edgeTo.push(ring[index + 1]!); edgeFromId.push(previousId); edgeToId.push(nextId);
          } else {
            edgeCount[existing]!++;
            if (edgeOther[existing] === -1 && edgeFirst[existing] !== provinceIndex) edgeOther[existing] = provinceIndex;
          }
          previousId = nextId;
        }
      }
    } else if (feature.properties.kind === "settlement" && feature.geometry.type === "Point") {
      const coordinate = feature.geometry.coordinates; settlements.push({ id: feature.id, name: feature.properties.name, type: feature.properties.type, provinceId: feature.properties.provinceId, coordinate, projected: projectCoordinate(coordinate[0], coordinate[1]) });
    } else if (feature.properties.kind === "river") rivers.push({ id: feature.id, className: feature.properties.class, svgPath: geometryToSvgPath(feature.geometry), bounds: geometryBounds(feature.geometry) });
  }

  const neighbors = preliminary.map(() => new Set<number>());
  const sharedBoundaries: SharedBoundary[] = [];
  const boundariesByProvince = new Map(preliminary.map((province) => [province.id, [] as SharedBoundary[]]));
  let run: { a: number; b: number; points: GeoJsonPosition[]; lastId: number } | null = null;
  const closeRun = () => {
    if (run === null) return;
    const points = run.points;
    const path = once(() => chainPath(points));
    const boundary: SharedBoundary = { provinceA: preliminary[run.a]!.id, provinceB: run.b === -1 ? null : preliminary[run.b]!.id, points, get svgPath() { return path(); } };
    sharedBoundaries.push(boundary);
    boundariesByProvince.get(boundary.provinceA)?.push(boundary);
    if (boundary.provinceB !== null) boundariesByProvince.get(boundary.provinceB)?.push(boundary);
    run = null;
  };
  for (let edge = 0; edge < edgeFirst.length; edge++) {
    const a = edgeFirst[edge]!; const b = edgeOther[edge]!;
    // A dissolved territory can retain separate source polygons. A repeated
    // edge within that same territory is internal, not a coastline.
    if (b === -1 && edgeCount[edge]! > 1) continue;
    if (b !== -1) { neighbors[a]!.add(b); neighbors[b]!.add(a); }
    if (run !== null && run.a === a && run.b === b && run.lastId === edgeFromId[edge]) { run.points.push(edgeTo[edge]!); run.lastId = edgeToId[edge]!; continue; }
    closeRun();
    run = { a, b, points: [edgeFrom[edge]!, edgeTo[edge]!], lastId: edgeToId[edge]! };
  }
  closeRun();

  const labelNeighbors = neighbors.map((set) => new Set(set));
  const grid = new BoundsGrid(preliminary.map((province) => province.bounds), GRID_CELL_DEGREES);
  preliminary.forEach((first, firstIndex) => {
    const { minX, minY, maxX, maxY } = first.bounds;
    if (!Number.isFinite(minX)) return;
    for (const secondIndex of grid.query(minX - LABEL_COMPONENT_GAP_DEGREES, minY - LABEL_COMPONENT_GAP_DEGREES, maxX + LABEL_COMPONENT_GAP_DEGREES, maxY + LABEL_COMPONENT_GAP_DEGREES)) {
      if (secondIndex <= firstIndex || boundsDistance(first.bounds, preliminary[secondIndex]!.bounds) > LABEL_COMPONENT_GAP_DEGREES) continue;
      labelNeighbors[firstIndex]!.add(secondIndex);
      labelNeighbors[secondIndex]!.add(firstIndex);
    }
  });
  const idsSorted = (indices: ReadonlySet<number>) => [...indices].map((index) => preliminary[index]!.id).sort();
  const provinces = preliminary.map((province, index): StaticProvince => {
    const svgPath = once(() => geometryToSvgPath(province.geometry));
    const exterior = once(() => exteriorSvgPath(province.geometry));
    return { ...province, get svgPath() { return svgPath(); }, get exteriorSvgPath() { return exterior(); }, neighborIds: idsSorted(neighbors[index]!), labelNeighborIds: idsSorted(labelNeighbors[index]!) };
  });
  const provinceById = new Map(provinces.map((province) => [province.id, province]));
  for (const [aliasId, realId] of geometryAliases ?? []) {
    if (provinceById.has(aliasId)) continue;
    const real = provinceById.get(realId);
    if (real) provinceById.set(aliasId, real);
  }
  return { provinces, provinceById, sharedBoundaries, boundariesByProvince, settlements, rivers };
}

export function provinceContains(province: StaticProvince, point: GeoJsonPosition): boolean {
  const { bounds } = province;
  if (point[0] < bounds.minX || point[0] > bounds.maxX || point[1] < bounds.minY || point[1] > bounds.maxY) return false;
  const polygons = province.geometry.type === "Polygon" ? [province.geometry.coordinates] : province.geometry.type === "MultiPolygon" ? province.geometry.coordinates : [];
  const inRing = (ring: readonly GeoJsonPosition[]) => { let inside = false; for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) { const [x, y] = ring[index]!; const [px, py] = ring[previous]!; if ((y > point[1]) !== (py > point[1]) && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x) inside = !inside; } return inside; };
  return polygons.some((polygon) => polygon[0] !== undefined && inRing(polygon[0]) && !polygon.slice(1).some(inRing));
}
