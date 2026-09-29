// Small planar helpers for the map builder: rings in lon/lat, point-in-polygon with a bbox grid, distances in kilometres.

export type Point = readonly [number, number];
export type Ring = Point[];

export const KM_PER_DEG_LAT = 111.2;

export function haversineKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function ringContains(ring: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed area in degrees squared: positive when the ring runs counter-clockwise (y up). */
export function signedArea(ring: readonly Point[]): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1]![0] * ring[i]![1] - ring[i]![0] * ring[i - 1]![1];
  return sum / 2;
}

/** Area of a ring in km2 near its own latitude (good to about a percent at this scale). */
export function ringAreaKm2(ring: readonly Point[]): number {
  if (ring.length < 4) return 0;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = Math.cos((lat * Math.PI) / 180) * KM_PER_DEG_LAT;
  let sum = 0;
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1]![0] * kx * ring[i]![1] * KM_PER_DEG_LAT - ring[i]![0] * kx * ring[i - 1]![1] * KM_PER_DEG_LAT;
  return Math.abs(sum) / 2;
}

/** A set of polygons (each a list of rings, filled even-odd) with a coarse grid to find the ones near a point. */
export class PolygonIndex {
  private readonly cell = 0.5;
  private readonly grid = new Map<string, number[]>();
  readonly boxes: number[][] = [];

  constructor(readonly polygons: readonly (readonly Ring[])[]) {
    polygons.forEach((rings, index) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const ring of rings) for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      this.boxes.push([x0, y0, x1, y1]);
      for (let gx = Math.floor(x0 / this.cell); gx <= Math.floor(x1 / this.cell); gx++) {
        for (let gy = Math.floor(y0 / this.cell); gy <= Math.floor(y1 / this.cell); gy++) {
          const key = `${gx},${gy}`;
          const list = this.grid.get(key);
          if (list) list.push(index); else this.grid.set(key, [index]);
        }
      }
    });
  }

  find(x: number, y: number): number {
    for (const index of this.grid.get(`${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`) ?? []) {
      const box = this.boxes[index]!;
      if (x < box[0]! || x > box[2]! || y < box[1]! || y > box[3]!) continue;
      let inside = false;
      for (const ring of this.polygons[index]!) if (ringContains(ring, x, y)) inside = !inside;
      if (inside) return index;
    }
    return -1;
  }
}

/** Unions the pieces of a GeoJSON Polygon or MultiPolygon into a list of polygons of rings. */
export function polygonsOf(geometry: { type: string; coordinates: unknown }): Ring[][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates as Ring[]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Ring[][];
  return [];
}

/** The lines of an ESRI polyline shapefile (type 3), read synchronously: each part of each record as a list of [lon, lat]. */
export function readPolylines(shp: Buffer): Point[][] {
  const lines: Point[][] = [];
  let at = 100;
  while (at + 8 <= shp.length) {
    const words = shp.readInt32BE(at + 4);
    const body = at + 8;
    if (shp.readInt32LE(body) === 3) {
      const parts = shp.readInt32LE(body + 36);
      const points = shp.readInt32LE(body + 40);
      const partStart = body + 44;
      const pointStart = partStart + 4 * parts;
      for (let p = 0; p < parts; p++) {
        const from = shp.readInt32LE(partStart + 4 * p);
        const to = p + 1 < parts ? shp.readInt32LE(partStart + 4 * (p + 1)) : points;
        const line: Point[] = [];
        for (let k = from; k < to; k++) line.push([shp.readDoubleLE(pointStart + 16 * k), shp.readDoubleLE(pointStart + 16 * k + 8)]);
        lines.push(line);
      }
    }
    at = body + words * 2;
  }
  return lines;
}
