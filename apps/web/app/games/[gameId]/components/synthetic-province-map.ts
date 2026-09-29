import type { GeoJsonMap, GeoJsonPosition } from "@chronica/shared";

/**
 * A grid of jittered, organic-looking provinces that share every border vertex
 * with their neighbours, sized like the dense atlas: `columns * rows` polygons
 * of about `pointsPerEdge * 4` vertices each. Deterministic, for scale tests
 * and benchmarks only.
 */
export interface SyntheticMapOptions {
  readonly columns: number;
  readonly rows: number;
  readonly cellDegrees?: number;
  readonly pointsPerEdge?: number;
  /** Decimal places written into coordinates, as a generator would. */
  readonly precision?: number;
}

function hashUnit(a: number, b: number, salt: number): number {
  let h = Math.imul(a + 0x9e3779b1, 0x85ebca6b) ^ Math.imul(b + salt, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

export function syntheticProvinceMap(options: SyntheticMapOptions): GeoJsonMap {
  const { columns, rows, cellDegrees = 0.25, pointsPerEdge = 20, precision = 6 } = options;
  const scale = 10 ** precision;
  const round = (value: number) => Math.round(value * scale) / scale;
  const originX = -10; const originY = 30;
  const corner = (i: number, j: number): GeoJsonPosition => [
    round(originX + (i + (hashUnit(i, j, 1) - 0.5) * 0.5) * cellDegrees),
    round(originY + (j + (hashUnit(i, j, 2) - 0.5) * 0.5) * cellDegrees),
  ];
  /** Points strictly between two lattice corners, identical whichever cell asks. */
  const edgeInterior = (i1: number, j1: number, i2: number, j2: number): GeoJsonPosition[] => {
    const forward = i1 < i2 || (i1 === i2 && j1 < j2);
    const [ai, aj, bi, bj] = forward ? [i1, j1, i2, j2] : [i2, j2, i1, j1];
    const a = corner(ai, aj); const b = corner(bi, bj);
    const points: GeoJsonPosition[] = [];
    for (let k = 1; k <= pointsPerEdge; k++) {
      const t = k / (pointsPerEdge + 1);
      const wobble = (hashUnit(ai * 7919 + bi, aj * 104729 + bj, 3 + k) - 0.5) * cellDegrees * 0.12;
      const nx = -(b[1] - a[1]); const ny = b[0] - a[0];
      const length = Math.hypot(nx, ny) || 1;
      points.push([round(a[0] + (b[0] - a[0]) * t + (nx / length) * wobble), round(a[1] + (b[1] - a[1]) * t + (ny / length) * wobble)]);
    }
    return forward ? points : points.reverse();
  };

  const features: GeoJsonMap["features"][number][] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const id = `synthetic-${String(j * columns + i).padStart(5, "0")}`;
    const ring: GeoJsonPosition[] = [
      corner(i, j), ...edgeInterior(i, j, i + 1, j),
      corner(i + 1, j), ...edgeInterior(i + 1, j, i + 1, j + 1),
      corner(i + 1, j + 1), ...edgeInterior(i + 1, j + 1, i, j + 1),
      corner(i, j + 1), ...edgeInterior(i, j + 1, i, j),
    ];
    ring.push(ring[0]!);
    features.push({ type: "Feature", id, properties: { kind: "province", name: `Province ${id}` }, geometry: { type: "Polygon", coordinates: [ring] } });
    const centre = corner(i, j);
    features.push({ type: "Feature", id: `${id}-town`, properties: { kind: "settlement", name: `Town ${id}`, provinceId: id, type: "town" }, geometry: { type: "Point", coordinates: [round(centre[0] + cellDegrees * 0.4), round(centre[1] + cellDegrees * 0.4)] } });
  }
  return { type: "FeatureCollection", features };
}
