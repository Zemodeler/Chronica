/**
 * From the generated polygons to a game map: the province graph, the GeoJSON, and the anchors that let the
 * scenario be rewired mechanically.
 *
 * Inputs (all in $MAP_GEN_DATA): `<in>.json` and `<in>.samples.json` from generate-provinces.cjs, `old-map.json`
 * from dump-old-map.ts, and optionally scripts/map-gen/anatolia-polities.json.
 * Usage (cwd anywhere): MAP_GEN_DATA=<dir> tsx scripts/map-gen/build-map-graph.ts [in=v2]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm, polygonsOf, PolygonIndex, ringAreaKm2, ringContains, signedArea, type Point, type Ring } from './map-geometry';
import { ADJECTIVE, ancientNameOf, compassOf, regionOf, type Compass, type Region } from './map-names';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const DATA = process.env.MAP_GEN_DATA ?? join(ROOT, '.map-gen-data');
const IN = process.argv.find((a) => a.startsWith('in='))?.slice(3) ?? 'v2';
const OUT_GRAPH = join(ROOT, 'packages/db/src/punic-wars-map-graph-v2.ts');
const OUT_GEOJSON = join(ROOT, 'apps/web/public/maps/punic-wars-provinces.geojson');
const OUT_ANCHORS = join(HERE, 'anchors.json');
const STRAIT_KM = 80;

interface Meta {
  seed: { lon: number; lat: number; name: string | null; pleiades: string | null; src: string };
  areaKm2: number;
  centroid: [number, number];
  elevMean: number;
  elevMax: number;
  slopeMKm: number;
  coast: boolean;
  coastKm: number;
  riverFrac: number;
  sandFrac: number;
  adj: { n: number; km: number; elev: number }[];
}
interface Generated {
  bbox: { x0: number; x1: number; y0: number; y1: number };
  rings: Ring[][];
  provinces: Meta[];
  sea4: { w: number; h: number; step: number; bits: string };
}
interface OldSettlement { id: string; name: string; kind: string; controllerPolityId: string; size: number; fortificationLevel: number; coordinate: [number, number]; type: string }
interface OldMap {
  provinces: { id: string; controller: string; geometry: { type: string; coordinates: unknown } }[];
  polities: { polityId: string; name: string; capitalSettlementId: string | null }[];
  settlements: OldSettlement[];
}
interface AnatoliaSettlement { settlementId: string; name: string; lon: number; lat: number; kind: string; size: number; fortificationLevel: number; offMap?: boolean }
interface AnatoliaPolity {
  id: string; name: string; reuseExisting: boolean; governmentForm: string; cohesionBps: number | null;
  capital: AnatoliaSettlement | null; otherSettlements: AnatoliaSettlement[]; territory: [number, number][][];
}

const gen = JSON.parse(readFileSync(join(DATA, `${IN}.json`), 'utf8')) as Generated;
const samples = JSON.parse(readFileSync(join(DATA, `${IN}.samples.json`), 'utf8')) as number[][];
const old = JSON.parse(readFileSync(join(DATA, 'old-map.json'), 'utf8')) as OldMap;
let anatolia: AnatoliaPolity[] = [];
try {
  anatolia = (JSON.parse(readFileSync(join(HERE, 'anatolia-polities.json'), 'utf8')) as { polities: AnatoliaPolity[] }).polities;
} catch {
  console.log('anatolia-polities.json is absent: Anatolian provinces stay unowned');
}

const N = gen.provinces.length;
const P = gen.provinces;
const centreOf = (i: number): Point => P[i]!.centroid;

// ---- regions, ids
const regionAt = P.map((p) => regionOf(p.centroid[0], p.centroid[1]));
const idOf: string[] = [];
{
  const taken = new Set<string>();
  P.forEach((p, i) => {
    let h = Math.imul(Math.round(p.seed.lon * 1e4) | 0, 374761393) ^ Math.imul(Math.round(p.seed.lat * 1e4) | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    let n = (h ^ (h >>> 16)) >>> 0;
    for (;;) {
      const id = `${regionAt[i]!.slug}-${(n % 60_466_176).toString(36).padStart(5, '0')}`;
      if (!taken.has(id)) { taken.add(id); idOf.push(id); break; }
      n += 1;
    }
  });
}

// ---- outlines as GeoJSON polygons (outer rings with their holes), rounded to 5 decimals
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;
function tidy(ring: Ring): Ring | null {
  const out: Point[] = [];
  for (const [x, y] of ring) {
    const q: Point = [round5(x), round5(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length > 1 && (out[0]![0] !== out[out.length - 1]![0] || out[0]![1] !== out[out.length - 1]![1])) out.push(out[0]!);
  return out.length >= 4 ? out : null;
}
const polygonsOfProvince: Ring[][][] = gen.rings.map((rings) => {
  const cleaned = rings.map(tidy).filter((r): r is Ring => r !== null);
  if (cleaned.length === 0) return [];
  const orientation = Math.sign(signedArea(cleaned.reduce((a, b) => (Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b))));
  const outers = cleaned.filter((r) => Math.sign(signedArea(r)) === orientation).map((r) => (signedArea(r) > 0 ? r : [...r].reverse()));
  const holes = cleaned.filter((r) => Math.sign(signedArea(r)) !== orientation).map((r) => (signedArea(r) < 0 ? r : [...r].reverse()));
  const polygons: Ring[][] = outers.map((outer) => [outer]);
  for (const hole of holes) {
    const probe: Point = [(hole[0]![0] + hole[1]![0] + hole[2]![0]) / 3, (hole[0]![1] + hole[1]![1] + hole[2]![1]) / 3];
    const home = polygons.find((polygon) => ringContains(polygon[0]!, probe[0], probe[1]));
    if (home) home.push(hole);
  }
  return polygons;
});
const outlineIndex = new PolygonIndex(polygonsOfProvince.flatMap((polygons) => polygons.map((rings) => rings)));
const ownerOfPolygon: number[] = polygonsOfProvince.flatMap((polygons, i) => polygons.map(() => i));
const provinceAt = (lon: number, lat: number): number => { const k = outlineIndex.find(lon, lat); return k < 0 ? -1 : ownerOfPolygon[k]!; };

// ---- ownership from the old map: each new province takes the polity that holds most of its sample points
const oldPolygons: Ring[][] = [];
const oldPolygonProvince: number[] = [];
old.provinces.forEach((p, i) => { for (const polygon of polygonsOf(p.geometry)) { oldPolygons.push(polygon); oldPolygonProvince.push(i); } });
const oldIndex = new PolygonIndex(oldPolygons);
const oldOfProvince: (string | null)[] = [];
const ownerVotes: Map<string, number>[] = [];
const coverage: number[] = [];
const oldProvinceVotes: Map<string, number>[] = [];
for (let i = 0; i < N; i++) {
  const votes = new Map<string, number>();
  const oldVotes = new Map<string, number>();
  const pts = samples[i]!;
  let covered = 0;
  for (let k = 0; k < pts.length; k += 2) {
    const hit = oldIndex.find(pts[k]!, pts[k + 1]!);
    if (hit < 0) continue;
    const province = old.provinces[oldPolygonProvince[hit]!]!;
    covered++;
    votes.set(province.controller, (votes.get(province.controller) ?? 0) + 1);
    oldVotes.set(province.id, (oldVotes.get(province.id) ?? 0) + 1);
  }
  ownerVotes.push(votes);
  oldProvinceVotes.push(oldVotes);
  coverage.push(covered / (pts.length / 2));
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  oldOfProvince.push(best && coverage[i]! >= 0.35 ? best[0] : null);
}
const majorityOldProvince = (i: number): string | null => [...oldProvinceVotes[i]!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

// Turkey's Asian mainland decides which unowned provinces the Anatolian file may claim.
const turkey = (JSON.parse(readFileSync(join(ROOT, 'apps/web/public/maps/natural-earth-50m-admin0-countries.geojson'), 'utf8')) as { features: { properties: { ADMIN: string }; geometry: { type: string; coordinates: unknown } }[] })
  .features.find((f) => f.properties.ADMIN === 'Turkey')!;
const asiaMinor = polygonsOf(turkey.geometry).reduce((a, b) => (ringAreaKm2(a[0]!) >= ringAreaKm2(b[0]!) ? a : b))[0]!;
const anatolianShare = (i: number): number => {
  const pts = samples[i]!;
  let inside = 0;
  for (let k = 0; k < pts.length; k += 2) if (ringContains(asiaMinor, pts[k]!, pts[k + 1]!)) inside++;
  return inside / (pts.length / 2);
};
const centreSample = (i: number): Point => {
  const pts = samples[i]!;
  let best: Point = [pts[0]!, pts[1]!];
  let bestD = Infinity;
  for (let k = 0; k < pts.length; k += 2) {
    const d = Math.hypot(pts[k]! - P[i]!.centroid[0], pts[k + 1]! - P[i]!.centroid[1]);
    if (d < bestD) { bestD = d; best = [pts[k]!, pts[k + 1]!]; }
  }
  return best;
};

const controller: (string | null)[] = [...oldOfProvince];
// The vote can round a polity's fringe away wholesale (the Morini lost their only province). Where a province is close to a split,
// flip it to the neighbouring claimant that most needs the land, until each polity holds about as much as its old ground now amounts to.
let rebalanced = 0;
{
  const target = new Map<string, number>();
  const held = new Map<string, number>();
  const options: [number, [string, number][]][] = [];
  for (let i = 0; i < N; i++) {
    if (controller[i] === null) continue;
    const covered = [...ownerVotes[i]!.values()].reduce((a, b) => a + b, 0);
    const shares: [string, number][] = [...ownerVotes[i]!.entries()].map(([id, n]) => [id, n / covered]);
    for (const [id, share] of shares) target.set(id, (target.get(id) ?? 0) + share * P[i]!.areaKm2);
    held.set(controller[i]!, (held.get(controller[i]!) ?? 0) + P[i]!.areaKm2);
    const contenders = shares.filter(([, share]) => share >= 0.25);
    if (contenders.length > 1) options.push([i, contenders]);
  }
  const cost = (id: string, area: number): number => ((area - (target.get(id) ?? 0)) ** 2) / ((target.get(id) ?? 0) + 2000);
  for (let pass = 0; pass < 60; pass++) {
    let changed = 0;
    for (const [i, contenders] of options) {
      const from = controller[i]!;
      const area = P[i]!.areaKm2;
      let best: string | null = null;
      let bestGain = 1e-6;
      for (const [to] of contenders) {
        if (to === from) continue;
        const gain = cost(from, held.get(from)!) + cost(to, held.get(to) ?? 0) - cost(from, held.get(from)! - area) - cost(to, (held.get(to) ?? 0) + area);
        if (gain > bestGain) { bestGain = gain; best = to; }
      }
      if (best) { held.set(from, held.get(from)! - area); held.set(best, (held.get(best) ?? 0) + area); controller[i] = best; changed++; rebalanced++; }
    }
    if (changed === 0) break;
  }
}
const fromAnatoliaFile = new Set<number>();
for (let i = 0; i < N; i++) {
  if (controller[i] !== null || anatolia.length === 0 || anatolianShare(i) < 0.5) continue;
  const [x, y] = centreSample(i);
  claim: for (const polity of anatolia) for (const territory of polity.territory) if (ringContains(territory, x, y)) { controller[i] = polity.id; fromAnatoliaFile.add(i); break claim; }
}
// Ground the old map did not cover and no polity claims (coastal slivers, the map's own fringe) goes to its land neighbours' commonest owner.
const unowned = (): number[] => controller.flatMap((c, i) => (c === null && !(anatolianShare(i) >= 0.5 && anatolia.length === 0) ? [i] : []));
let fringe = 0;
for (let pass = 0; pass < 4; pass++) {
  const next = new Map<number, string>();
  for (const i of unowned()) {
    const votes = new Map<string, number>();
    for (const a of P[i]!.adj) { const c = controller[a.n]; if (c) votes.set(c, (votes.get(c) ?? 0) + a.km); }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) next.set(i, best[0]);
  }
  for (const [i, c] of next) { controller[i] = c; fringe++; }
  if (next.size === 0) break;
}

// ---- settlements
interface Settlement { id: string; name: string; kind: string; type: string; provinceIndex: number; controllerPolityId: string; size: number; fortificationLevel: number; lon: number; lat: number; snapKm: number }
const settlements: Settlement[] = [];
const snapped: string[] = [];
const offMap: string[] = [];
function homeOf(lon: number, lat: number): { index: number; snapKm: number } {
  const inside = provinceAt(lon, lat);
  if (inside >= 0) return { index: inside, snapKm: 0 };
  let best = -1;
  let bestKm = Infinity;
  for (let i = 0; i < N; i++) {
    if (haversineKm([lon, lat], P[i]!.centroid) > 150) continue;
    for (const polygon of polygonsOfProvince[i]!) for (const [x, y] of polygon[0]!) {
      const d = haversineKm([lon, lat], [x, y]);
      if (d < bestKm) { bestKm = d; best = i; }
    }
  }
  return { index: best, snapKm: bestKm };
}
const capitalOfPolity = new Map(old.polities.filter((p) => p.capitalSettlementId).map((p) => [p.capitalSettlementId!, p.polityId]));
// The old map put Utica half a degree east of the site, in the Gulf of Tunis.
const CORRECTED: Record<string, [number, number]> = { 'settlement-utica': [10.06, 37.06] };
for (const s of old.settlements) {
  if (CORRECTED[s.id]) s.coordinate = CORRECTED[s.id]!;
  const home = homeOf(s.coordinate[0], s.coordinate[1]);
  if (home.snapKm > 0) snapped.push(`${s.id} ${home.snapKm.toFixed(1)} km`);
  if (home.snapKm > 25) { offMap.push(s.id); continue; }
  settlements.push({ id: s.id, name: s.name, kind: s.kind, type: s.type, provinceIndex: home.index, controllerPolityId: s.controllerPolityId, size: s.size, fortificationLevel: s.fortificationLevel, lon: s.coordinate[0], lat: s.coordinate[1], snapKm: home.snapKm });
}
const kindType: Record<string, string> = { city: 'city', town: 'town', village: 'village', fortress: 'fort', port: 'port' };
const anatoliaCapital = new Map<string, string>();
const offMapPolities: string[] = [];
for (const polity of anatolia) {
  const all = [polity.capital, ...polity.otherSettlements].filter((s): s is AnatoliaSettlement => s !== null);
  if (polity.capital?.offMap) offMapPolities.push(polity.id);
  for (const s of all) {
    if (s.offMap) continue;
    const home = homeOf(s.lon, s.lat);
    if (home.snapKm > 0) snapped.push(`${s.settlementId} ${home.snapKm.toFixed(1)} km`);
    if (home.snapKm > 25) { offMap.push(s.settlementId); continue; }
    settlements.push({ id: s.settlementId, name: s.name, kind: s.kind, type: kindType[s.kind] ?? 'town', provinceIndex: home.index, controllerPolityId: polity.id, size: s.size, fortificationLevel: s.fortificationLevel, lon: s.lon, lat: s.lat, snapKm: home.snapKm });
    if (s === polity.capital) anatoliaCapital.set(polity.id, s.settlementId);
  }
}
// A capital stands in its own polity's ground; an Anatolian town does too unless an old owner already holds the province.
const adopted: string[] = [];
for (const s of settlements) {
  const isOldCapital = capitalOfPolity.get(s.id);
  const isNewCapital = anatoliaCapital.get(s.controllerPolityId) === s.id;
  const fileTown = fromAnatoliaFile.has(s.provinceIndex) || controller[s.provinceIndex] === null;
  if ((isOldCapital || isNewCapital || (fileTown && anatolia.some((p) => p.id === s.controllerPolityId))) && controller[s.provinceIndex] !== s.controllerPolityId) {
    adopted.push(`${idOf[s.provinceIndex]} ${controller[s.provinceIndex] ?? 'none'} -> ${s.controllerPolityId} (${s.id})`);
    controller[s.provinceIndex] = s.controllerPolityId;
  }
}
// One settlement per province unless two must share: report the sharing.
const sharing = new Map<number, string[]>();
for (const s of settlements) sharing.set(s.provinceIndex, [...(sharing.get(s.provinceIndex) ?? []), s.id]);
const shared = [...sharing.entries()].filter(([, ids]) => ids.length > 1);

// ---- terrain
const terrain: string[] = P.map((p) => {
  if (p.coast) return 'coastal-plain';
  const lat = p.centroid[1];
  if (lat < 34.5 && p.riverFrac < 0.02) return 'desert-steppe';
  if (p.elevMean > 700 || p.slopeMKm > 90) return 'hills-uplands';
  return 'hills';
});

// ---- edges
const land = (t: string): boolean => t === 'hills' || t === 'hills-uplands';
type Crossing = 'land' | 'pass' | 'strait' | 'sea_lane';
const edges = new Map<string, { from: string; to: string; crossing: Crossing; distance: number }>();
const dist = (a: number, b: number): number => Math.max(1, Math.round(haversineKm(centreOf(a), centreOf(b))));
function addEdge(a: number, b: number, crossing: Crossing): boolean {
  const [from, to] = [idOf[a]!, idOf[b]!].sort() as [string, string];
  const key = `${from}|${to}`;
  if (edges.has(key)) return false;
  edges.set(key, { from, to, crossing, distance: dist(a, b) });
  return true;
}
for (let i = 0; i < N; i++) for (const a of P[i]!.adj) {
  if (a.n <= i) continue;
  addEdge(i, a.n, a.elev > 1400 && land(terrain[i]!) && land(terrain[a.n]!) ? 'pass' : 'land');
}

// landmasses = what land borders alone connect
const parent = Array.from({ length: N }, (_, i) => i);
const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
for (let i = 0; i < N; i++) for (const a of P[i]!.adj) parent[find(i)] = find(a.n);
const componentSize = new Map<number, number>();
for (let i = 0; i < N; i++) componentSize.set(find(i), (componentSize.get(find(i)) ?? 0) + 1);

// sea bitmap: water gaps between landmasses are told from desert gaps by looking at what lies between
const sea4Bits = Buffer.from(gen.sea4.bits, 'base64');
const KX = Math.cos((((gen.bbox.y0 + gen.bbox.y1) / 2) * Math.PI) / 180);
const isSea = (lon: number, lat: number): boolean => {
  const x = Math.floor((((lon - gen.bbox.x0) * KX) / 0.01) / gen.sea4.step);
  const y = Math.floor(((gen.bbox.y1 - lat) / 0.01) / gen.sea4.step);
  if (x < 0 || y < 0 || x >= gen.sea4.w || y >= gen.sea4.h) return false;
  const b = y * gen.sea4.w + x;
  return ((sea4Bits[b >> 3]! >> (b & 7)) & 1) === 1;
};

// outline vertices in local kilometres, thinned, for gap measurement
const KMLON = Math.cos((40 * Math.PI) / 180) * 111.2;
const outline: { x: number; y: number; lon: number; lat: number }[][] = polygonsOfProvince.map((polygons) => {
  const pts = polygons.flatMap((polygon) => polygon[0]!);
  const stride = Math.max(1, Math.ceil(pts.length / 70));
  return pts.filter((_, k) => k % stride === 0).map(([lon, lat]) => ({ x: lon * Math.cos((lat * Math.PI) / 180) * 111.2, y: lat * 111.2, lon, lat }));
});
interface Gap { a: number; b: number; km: number; water: boolean; from: Point; to: Point }
function gapBetween(a: number, b: number): Gap {
  let best = Infinity;
  let pa = outline[a]![0]!;
  let pb = outline[b]![0]!;
  for (const u of outline[a]!) for (const v of outline[b]!) {
    const d = (u.x - v.x) ** 2 + (u.y - v.y) ** 2;
    if (d < best) { best = d; pa = u; pb = v; }
  }
  let wet = 0;
  for (let s = 1; s <= 8; s++) { const t = s / 9; if (isSea(pa.lon + (pb.lon - pa.lon) * t, pa.lat + (pb.lat - pa.lat) * t)) wet++; }
  return { a, b, km: Math.sqrt(best), water: P[a]!.coast && P[b]!.coast && (wet >= 3), from: [pa.lon, pa.lat], to: [pb.lon, pb.lat] };
}

const cellKm = 200;
const cellOf = (i: number): string => `${Math.floor((P[i]!.centroid[0] * Math.cos((40 * Math.PI) / 180) * 111.2) / cellKm)},${Math.floor((P[i]!.centroid[1] * 111.2) / cellKm)}`;
const buckets = new Map<string, number[]>();
for (let i = 0; i < N; i++) { const k = cellOf(i); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i); }
function candidateGaps(radiusKm: number): Gap[] {
  const out: Gap[] = [];
  const reach = Math.ceil(radiusKm / cellKm);
  for (let i = 0; i < N; i++) {
    const [gx, gy] = cellOf(i).split(',').map(Number) as [number, number];
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      for (const j of buckets.get(`${gx + dx},${gy + dy}`) ?? []) {
        if (j <= i || find(i) === find(j)) continue;
        if (haversineKm(centreOf(i), centreOf(j)) > radiusKm + 60) continue;
        const gap = gapBetween(i, j);
        if (gap.km <= radiusKm) out.push(gap);
      }
    }
  }
  return out;
}

const crossings: { from: string; to: string; crossing: string; gapKm: number }[] = [];
const waterEdgeCount = new Map<number, number>();
function addCrossing(g: Gap): boolean {
  const crossing: Crossing = g.water ? (g.km <= STRAIT_KM ? 'strait' : 'sea_lane') : 'land';
  if (!addEdge(g.a, g.b, crossing)) return false;
  crossings.push({ from: idOf[g.a]!, to: idOf[g.b]!, crossing, gapKm: Math.round(g.km) });
  if (g.water) for (const x of [g.a, g.b]) waterEdgeCount.set(x, (waterEdgeCount.get(x) ?? 0) + 1);
  return true;
}

// 1. the shortest gaps join every landmass to the rest (a minimum spanning tree over landmasses)
let radius = 200;
const treeParent = new Map<number, number>();
const treeFind = (x: number): number => { let r = x; while ((treeParent.get(r) ?? r) !== r) r = treeParent.get(r)!; return r; };
for (const root of new Set(parent.map((_, i) => find(i)))) treeParent.set(root, root);
let joinedCount = treeParent.size;
while (joinedCount > 1 && radius <= 3200) {
  const gaps = candidateGaps(radius).sort((x, y) => x.km - y.km);
  for (const g of gaps) {
    const ra = treeFind(find(g.a));
    const rb = treeFind(find(g.b));
    if (ra === rb) continue;
    treeParent.set(ra, rb);
    joinedCount--;
    addCrossing(g);
  }
  radius *= 2;
}
// 2. major straits get parallel crossings and big landmasses a sea lane apiece, so fleets have choices
{
  const big = (i: number): boolean => (componentSize.get(find(i)) ?? 0) >= 6;
  const pairs = new Map<string, Gap[]>();
  for (const g of candidateGaps(220)) {
    if (!g.water || !big(g.a) || !big(g.b)) continue;
    const key = [find(g.a), find(g.b)].sort((x, y) => x - y).join('|');
    (pairs.get(key) ?? pairs.set(key, []).get(key)!).push(g);
  }
  for (const gaps of pairs.values()) {
    gaps.sort((x, y) => x.km - y.km);
    const shortest = gaps[0]!;
    const used = new Set<number>();
    const wanted = shortest.km <= STRAIT_KM ? 3 : 1;
    let made = 0;
    for (const g of gaps) {
      if (made >= wanted) break;
      if (g.km > shortest.km + 25 && made > 0) break;
      if (used.has(g.a) || used.has(g.b)) continue;
      if ((waterEdgeCount.get(g.a) ?? 0) >= 3 || (waterEdgeCount.get(g.b) ?? 0) >= 3) continue;
      if (addCrossing(g)) { made++; used.add(g.a); used.add(g.b); }
      else made++;
    }
  }
}
// 3. straits inside one landmass: Otranto and the Gulf of Corinth are a short sail and a long march
{
  const landAdj: number[][] = P.map((p) => p.adj.map((a) => a.n));
  const hopsWithin = (from: number, limit: number): Set<number> => {
    const seen = new Set([from]);
    let frontier = [from];
    for (let depth = 0; depth < limit && frontier.length; depth++) {
      const next: number[] = [];
      for (const x of frontier) for (const y of landAdj[x]!) if (!seen.has(y)) { seen.add(y); next.push(y); }
      frontier = next;
    }
    return seen;
  };
  const found: Gap[] = [];
  for (let i = 0; i < N; i++) {
    if (!P[i]!.coast) continue;
    const near = hopsWithin(i, 14);
    const [gx, gy] = cellOf(i).split(',').map(Number) as [number, number];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of buckets.get(`${gx + dx},${gy + dy}`) ?? []) {
      if (j <= i || !P[j]!.coast || near.has(j) || find(i) !== find(j)) continue;
      if (haversineKm(centreOf(i), centreOf(j)) > STRAIT_KM + 90) continue;
      const g = gapBetween(i, j);
      if (g.water && g.km <= STRAIT_KM) found.push(g);
    }
  }
  found.sort((x, y) => x.km - y.km);
  const taken: Gap[] = [];
  for (const g of found) {
    if (taken.some((t) => (haversineKm(centreOf(t.a), centreOf(g.a)) < 45 && haversineKm(centreOf(t.b), centreOf(g.b)) < 45) || (haversineKm(centreOf(t.a), centreOf(g.b)) < 45 && haversineKm(centreOf(t.b), centreOf(g.a)) < 45))) continue;
    if ((waterEdgeCount.get(g.a) ?? 0) >= 3 || (waterEdgeCount.get(g.b) ?? 0) >= 3) continue;
    if (addCrossing(g)) taken.push(g);
  }
  console.log(`shortcut straits inside a landmass: ${taken.length}`);
}
// every province a water edge touches is coastal ground, whatever the shore looked like
for (const e of edges.values()) if (e.crossing === 'strait' || e.crossing === 'sea_lane') for (const id of [e.from, e.to]) { const i = idOf.indexOf(id); terrain[i] = 'coastal-plain'; }
// a pass is legal only between hills, so any pass edge that ended beside a coastal province is a plain land border
for (const [key, e] of edges) if (e.crossing === 'pass') {
  const a = idOf.indexOf(e.from);
  const b = idOf.indexOf(e.to);
  if (!(land(terrain[a]!) && land(terrain[b]!))) edges.set(key, { ...e, crossing: 'land' });
}

// ---- names
const settlementName = new Map<number, Settlement>();
{
  const rank: Record<string, number> = { capital: 5, city: 4, port: 3, town: 2, fort: 1, village: 0 };
  for (const s of settlements) {
    const held = settlementName.get(s.provinceIndex);
    if (!held || (rank[s.type] ?? 0) > (rank[held.type] ?? 0)) settlementName.set(s.provinceIndex, s);
  }
}
// A province takes the name of the most notable ancient place inside it: a settlement, then an island, a people, a fort, a harbour.
const TYPE_WEIGHT: Record<string, number> = { urban: 7, settlement: 6, island: 5, people: 4, fort: 3, port: 3, mountain: 2, sanctuary: 2, villa: 1, river: 1, region: 1 };
const placeName: (string | null)[] = P.map(() => null);
{
  const require = createRequire(join(DATA, 'package.json'));
  const { parse } = require('csv-parse/sync') as { parse: (input: Buffer, options: object) => Record<string, string>[] };
  const rows = parse(readFileSync(join(DATA, 'data/pleiades-places-latest.csv')), { columns: true, relax_quotes: true, relax_column_count: true });
  const best: number[] = P.map(() => -1);
  for (const r of rows) {
    if (r.reprLong === '' || r.reprLat === '') continue;
    const lon = +r.reprLong;
    const lat = +r.reprLat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < gen.bbox.x0 || lon > gen.bbox.x1 || lat < gen.bbox.y0 || lat > gen.bbox.y1) continue;
    const minDate = r.minDate === '' ? null : +r.minDate;
    const maxDate = r.maxDate === '' ? null : +r.maxDate;
    if (minDate !== null && minDate > 0) continue;
    if (maxDate !== null && maxDate < -400) continue;
    const weight = Math.max(0, ...r.featureTypes.split(',').map((t) => TYPE_WEIGHT[t.trim()] ?? 0));
    if (weight === 0) continue;
    const name = ancientNameOf(r.title ?? null, lat);
    if (!name) continue;
    const i = provinceAt(lon, lat);
    if (i < 0) continue;
    const alive = minDate !== null && maxDate !== null && minDate <= -270 && maxDate >= -270;
    const score = weight * 10 + (alive ? 5 : 0) + (minDate !== null && minDate <= -270 ? 2 : 0) + (r.id === P[i]!.seed.pleiades ? 1 : 0);
    if (score > best[i]! || (score === best[i]! && name.localeCompare(placeName[i]!) < 0)) { best[i] = score; placeName[i] = name; }
  }
}
const base: (string | null)[] = P.map((_, i) => settlementName.get(i)?.name ?? placeName[i]);
const finalName: (string | null)[] = [...base];
{
  const groups = new Map<string, number[]>();
  base.forEach((n, i) => { if (n) (groups.get(n.toLowerCase()) ?? groups.set(n.toLowerCase(), []).get(n.toLowerCase())!).push(i); });
  const taken = new Set<string>();
  for (const members of groups.values()) {
    members.sort((a, b) => (settlementName.has(b) ? 1 : 0) - (settlementName.has(a) ? 1 : 0) || idOf[a]!.localeCompare(idOf[b]!));
    taken.add(base[members[0]!]!.toLowerCase());
  }
  for (const members of groups.values()) {
    for (const i of members.slice(1)) {
      const name = base[i]!;
      let candidate = `${name} in ${regionAt[i]!.name}`;
      if (taken.has(candidate.toLowerCase())) {
        const mean: Point = [members.reduce((s, m) => s + centreOf(m)[0], 0) / members.length, members.reduce((s, m) => s + centreOf(m)[1], 0) / members.length];
        candidate = `${ADJECTIVE[compassOf(mean, centreOf(i))]} ${name} in ${regionAt[i]!.name}`;
      }
      for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} ${'I'.repeat(Math.min(n, 3))}${n > 3 ? n : ''} in ${regionAt[i]!.name}`;
      finalName[i] = candidate;
      taken.add(candidate.toLowerCase());
    }
  }
  // provinces with no ancient name of their own: what they are, and where they lie from the nearest place that has one
  const named = finalName.flatMap((n, i) => (n ? [i] : []));
  const word = (i: number): string => {
    const p = P[i]!;
    const t = terrain[i]!;
    if (t === 'coastal-plain') return p.coastKm > 45 || p.areaKm2 < 500 ? 'Shore' : 'Coast';
    if (t === 'desert-steppe') return 'Steppe';
    if (t === 'hills-uplands') return p.elevMean > 1100 ? 'Highlands' : 'Uplands';
    return p.riverFrac > 0.09 ? 'Vale' : p.slopeMKm < 25 ? 'Plain' : 'Hills';
  };
  const spare = ['Upper', 'Lower', 'Outer', 'Inner', 'Broad', 'Far'];
  const order = P.map((_, i) => i).filter((i) => !finalName[i]).sort((a, b) => idOf[a]!.localeCompare(idOf[b]!));
  for (const i of order) {
    const ranked = named.map((j) => ({ j, d: haversineKm(centreOf(i), centreOf(j)) })).sort((a, b) => a.d - b.d).slice(0, 8);
    let chosen: string | null = null;
    for (const { j } of ranked) {
      const dir = compassOf(centreOf(j), centreOf(i));
      const c = `${word(i)} ${dir} of ${finalName[j]}`;
      if (!taken.has(c.toLowerCase())) { chosen = c; break; }
    }
    // a crowded neighbourhood: say how far, in Roman miles, then to the mile
    for (const step of [5, 1]) {
      for (const { j, d } of ranked) {
        if (chosen !== null) break;
        const miles = Math.max(step, Math.round(d / 1.48 / step) * step);
        const c = `${word(i)} ${miles} miles ${compassOf(centreOf(j), centreOf(i))} of ${finalName[j]}`;
        if (!taken.has(c.toLowerCase())) chosen = c;
      }
    }
    for (let k = 0; chosen === null; k++) {
      const { j } = ranked[k % ranked.length]!;
      const c = `${spare[Math.floor(k / ranked.length) % spare.length]} ${word(i)} ${compassOf(centreOf(j), centreOf(i))} of ${finalName[j]} ${k}`;
      if (!taken.has(c.toLowerCase())) chosen = c;
    }
    finalName[i] = chosen;
    taken.add(chosen.toLowerCase());
  }
}

// ---- polities that hold ground
const holders = new Set(controller.filter((c): c is string => c !== null));
const placedSettlements = new Set(settlements.filter((x) => x.provinceIndex >= 0).map((x) => x.id));
const polityRows = [
  ...old.polities.filter((p) => holders.has(p.polityId)).map((p) => ({ polityId: p.polityId, name: p.name, capitalSettlementId: p.capitalSettlementId && placedSettlements.has(p.capitalSettlementId) ? p.capitalSettlementId : null })),
  ...anatolia.filter((p) => !p.reuseExisting && holders.has(p.id)).map((p) => ({ polityId: p.id, name: p.name, capitalSettlementId: p.capital && !p.capital.offMap && placedSettlements.has(p.capital.settlementId) ? p.capital.settlementId : null })),
].sort((a, b) => a.polityId.localeCompare(b.polityId));
const lostPolities = old.polities.filter((p) => !holders.has(p.polityId)).map((p) => p.polityId);
const polityMeta = Object.fromEntries(anatolia.filter((p) => !p.reuseExisting && holders.has(p.id)).map((p) => [p.id, { cohesionBps: p.cohesionBps, governmentForm: p.governmentForm }]));
const settlementRows = settlements
  .filter((s) => s.provinceIndex >= 0)
  .map((s) => ({ id: s.id, name: s.name, kind: s.kind, provinceId: idOf[s.provinceIndex]!, controllerPolityId: s.controllerPolityId, size: s.size, fortificationLevel: s.fortificationLevel }))
  .sort((a, b) => a.id.localeCompare(b.id));

// ---- anchors: every old id the scenario hard-codes, by the historically right point
const bySettlement = (id: string): [number, number] => { const s = settlements.find((x) => x.id === id); if (!s) throw new Error(`no settlement ${id}`); return [s.lon, s.lat]; };
const ANCHORS: [string, string, string][] = [
  ['punic-italy-latium', 'settlement-rome', 'the province holding Rome'],
  ['punic-italy-campanian-plain', 'settlement-capua', 'Capua, the heart of Campania (Naples is the neighbouring port)'],
  ['punic-italy-ligurian-coast', 'settlement-genua', 'Genua, the Ligurian port'],
  ['punic-italy-insubrian-plain', 'settlement-mediolanum', 'Mediolanum, the Insubres capital'],
  ['punic-italy-middle-padus', 'settlement-bononia', 'Felsina (Bononia), the Boii town'],
  ['punic-italy-venetian-lagoon', 'settlement-patavium', 'Patavium, the Veneti city'],
  ['punic-italy-etrurian-uplands', 'settlement-volsinii', 'Volsinii, the Etruscan league centre nearest Rome'],
  ['punic-italy-umbrian-valleys', 'settlement-iguvium', 'Iguvium, the Umbrian town'],
  ['punic-italy-picenum-coast', 'settlement-asculum', 'Asculum, the Picene city'],
  ['punic-italy-marsian-highlands', 'settlement-corfinium', 'Corfinium, the Paelignian town'],
  ['punic-italy-samnium', 'settlement-bovianum', 'Bovianum, the Samnite town'],
  ['punic-italy-apulian-coast', 'settlement-tarentum', 'Tarentum, the great city of the Apulian coast (Arpi and Luceria lie inland)'],
  ['punic-italy-lucanian-uplands', 'settlement-grumentum', 'Grumentum, the Lucanian town'],
  ['punic-italy-bruttian-highlands', 'settlement-rhegium', 'Rhegium, the toe of Italy the Rhegium storyline is about (Consentia lies inland)'],
  ['punic-italy-sallentine-peninsula', 'settlement-brundisium', 'Brundisium, the Messapian port'],
  ['tun-13205935b88806172084765', 'settlement-carthage', 'Carthage'],
  ['ita-72843720b81376294924159-sicily-west', 'settlement-lilybaeum', 'Lilybaeum'],
  ['ita-72843720b81376294924159-sicily-northwest', 'settlement-panormus', 'Panormus'],
  ['ita-72843720b81376294924159-sicily-central', 'settlement-agrigentum', 'Agrigentum'],
  ['ita-72843720b81376294924159-sicily-southeast', 'settlement-syracuse', 'Syracuse'],
  ['ita-72843720b81376294924159-sicily-northeast', 'settlement-messana', 'Messana, on the strait'],
];
const anchorRows = ANCHORS.map(([oldId, settlementId, why]) => {
  const [lon, lat] = bySettlement(settlementId);
  const home = settlements.find((s) => s.id === settlementId)!.provinceIndex;
  const members = P.map((_, i) => i).filter((i) => majorityOldProvince(i) === oldId).map((i) => idOf[i]!);
  return { oldId, newId: idOf[home]!, name: finalName[home]!, point: [lon, lat], why, settlement: settlementId, regionProvinces: members };
});

// ---- write
const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;
const provinceRows = P.map((p, i) => ({
  id: idOf[i]!,
  name: finalName[i]!,
  terrainId: terrain[i]!,
  controllerPolityId: controller[i],
  controlFirmnessBps: controller[i] === 'rome' || controller[i] === 'carthage' ? 8_500 : 7_000,
  areaKm2: p.areaKm2,
  geo: { latitude: round(p.centroid[1], 4), longitude: round(p.centroid[0], 4) },
})).sort((a, b) => a.id.localeCompare(b.id));
const edgeRows = [...edges.values()].sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
const lines = (rows: readonly unknown[]): string => `[\n${rows.map((r) => `  ${JSON.stringify(r)},`).join('\n')}\n]`;
const anchorMap = Object.fromEntries([
  ...anchorRows.map((a) => [a.oldId, a.newId]),
]);
const friendly: Record<string, string> = {};
for (const s of settlementRows) friendly[s.id.replace(/^settlement-/, '')] = s.provinceId;
const regionKey: Record<string, string> = {
  'punic-italy-latium': 'latium', 'punic-italy-campanian-plain': 'campania', 'ita-72843720b81376294924159-sicily-northeast': 'sicilyNortheast',
  'ita-72843720b81376294924159-sicily-southeast': 'sicilySoutheast', 'ita-72843720b81376294924159-sicily-west': 'sicilyWest', 'ita-72843720b81376294924159-sicily-northwest': 'sicilyNorthwest',
  'ita-72843720b81376294924159-sicily-central': 'sicilyCentral', 'tun-13205935b88806172084765': 'carthaginianHeartland',
};
const namedAnchors = { ...friendly, ...Object.fromEntries(anchorRows.filter((a) => regionKey[a.oldId]).map((a) => [regionKey[a.oldId]!, a.newId])) };

const header = `// GENERATED FILE -- do not edit by hand.
// Regenerate with scripts/map-gen/build-map-graph.ts (see scripts/map-gen/README.md).
//
// The Punic Wars province graph on the dense generated map: organic provinces grown from
// Pleiades settlements alive in 270 BCE over the game's land, with the polities of the map it replaces.
// An edge's distance is the kilometres between the two provinces' centres.
//
// Provinces: ${provinceRows.length}. Borders: ${edgeRows.length}. Polities: ${polityRows.length}. Settlements: ${settlementRows.length}.
// Landmasses found: ${new Set(parent.map((_, i) => find(i))).size}, joined by ${crossings.length} water or gap crossings:
${crossings.map((c) => `//   ${c.crossing.padEnd(9)} ~${String(c.gapKm).padStart(4)} km  ${c.from} <-> ${c.to}`).join('\n')}

export interface MapGraphProvinceV2 {
  readonly id: string;
  readonly name: string;
  readonly terrainId: string;
  /** Null where no polity holds it. */
  readonly controllerPolityId: string | null;
  readonly controlFirmnessBps: number;
  readonly areaKm2: number;
  readonly geo: { readonly latitude: number; readonly longitude: number };
}

export interface MapGraphEdgeV2 {
  readonly from: string;
  readonly to: string;
  readonly crossing: "land" | "pass" | "strait" | "sea_lane";
  /** Kilometres, centre to centre. */
  readonly distance: number;
}

export interface MapGraphPolityV2 {
  readonly polityId: string;
  readonly name: string;
  readonly capitalSettlementId: string | null;
}

export interface MapGraphSettlementV2 {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly provinceId: string;
  readonly controllerPolityId: string;
  readonly size: number;
  readonly fortificationLevel: number;
}
`;
writeFileSync(OUT_GRAPH, [
  header,
  `export const PUNIC_WARS_GRAPH_PROVINCES_V2: readonly MapGraphProvinceV2[] = ${lines(provinceRows)};`,
  '',
  `export const PUNIC_WARS_GRAPH_EDGES_V2: readonly MapGraphEdgeV2[] = ${lines(edgeRows)};`,
  '',
  `export const PUNIC_WARS_GRAPH_POLITIES_V2: readonly MapGraphPolityV2[] = ${lines(polityRows)};`,
  '',
  `export const PUNIC_WARS_GRAPH_SETTLEMENTS_V2: readonly MapGraphSettlementV2[] = ${lines(settlementRows)};`,
  '',
  '/** Cohesion and government form of the polities this map adds beyond the ones the scenario already writes. */',
  `export const POLITY_META_V2: Readonly<Record<string, { readonly cohesionBps: number | null; readonly governmentForm: string }>> = ${JSON.stringify(polityMeta, null, 2)};`,
  '',
  '/** The new province that holds each place the scenario names, and each old province id it hard-codes. */',
  `export const PUNIC_ANCHORS_V2: Readonly<Record<string, string>> = ${JSON.stringify({ ...namedAnchors, ...anchorMap }, null, 2)};`,
  '',
  '/** Every new province whose ground lay mostly in the old province, for the ids the scenario hard-codes. */',
  `export const PUNIC_OLD_REGION_PROVINCES_V2: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(Object.fromEntries(anchorRows.map((a) => [a.oldId, a.regionProvinces])), null, 2)};`,
  '',
].join('\n'));

const features: string[] = [];
const regionOfId = new Map<string, Region>();
for (let i = 0; i < N; i++) {
  regionOfId.set(idOf[i]!, regionAt[i]!);
  const polygons = polygonsOfProvince[i]!;
  if (polygons.length === 0) continue;
  const geometry = polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
  features.push(JSON.stringify({ type: 'Feature', id: idOf[i], geometry, properties: { kind: 'province', name: finalName[i], terrain: terrain[i], regionId: regionAt[i]!.key } }));
}
for (const s of settlements) {
  if (s.provinceIndex < 0) continue;
  features.push(JSON.stringify({ type: 'Feature', id: s.id, geometry: { type: 'Point', coordinates: [round5(s.lon), round5(s.lat)] }, properties: { kind: 'settlement', name: s.name, provinceId: idOf[s.provinceIndex], type: s.type } }));
}
writeFileSync(OUT_GEOJSON, `{"type":"FeatureCollection","features":[\n${features.join(',\n')}\n]}\n`);
writeFileSync(OUT_ANCHORS, `${JSON.stringify(Object.fromEntries(anchorRows.map((a) => [a.oldId, { newId: a.newId, name: a.name, settlement: a.settlement, point: a.point, why: a.why, regionProvinces: a.regionProvinces.length }])), null, 2)}\n`);

// ---- report
const count = (xs: readonly string[]): Record<string, number> => xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
console.log(`provinces ${N}, edges ${edgeRows.length} (${JSON.stringify(count(edgeRows.map((e) => e.crossing)))}), polities ${polityRows.length}, settlements ${settlementRows.length}`);
console.log('terrain', JSON.stringify(count(terrain)));
console.log(`old-polity polities lost: ${lostPolities.join(', ') || 'none'}`);
console.log(`provinces flipped to balance polity land: ${rebalanced}`);
if (process.env.DEBUG_POLITY) for (let i = 0; i < N; i++) if (controller[i] === process.env.DEBUG_POLITY) console.log(`  ${idOf[i]} ${P[i]!.areaKm2} km2 cov ${coverage[i]!.toFixed(2)} old=${oldOfProvince[i]} votes=${JSON.stringify([...ownerVotes[i]!])} at ${P[i]!.centroid}`);
console.log(`unowned after overlay: ${controller.filter((c) => c === null).length} (fringe adopted ${fringe}, from the Anatolian file ${fromAnatoliaFile.size})`);
console.log(`settlements snapped to the nearest shore: ${snapped.join('; ') || 'none'}`);
console.log(`provinces adopted by a settlement's polity: ${adopted.length}\n  ${adopted.join('\n  ')}`);
console.log(`provinces sharing settlements: ${shared.map(([i, ids]) => `${idOf[i]!}: ${ids.join('+')}`).join('; ') || 'none'}`);
console.log(`settlements beyond the map, dropped: ${offMap.join(', ') || 'none'}`);
console.log(`off-map capitals: ${offMapPolities.join(', ') || 'none'}`);
console.log(`crossings ${crossings.length}`);
console.log(`wrote ${OUT_GRAPH}\nwrote ${OUT_GEOJSON}\nwrote ${OUT_ANCHORS}`);
