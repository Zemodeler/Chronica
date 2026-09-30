/**
 * How clean the borders between polities are, measured on the province graph.
 * Used by build-map-graph.ts (before and after the cleaning pass) and by validate-map-graph.ts (reported, not failing).
 */
import type { Point } from './map-geometry';

export interface BorderInput {
  n: number;
  /** land neighbours of each province with the length of the shared border (km); a weight of 1 per edge when the length is unknown */
  adj: { n: number; km: number }[][];
  owner: (string | null)[];
  centroid: Point[];
  /** provinces on one landmass share an id; leave out to skip the exclave count */
  landmass?: number[];
}

export interface BorderReport {
  borderKm: number;
  pairs: { a: string; b: string; km: number; tortuosity: number }[];
  /** a province with 60% or more of its border against one other polity, or a single land neighbour of its own polity */
  spikes: number[];
  /** a province whose removal cuts its polity in two, or with at most two own neighbours yet three or more foreign ones */
  necks: number[];
  /** teeth: chains of four provinces that alternate between two polities, the two in the middle having no other kin */
  combs: number;
  /** pieces of a polity beyond its largest on one landmass */
  exclaves: number;
  perPolity: Map<string, { borderKm: number; tortuosity: number; spikes: number; necks: number; provinces: number }>;
  meanTortuosity: number;
}

const km = (a: Point, b: Point): number => {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Half the perimeter of the convex hull of points (the length of a straight line through them, for points on a line). */
function hullHalfPerimeter(points: Point[]): number {
  if (points.length < 2) return 0;
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  const upper: Point[] = [];
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < hull.length; i++) per += km(hull[i]!, hull[(i + 1) % hull.length]!);
  return hull.length === 2 ? per / 2 : per / 2;
}

export function measureBorders(input: BorderInput): BorderReport {
  const { n, adj, owner, centroid, landmass } = input;
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairKm = new Map<string, number>();
  const pairMid = new Map<string, Point[]>();
  let borderKm = 0;
  for (let i = 0; i < n; i++) {
    const a = owner[i];
    if (a === null) continue;
    for (const e of adj[i]!) {
      const b = owner[e.n];
      if (e.n < i || b === null || b === a) continue;
      const k = key(a!, b!);
      pairKm.set(k, (pairKm.get(k) ?? 0) + e.km);
      const mids = pairMid.get(k) ?? [];
      mids.push([(centroid[i]![0] + centroid[e.n]![0]) / 2, (centroid[i]![1] + centroid[e.n]![1]) / 2]);
      pairMid.set(k, mids);
      borderKm += e.km;
    }
  }
  const pairs = [...pairKm.entries()].map(([k, len]) => {
    const [a, b] = k.split('|') as [string, string];
    const mids = pairMid.get(k)!;
    // a border a few edges long has nothing to be tortuous about
    const straight = hullHalfPerimeter(mids);
    return { a, b, km: len, tortuosity: mids.length < 4 || straight < 1 ? 1 : Math.max(1, len / straight) };
  });

  const spikes: number[] = [];
  const necks: number[] = [];
  const held = new Map<string, number>();
  for (const o of owner) if (o !== null) held.set(o, (held.get(o) ?? 0) + 1);
  for (let i = 0; i < n; i++) {
    const a = owner[i];
    if (a === null || (held.get(a) ?? 0) < 3) continue;
    const against = new Map<string, number>();
    let total = 0;
    let own = 0;
    let foreign = 0;
    for (const e of adj[i]!) {
      total += e.km;
      const b = owner[e.n];
      if (b === a) own++;
      else { foreign++; if (b !== null) against.set(b, (against.get(b) ?? 0) + e.km); }
    }
    const worst = Math.max(0, ...against.values());
    if (total > 0 && (worst >= 0.6 * total || (own <= 1 && foreign >= 2))) spikes.push(i);
    if (own <= 2 && foreign >= 3) necks.push(i);
  }
  // articulation points of each polity's own graph
  const disc = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  let clock = 0;
  const cut = new Set<number>();
  for (let root = 0; root < n; root++) {
    if (disc[root]! >= 0 || owner[root] === null) continue;
    // iterative Tarjan over the subgraph of one owner
    const stack: { v: number; parent: number; k: number; kids: number }[] = [{ v: root, parent: -1, k: 0, kids: 0 }];
    disc[root] = low[root] = clock++;
    while (stack.length > 0) {
      const f = stack[stack.length - 1]!;
      const list = adj[f.v]!;
      if (f.k < list.length) {
        const w = list[f.k++]!.n;
        if (owner[w] !== owner[f.v]) continue;
        if (disc[w]! < 0) { disc[w] = low[w] = clock++; f.kids++; stack.push({ v: w, parent: f.v, k: 0, kids: 0 }); }
        else if (w !== f.parent) low[f.v] = Math.min(low[f.v]!, disc[w]!);
      } else {
        stack.pop();
        const up = stack[stack.length - 1];
        if (up) {
          low[up.v] = Math.min(low[up.v]!, low[f.v]!);
          if (up.parent >= 0 && low[f.v]! >= disc[up.v]!) cut.add(up.v);
        } else if (f.kids > 1) cut.add(f.v);
      }
    }
  }
  // a cut province is a neck when what it holds on to is a peninsula of two provinces or more, not a single tooth
  const neckSet = new Set(necks);
  for (const v of cut) {
    if (neckSet.has(v) || (held.get(owner[v]!) ?? 0) < 4) continue;
    const sizes: number[] = [];
    const seenLocal = new Set<number>([v]);
    for (const e of adj[v]!) {
      if (owner[e.n] !== owner[v] || seenLocal.has(e.n)) continue;
      const queue = [e.n];
      seenLocal.add(e.n);
      for (let q = 0; q < queue.length; q++) for (const f of adj[queue[q]!]!) if (owner[f.n] === owner[v] && !seenLocal.has(f.n)) { seenLocal.add(f.n); queue.push(f.n); }
      sizes.push(queue.length);
    }
    sizes.sort((a, b) => b - a);
    if (sizes.length >= 2 && sizes[1]! >= 2) { neckSet.add(v); necks.push(v); }
  }

  // teeth: a - b - a - b, the two middle provinces with no other kin
  const kin = (v: number): number => adj[v]!.filter((e) => owner[e.n] === owner[v]).length;
  const seen = new Set<string>();
  for (let v0 = 0; v0 < n; v0++) {
    const A = owner[v0];
    if (A === null) continue;
    for (const e1 of adj[v0]!) {
      const v1 = e1.n;
      const B = owner[v1];
      if (B === null || B === A || kin(v1) > 1) continue;
      for (const e2 of adj[v1]!) {
        const v2 = e2.n;
        if (v2 === v0 || owner[v2] !== A || kin(v2) > 1) continue;
        for (const e3 of adj[v2]!) {
          const v3 = e3.n;
          if (v3 === v1 || v3 === v0 || owner[v3] !== B) continue;
          seen.add([v0, v1, v2, v3][0]! < v3 ? `${v0},${v1},${v2},${v3}` : `${v3},${v2},${v1},${v0}`);
        }
      }
    }
  }

  let exclaves = 0;
  if (landmass) {
    const comp = new Map<string, Map<number, number[]>>();
    const mark = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (mark[i] || owner[i] === null) continue;
      let size = 0;
      const queue = [i];
      mark[i] = true;
      for (let q = 0; q < queue.length; q++) { size++; for (const e of adj[queue[q]!]!) if (!mark[e.n] && owner[e.n] === owner[i]) { mark[e.n] = true; queue.push(e.n); } }
      const byLand = comp.get(owner[i]!) ?? new Map<number, number[]>();
      byLand.set(landmass[i]!, [...(byLand.get(landmass[i]!) ?? []), size]);
      comp.set(owner[i]!, byLand);
    }
    for (const byLand of comp.values()) for (const sizes of byLand.values()) exclaves += sizes.length - 1;
  }

  const perPolity = new Map<string, { borderKm: number; tortuosity: number; spikes: number; necks: number; provinces: number }>();
  const row = (id: string) => perPolity.get(id) ?? perPolity.set(id, { borderKm: 0, tortuosity: 0, spikes: 0, necks: 0, provinces: held.get(id) ?? 0 }).get(id)!;
  for (const p of pairs) for (const id of [p.a, p.b]) { const r = row(id); r.borderKm += p.km; r.tortuosity += p.tortuosity * p.km; }
  for (const r of perPolity.values()) r.tortuosity = r.borderKm > 0 ? r.tortuosity / r.borderKm : 1;
  for (const i of spikes) row(owner[i]!).spikes++;
  for (const i of necks) row(owner[i]!).necks++;
  const weighted = pairs.reduce((s, p) => s + p.tortuosity * p.km, 0);
  return { borderKm, pairs, spikes, necks, combs: seen.size, exclaves, perPolity, meanTortuosity: borderKm > 0 ? weighted / borderKm : 1 };
}
