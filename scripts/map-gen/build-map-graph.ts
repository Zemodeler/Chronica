/**
 * From the generated polygons to a game map: the province graph, the GeoJSON, and the anchors that let the
 * scenario be rewired mechanically.
 *
 * Inputs (all in $MAP_GEN_DATA): `<in>.json` and `<in>.samples.json` from generate-provinces.cjs, `old-map.json`
 * (the 780-province map, frozen before the swap), and optionally scripts/map-gen/anatolia-polities.json.
 * Usage (cwd anywhere): MAP_GEN_DATA=<dir> tsx scripts/map-gen/build-map-graph.ts [in=v5] [out=<suffix>]
 * Writes packages/db/src/punic-wars-map-graph.ts, apps/web/public/maps/punic-wars-provinces.geojson and
 * scripts/map-gen/anchors.json; with out=<suffix> the same three files with `-<suffix>` before the extension.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureBorders, type BorderInput, type BorderReport } from './border-metrics';
import { haversineKm, polygonsOf, PolygonIndex, readPolylines, ringAreaKm2, ringContains, signedArea, type Point, type Ring } from './map-geometry';
import { ancientNameOf, featureNameOf, regionOf, type Region } from './map-names';
import { nameProvinces } from './map-region-names';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const DATA = process.env.MAP_GEN_DATA ?? join(ROOT, '.map-gen-data');
const IN = process.argv.find((a) => a.startsWith('in='))?.slice(3) ?? 'map';
const SUFFIX = process.argv.find((a) => a.startsWith('out='))?.slice(4);
const tag = SUFFIX === undefined || SUFFIX === '' ? '' : `-${SUFFIX}`;
const OUT_GRAPH = join(ROOT, `packages/db/src/punic-wars-map-graph${tag}.ts`);
const OUT_GEOJSON = join(ROOT, `apps/web/public/maps/punic-wars-provinces${tag}.geojson`);
const OUT_ANCHORS = join(HERE, `anchors${tag}.json`);
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
  wetFrac: number;
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
// The polity files, one per theatre. Each lists its polities most-specific first; a province is tested against the list of its own theatre.
// A polity named in two files (ptolemaic-egypt) is one polity: the later file's core replaces the earlier one's, and settlements and territory add up.
// The sixth file, zagros, is consulted before the theatre a province lies in: its tribes are the specific claims that outrank the Seleucid default.
const THEATRES = ['anatolia', 'egypt-arabia', 'levant-caucasus-iran', 'iraq', 'zagros'] as const;
type Theatre = (typeof THEATRES)[number];
const territoryLists = new Map<Theatre, { id: string; rings: [number, number][][] }[]>();
const definitions = new Map<string, AnatoliaPolity>();
const absentFiles: string[] = [];
const seleucidCities: AnatoliaSettlement[] = [];
for (const theatre of THEATRES) {
  let file: AnatoliaPolity[];
  try {
    file = (JSON.parse(readFileSync(join(HERE, `${theatre}-polities.json`), 'utf8')) as { polities: AnatoliaPolity[] }).polities;
  } catch {
    absentFiles.push(`${theatre}-polities.json`);
    continue;
  }
  territoryLists.set(theatre, file.map((p) => ({ id: p.id, rings: p.territory })));
  seleucidCities.push(...(JSON.parse(readFileSync(join(HERE, `${theatre}-polities.json`), 'utf8')) as { seleucidCities?: AnatoliaSettlement[] }).seleucidCities ?? []);
  for (const p of file) {
    const before = definitions.get(p.id);
    // a later file may restate a polity it shares: what it says replaces, what it leaves null stands, settlements and territory add
    const said = <T,>(earlier: T, later: T | null | undefined): T => (later === null || later === undefined ? earlier : later);
    definitions.set(p.id, before === undefined ? { ...p } : {
      ...before, ...p, name: said(before.name, p.name), governmentForm: said(before.governmentForm, p.governmentForm), cohesionBps: said(before.cohesionBps, p.cohesionBps),
      capital: said(before.capital, p.capital), reuseExisting: before.reuseExisting,
      otherSettlements: [...before.otherSettlements, ...p.otherSettlements.filter((s) => !before.otherSettlements.some((b) => b.settlementId === s.settlementId) && s.settlementId !== before.capital?.settlementId)],
      territory: [...before.territory, ...p.territory],
    });
  }
}
// the cities the Iraq file gives the Seleucids are settlements of the one seleucid-empire, except two whose site is uncertain
const UNCERTAIN_SITES = new Set(['settlement-apamea-tigris', 'settlement-charax-alexandria']);
{
  const seleucid = definitions.get('seleucid-empire');
  if (seleucid !== undefined) seleucid.otherSettlements = [...seleucid.otherSettlements, ...seleucidCities.filter((c) => !UNCERTAIN_SITES.has(c.settlementId) && !seleucid.otherSettlements.some((o) => o.settlementId === c.settlementId) && c.settlementId !== seleucid.capital?.settlementId)];
}
const anatolia: AnatoliaPolity[] = [...definitions.values()];
const missing = absentFiles.filter((f) => f !== 'zagros-polities.json');
if (missing.length > 0) console.log(`absent, so their provinces stay unowned: ${missing.join(', ')}`);

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
/** Rings walked with the inside on the right become polygons: outer rings and the holes each lies in. */
function assemble(rawRings: readonly Ring[]): Ring[][] {
  const cleaned = rawRings.map(tidy).filter((r): r is Ring => r !== null);
  if (cleaned.length === 0) return [];
  const areas = cleaned.map((r) => signedArea(r));
  const orientation = Math.sign(areas.reduce((a, b) => (Math.abs(a) >= Math.abs(b) ? a : b)));
  const polygons: { rings: Ring[]; box: number[] }[] = [];
  const boxOf = (r: Ring): number[] => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
  cleaned.forEach((r, k) => { if (Math.sign(areas[k]!) === orientation) { const outer = areas[k]! > 0 ? r : [...r].reverse(); polygons.push({ rings: [outer], box: boxOf(outer) }); } });
  polygons.sort((a, b) => ringAreaKm2(a.rings[0]!) - ringAreaKm2(b.rings[0]!));
  cleaned.forEach((hole0, k) => {
    if (Math.sign(areas[k]!) === orientation) return;
    const hole = areas[k]! < 0 ? hole0 : [...hole0].reverse();
    const probe: Point = [(hole[0]![0] + hole[1]![0] + hole[2]![0]) / 3, (hole[0]![1] + hole[1]![1] + hole[2]![1]) / 3];
    const home = polygons.find((polygon) => probe[0] >= polygon.box[0]! && probe[0] <= polygon.box[2]! && probe[1] >= polygon.box[1]! && probe[1] <= polygon.box[3]! && ringContains(polygon.rings[0]!, probe[0], probe[1]));
    if (home) home.rings.push(hole);
  });
  return polygons.map((p) => p.rings);
}
const polygonsOfProvince: Ring[][][] = gen.rings.map((rings) => assemble(rings));
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
const world = JSON.parse(readFileSync(join(ROOT, 'apps/web/public/maps/natural-earth-50m-admin0-countries.geojson'), 'utf8')) as { features: { properties: { ADMIN: string }; geometry: { type: string; coordinates: unknown } }[] };
const turkey = world.features.find((f) => f.properties.ADMIN === 'Turkey')!;
// everything Turkish except the sliver of Thrace: the mainland and its islands
const turkishThrace = (ring: Ring): boolean => Math.max(...ring.map((c) => c[1])) > 41.8 && Math.max(...ring.map((c) => c[0])) < 29.3;
const asiaMinors = polygonsOf(turkey.geometry).map((polygon) => polygon[0]!).filter((ring) => !turkishThrace(ring));
// the settled countries of the eastern theatres, by their Natural Earth outlines
const countryRings = (names: string[]): Ring[] => world.features.filter((f) => names.includes(f.properties.ADMIN)).flatMap((f) => polygonsOf(f.geometry).map((polygon) => polygon[0]!));
const egyptArabiaRings = countryRings(['Egypt', 'Saudi Arabia', 'Sudan']);
const iraqRings = countryRings(['Iraq', 'Kuwait']);
const levantRings = countryRings(['Syria', 'Lebanon', 'Israel', 'Palestine', 'Jordan', 'Georgia', 'Armenia', 'Azerbaijan', 'Iran']);
const shareIn = (rings: Ring[], i: number): number => {
  const pts = samples[i]!;
  let inside = 0;
  for (let k = 0; k < pts.length; k += 2) if (rings.some((ring) => ringContains(ring, pts[k]!, pts[k + 1]!))) inside++;
  return inside / (pts.length / 2);
};
const theatreOf = (i: number): Theatre | null => (anatolianShare(i) >= 0.5 ? 'anatolia' : shareIn(egyptArabiaRings, i) >= 0.5 ? 'egypt-arabia' : shareIn(levantRings, i) >= 0.5 ? 'levant-caucasus-iran' : shareIn(iraqRings, i) >= 0.5 ? 'iraq' : null);
const anatolianShare = (i: number): number => {
  const pts = samples[i]!;
  let inside = 0;
  for (let k = 0; k < pts.length; k += 2) if (asiaMinors.some((ring) => ringContains(ring, pts[k]!, pts[k + 1]!))) inside++;
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
  if (controller[i] !== null) continue;
  const theatre = theatreOf(i);
  // the zagros tribes first (specific claims that outrank the Seleucid default), then the province's own theatre in file order
  const own = theatre === null ? [] : territoryLists.get(theatre) ?? [];
  const [x, y] = centreSample(i);
  const firstIn = (list: { id: string; rings: [number, number][][] }[]): string | null => { for (const polity of list) for (const territory of polity.rings) if (ringContains(territory, x, y)) return polity.id; return null; };
  const claim = firstIn(territoryLists.get('zagros') ?? []) ?? firstIn(own);
  if (claim !== null) { controller[i] = claim; fromAnatoliaFile.add(i); }
}
// Ground the old map did not cover and no polity claims (coastal slivers, the map's own fringe) goes to its land neighbours' commonest owner.
const unowned = (): number[] => controller.flatMap((c, i) => (c === null ? [i] : []));
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

// An island or islet no land border reaches takes the polity of the nearest held province.
let islandsAdopted = 0;
for (let i = 0; i < N; i++) {
  if (controller[i] !== null) continue;
  let best = -1;
  let bestKm = 200;
  for (let j = 0; j < N; j++) {
    if (controller[j] === null) continue;
    const d = haversineKm(centreOf(i), centreOf(j));
    if (d < bestKm) { bestKm = d; best = j; }
  }
  if (best >= 0) { controller[i] = controller[best]!; islandsAdopted++; }
}

// ---- settlements
interface Settlement { id: string; name: string; kind: string; type: string; provinceIndex: number; controllerPolityId: string; size: number; fortificationLevel: number; lon: number; lat: number; snapKm: number }
const settlements: Settlement[] = [];
const snapped: string[] = [];
const offMap: string[] = [];
/** The province holding a place; one that lies offshore by a few km is put back on the shore, a kilometre and a half inside its province. */
function homeOf(lon: number, lat: number): { index: number; snapKm: number; at: Point } {
  const inside = provinceAt(lon, lat);
  if (inside >= 0) return { index: inside, snapKm: 0, at: [lon, lat] };
  let best = -1;
  let bestKm = Infinity;
  let bestAt: Point = [lon, lat];
  for (let i = 0; i < N; i++) {
    if (haversineKm([lon, lat], P[i]!.centroid) > 150) continue;
    for (const polygon of polygonsOfProvince[i]!) for (const [x, y] of polygon[0]!) {
      const d = haversineKm([lon, lat], [x, y]);
      if (d < bestKm) { bestKm = d; best = i; bestAt = [x, y]; }
    }
  }
  if (best >= 0 && bestKm <= 25) {
    const [cx, cy] = P[best]!.centroid;
    const toCentre = haversineKm(bestAt, [cx, cy]);
    const f = Math.min(0.5, 1.5 / Math.max(toCentre, 1e-6));
    const moved: Point = [round5(bestAt[0] + (cx - bestAt[0]) * f), round5(bestAt[1] + (cy - bestAt[1]) * f)];
    if (provinceAt(moved[0], moved[1]) === best) bestAt = moved;
  }
  return { index: best, snapKm: bestKm, at: bestAt };
}
const capitalOfPolity = new Map(old.polities.filter((p) => p.capitalSettlementId).map((p) => [p.capitalSettlementId!, p.polityId]));
// Where a pin was wrong: the coordinate of the same place in Pleiades (scripts/map-gen/audit-settlements.cjs lists every pin
// further than 5 km from it). The old map put Utica half a degree east of the site, in the Gulf of Tunis, and Lilybaeum fifty
// kilometres inland, in the hills above Alcamo; the polity files' Isaura, Aspendos, Melitene and others were off by a few miles.
const CORRECTED: Record<string, [number, number]> = {
  'settlement-utica': [10.06, 37.06], 'settlement-lilybaeum': [12.4297, 37.8027], 'settlement-volsinii': [11.9851, 42.648],
  'settlement-capua': [14.2502, 41.0861], 'settlement-bovianum': [14.4739, 41.4867], 'settlement-arpi': [15.5554, 41.4757],
  'settlement-thapsus': [11.0427, 35.6214], 'settlement-iol': [2.192, 36.607], 'settlement-leptis-minor': [10.87, 35.667],
  'settlement-garama': [13.063, 26.545], 'settlement-apollonia-cyrene': [21.971, 32.902], 'settlement-isaura': [32.3535, 37.1904],
  'settlement-aspendos': [31.1697, 36.9404], 'settlement-urbnisi': [43.9808, 42.0125], 'settlement-vani': [42.5015, 42.0838],
  'settlement-melitene': [38.3612, 38.3822], 'settlement-aila': [35.0, 29.5306], 'settlement-uplistsikhe': [44.1493, 41.9679],
  'settlement-hecatompylos': [54.0383, 35.9611],
};
// The towns the story is about, at the size and with the walls it needs: a siege of Volsinii or a venture out of Syracuse turns on
// what these towns really were, where the map would draw every city alike.
const AUTHORED_TOWNS: Record<string, { kind: string; size: number; fortificationLevel: number }> = {
  'settlement-genua': { kind: 'port', size: 45, fortificationLevel: 3 },
  'settlement-mediolanum': { kind: 'city', size: 55, fortificationLevel: 3 },
  'settlement-bononia': { kind: 'town', size: 35, fortificationLevel: 2 },
  'settlement-patavium': { kind: 'city', size: 50, fortificationLevel: 2 },
  'settlement-volsinii': { kind: 'city', size: 35, fortificationLevel: 4 },
  'settlement-arretium': { kind: 'city', size: 40, fortificationLevel: 3 },
  'settlement-cosa': { kind: 'fortress', size: 15, fortificationLevel: 3 },
  'settlement-iguvium': { kind: 'town', size: 30, fortificationLevel: 2 },
  'settlement-narnia': { kind: 'fortress', size: 15, fortificationLevel: 3 },
  'settlement-asculum': { kind: 'city', size: 40, fortificationLevel: 3 },
  'settlement-corfinium': { kind: 'town', size: 30, fortificationLevel: 2 },
  'settlement-alba-fucens': { kind: 'fortress', size: 15, fortificationLevel: 3 },
  'settlement-rome': { kind: 'city', size: 100, fortificationLevel: 6 },
  'settlement-bovianum': { kind: 'town', size: 25, fortificationLevel: 3 },
  'settlement-naples': { kind: 'city', size: 60, fortificationLevel: 3 },
  'settlement-capua': { kind: 'city', size: 65, fortificationLevel: 4 },
  'settlement-rhegium': { kind: 'port', size: 40, fortificationLevel: 3 },
  'settlement-consentia': { kind: 'town', size: 35, fortificationLevel: 2 },
  'settlement-grumentum': { kind: 'town', size: 30, fortificationLevel: 2 },
  'settlement-venusia': { kind: 'fortress', size: 20, fortificationLevel: 3 },
  'settlement-tarentum': { kind: 'port', size: 60, fortificationLevel: 4 },
  'settlement-arpi': { kind: 'city', size: 35, fortificationLevel: 2 },
  'settlement-luceria': { kind: 'fortress', size: 20, fortificationLevel: 3 },
  'settlement-brundisium': { kind: 'port', size: 35, fortificationLevel: 2 },
  'settlement-carthage': { kind: 'city', size: 100, fortificationLevel: 6 },
  'settlement-lilybaeum': { kind: 'port', size: 45, fortificationLevel: 4 },
  'settlement-panormus': { kind: 'city', size: 55, fortificationLevel: 3 },
  'settlement-agrigentum': { kind: 'city', size: 30, fortificationLevel: 4 },
  'settlement-syracuse': { kind: 'port', size: 90, fortificationLevel: 5 },
  'settlement-messana': { kind: 'port', size: 50, fortificationLevel: 3 },
};
for (const s of old.settlements) {
  if (CORRECTED[s.id]) s.coordinate = CORRECTED[s.id]!;
  if (AUTHORED_TOWNS[s.id]) Object.assign(s, AUTHORED_TOWNS[s.id]);
  const home = homeOf(s.coordinate[0], s.coordinate[1]);
  if (home.snapKm > 0) snapped.push(`${s.id} ${home.snapKm.toFixed(1)} km`);
  if (home.snapKm > 25) { offMap.push(s.id); continue; }
  settlements.push({ id: s.id, name: s.name, kind: s.kind, type: s.type, provinceIndex: home.index, controllerPolityId: s.controllerPolityId, size: s.size, fortificationLevel: s.fortificationLevel, lon: home.snapKm > 0 && home.snapKm <= 25 ? home.at[0] : s.coordinate[0], lat: home.snapKm > 0 && home.snapKm <= 25 ? home.at[1] : s.coordinate[1], snapKm: home.snapKm });
}
const kindType: Record<string, string> = { city: 'city', town: 'town', village: 'village', fortress: 'fort', port: 'port' };
const anatoliaCapital = new Map<string, string>();
const offMapPolities: string[] = [];
for (const polity of anatolia) {
  const all = [polity.capital, ...polity.otherSettlements].filter((s): s is AnatoliaSettlement => s !== null);
  if (polity.capital?.offMap) offMapPolities.push(polity.id);
  for (const s of all) {
    if (s.offMap) continue;
    if (CORRECTED[s.settlementId]) [s.lon, s.lat] = CORRECTED[s.settlementId]!;
    const home = homeOf(s.lon, s.lat);
    if (home.snapKm > 0) snapped.push(`${s.settlementId} ${home.snapKm.toFixed(1)} km`);
    if (home.snapKm > 25) { offMap.push(s.settlementId); continue; }
    settlements.push({ id: s.settlementId, name: s.name, kind: s.kind, type: kindType[s.kind] ?? 'town', provinceIndex: home.index, controllerPolityId: polity.id, size: s.size, fortificationLevel: s.fortificationLevel, lon: home.snapKm > 0 && home.snapKm <= 25 ? home.at[0] : s.lon, lat: home.snapKm > 0 && home.snapKm <= 25 ? home.at[1] : s.lat, snapKm: home.snapKm });
    if (s === polity.capital) anatoliaCapital.set(polity.id, s.settlementId);
  }
}
// A capital stands in its own polity's ground, and the Anatolian file is the authority for the towns it names.
const adopted: string[] = [];
for (const s of settlements) {
  const isOldCapital = capitalOfPolity.get(s.id);
  const isNewCapital = anatoliaCapital.get(s.controllerPolityId) === s.id;
  const fromFile = anatolia.some((p) => p.id === s.controllerPolityId);
  if ((isOldCapital || isNewCapital || fromFile) && controller[s.provinceIndex] !== s.controllerPolityId) {
    adopted.push(`${idOf[s.provinceIndex]} ${controller[s.provinceIndex] ?? 'none'} -> ${s.controllerPolityId} (${s.id})`);
    controller[s.provinceIndex] = s.controllerPolityId;
  }
}
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
const anchorOwners: string[] = [];
for (const [oldId, settlementId] of ANCHORS) {
  const home = settlements.find((x) => x.id === settlementId)!.provinceIndex;
  const owner = old.provinces.find((p) => p.id === oldId)!.controller;
  if (controller[home] !== owner) { anchorOwners.push(`${idOf[home]} ${controller[home]} -> ${owner} (${oldId})`); controller[home] = owner; }
}
// One settlement per province unless two must share: report the sharing.
const sharing = new Map<number, string[]>();
for (const s of settlements) sharing.set(s.provinceIndex, [...(sharing.get(s.provinceIndex) ?? []), s.id]);
const shared = [...sharing.entries()].filter(([, ids]) => ids.length > 1);

// ---- terrain
const terrain: string[] = P.map((p) => {
  if (p.coast) return 'coastal-plain';
  const lat = p.centroid[1];
  if (lat < 34.5 && p.riverFrac < 0.02 && p.wetFrac < 0.5) return 'desert-steppe';
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

// A city or town on the shore is a port: ships can lie there, and ventures and blockades need one. The shore is the AWMC coastline
// (the sea's edge in antiquity), not the raster's empty ground, which also borders deserts and high massifs.
const COAST_CELL = 0.1;
const coastCells = new Map<string, [Point, Point][]>();
for (const line of readPolylines(readFileSync(join(DATA, 'data/awmc/coastline/coastline.shp')))) {
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const b = line[k]!;
    for (let gx = Math.floor(Math.min(a[0], b[0]) / COAST_CELL); gx <= Math.floor(Math.max(a[0], b[0]) / COAST_CELL); gx++) {
      for (let gy = Math.floor(Math.min(a[1], b[1]) / COAST_CELL); gy <= Math.floor(Math.max(a[1], b[1]) / COAST_CELL); gy++) {
        const key = `${gx},${gy}`;
        const cell = coastCells.get(key);
        if (cell) cell.push([a, b]); else coastCells.set(key, [[a, b]]);
      }
    }
  }
}
const PORT_KM = 4;
const kmToCoast = (lon: number, lat: number): number => {
  const kx = Math.cos((lat * Math.PI) / 180) * 111.2;
  let best = Infinity;
  for (let gx = Math.floor(lon / COAST_CELL) - 1; gx <= Math.floor(lon / COAST_CELL) + 1; gx++) {
    for (let gy = Math.floor(lat / COAST_CELL) - 1; gy <= Math.floor(lat / COAST_CELL) + 1; gy++) {
      for (const [a, b] of coastCells.get(`${gx},${gy}`) ?? []) {
        const ax = a[0] * kx, ay = a[1] * 111.2, dx = b[0] * kx - ax, dy = b[1] * 111.2 - ay;
        const t = Math.max(0, Math.min(1, ((lon * kx - ax) * dx + (lat * 111.2 - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(lon * kx - (ax + t * dx), lat * 111.2 - (ay + t * dy)));
      }
    }
  }
  return best;
};
const madePorts: string[] = [];
for (const s of settlements) {
  if ((s.kind === 'city' || s.kind === 'town') && kmToCoast(s.lon, s.lat) <= PORT_KM) {
    s.kind = 'port';
    if (s.type !== 'capital') s.type = 'port';
    madePorts.push(s.id);
  }
}

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

// ---- ownership corrections (research files), then smoothing: polities as one flowing region each
// The corrections are applied after the polity-file overlay and before the cleaning, so a corrected border comes out as clean as any other.
// Each is a polygon and a polity; a province whose centre lies inside takes that polity (later entries win). A province that holds a capital, an anchor,
// or a town a polity file gives to another polity keeps its owner, and the clash is reported. Files: scripts/map-gen/ownership-corrections*.json.
// the towns a polity file gives to a polity: a piece of its land that holds one is a region of the polity, not a stray
const fileSettlement = new Set<string>();
for (const p of anatolia) for (const s of [p.capital, ...p.otherSettlements]) if (s) fileSettlement.add(s.settlementId);
const correctionReport = {
  files: [] as string[], invalid: [] as string[], changed: [] as { file: string; id: string; provinces: string[]; from: Record<string, number>; to: string }[],
  conflicts: [] as string[], pairs: {} as Record<string, number>, settlementsFollowed: [] as string[], unknownPolities: [] as string[],
};
// what a correction gives away stays owned even where it is open desert, unless the entry says `"openDesert": "unowned"` (then the desert rule below still applies)
const correctedProvinces = new Set<number>();
const holdsDesert = new Set<number>();
// every province a correction decides is pinned against the cleaning, changed or not (a tribal confederation with no capital would be folded back into its neighbour otherwise)
const pinned = new Set<number>();
{
  const known = new Set<string>([...old.polities.map((p) => p.polityId), ...anatolia.map((p) => p.id), ...controller.filter((c): c is string => c !== null)]);
  const holdsCapital = new Map<number, string>();
  for (const s of settlements) {
    if (s.provinceIndex < 0) continue;
    if (capitalOfPolity.has(s.id) || [...anatoliaCapital.values()].includes(s.id)) holdsCapital.set(s.provinceIndex, `capital ${s.id}`);
  }
  for (const [, settlementId] of ANCHORS) { const s = settlements.find((x) => x.id === settlementId)!; holdsCapital.set(s.provinceIndex, `anchor ${s.id}`); }
  const simple = (ring: [number, number][]): boolean => {
    const m = ring.length - 1;
    const cross = (a: number[], b: number[], c: number[], d: number[]): boolean => {
      const o = (p: number[], q: number[], r: number[]): number => Math.sign((q[0]! - p[0]!) * (r[1]! - p[1]!) - (q[1]! - p[1]!) * (r[0]! - p[0]!));
      return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
    };
    for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) { if (i === 0 && j === m - 1) continue; if (cross(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return false; }
    return true;
  };
  const files = readdirSync(HERE).filter((f) => /^ownership-corrections.*\.json$/.test(f)).sort();
  for (const file of files) {
    correctionReport.files.push(file);
    const raw = JSON.parse(readFileSync(join(HERE, file), 'utf8')) as unknown;
    const list = (Array.isArray(raw) ? raw : ((raw as Record<string, unknown>).assignments ?? (raw as Record<string, unknown>).corrections ?? [])) as {
      id: string; polity: string; openDesert?: string; onlyFrom?: string[]; polygon?: [number, number][]; polygons?: [number, number][][]; polygonList?: [number, number][][];
    }[];
    for (const entry of list) {
      const rings = (entry.polygons ?? entry.polygonList ?? (entry.polygon ? [entry.polygon] : [])).map((r) => {
        const ring = r.map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
        if (ring.length > 0 && (ring[0]![0] !== ring[ring.length - 1]![0] || ring[0]![1] !== ring[ring.length - 1]![1])) ring.push([ring[0]![0], ring[0]![1]]);
        return ring;
      });
      const bad = rings.length === 0 ? 'no polygon' : rings.some((r) => r.length < 4 || r.some((c) => !Number.isFinite(c[0]) || !Number.isFinite(c[1]))) ? 'fewer than three points or a non-number' : rings.some((r) => !simple(r)) ? 'crosses itself' : null;
      if (bad !== null) { correctionReport.invalid.push(`${file} ${entry.id}: ${bad}`); continue; }
      if (entry.polity !== 'unowned' && !known.has(entry.polity)) { correctionReport.unknownPolities.push(`${file} ${entry.id}: ${entry.polity}`); continue; }
      const to = entry.polity === 'unowned' ? null : entry.polity;
      const moved: string[] = [];
      const from: Record<string, number> = {};
      for (let i = 0; i < N; i++) {
        const [x, y] = centreSample(i);
        if (!rings.some((r) => ringContains(r, x, y))) continue;
        if (entry.onlyFrom !== undefined && !entry.onlyFrom.includes(controller[i] ?? 'unowned')) continue;
        if (controller[i] === to) { if (to !== null && !holdsCapital.has(i)) pinned.add(i); if (to !== null && entry.openDesert !== 'unowned') holdsDesert.add(i); else holdsDesert.delete(i); continue; }
        const guard = holdsCapital.get(i) ?? settlements.filter((s) => s.provinceIndex === i && fileSettlement.has(s.id) && s.controllerPolityId !== to).map((s) => `polity-file town ${s.id}`)[0];
        if (guard) { correctionReport.conflicts.push(`${file} ${entry.id}: ${idOf[i]} stays ${controller[i] ?? 'unowned'} (${guard}); correction says ${entry.polity}`); continue; }
        const was = controller[i] ?? 'unowned';
        from[was] = (from[was] ?? 0) + 1;
        correctionReport.pairs[`${was} -> ${entry.polity}`] = (correctionReport.pairs[`${was} -> ${entry.polity}`] ?? 0) + 1;
        for (const s of settlements) if (s.provinceIndex === i && to !== null && s.controllerPolityId !== to) { correctionReport.settlementsFollowed.push(`${s.id} ${s.controllerPolityId} -> ${to}`); s.controllerPolityId = to; }
        controller[i] = to;
        correctedProvinces.add(i);
        pinned.add(i);
        if (to !== null && entry.openDesert !== 'unowned') holdsDesert.add(i); else holdsDesert.delete(i);
        moved.push(idOf[i]!);
      }
      correctionReport.changed.push({ file, id: entry.id, provinces: moved, from, to: entry.polity });
    }
  }
}

// The cleaning is a labelling problem on the province graph, in two stages that share one bound on how far a polity may drift.
// Stage 1 minimises the border length between polities plus a pull back toward the old map's owner (iterated conditional modes).
// Stage 2 is stricter about shape: a lighter pull, a curvature term that charges a border for every extra turn around a province,
// an explicit removal of spikes (60% or more of a province's border against one other polity) and of provinces that would cut their
// polity in two, then the exclaves folded again. The measures are in border-metrics.ts.
const smoothing = { edgesBefore: 0, edgesAfter: 0, componentsBefore: 0, componentsAfter: 0, flipped: 0, folded: 0, foldedSettlements: [] as string[], remainingSplits: [] as string[], shifted: [] as string[], flippedStage2: 0, spikesRemoved: 0 };
const borderInput = (): BorderInput => ({ n: N, adj: P.map((p) => p.adj), owner: controller, centroid: P.map((p) => p.centroid), landmass: P.map((_, i) => find(i)) });
const borderReports: Record<string, BorderReport> = {};
const areaByPolity = (): Map<string, number> => { const m = new Map<string, number>(); for (let i = 0; i < N; i++) if (controller[i]) m.set(controller[i]!, (m.get(controller[i]!) ?? 0) + P[i]!.areaKm2); return m; };
const areaPreClean = areaByPolity();
borderReports.overlay = measureBorders(borderInput());
// a pinned group of one or two provinces that stands as a spike or a neck of its polity is let go to the cleaning, and reported
const releasedPins: string[] = [];
{
  const flagged = new Set([...borderReports.overlay.spikes, ...borderReports.overlay.necks]);
  const done = new Set<number>();
  for (const start of [...pinned]) {
    if (done.has(start)) continue;
    const group = [start];
    done.add(start);
    for (let k = 0; k < group.length; k++) for (const a of P[group[k]!]!.adj) if (pinned.has(a.n) && !done.has(a.n) && controller[a.n] === controller[start]) { done.add(a.n); group.push(a.n); }
    if (group.length <= 2 && group.some((i) => flagged.has(i))) for (const i of group) { pinned.delete(i); releasedPins.push(`${idOf[i]} (${controller[i]})`); }
  }
}
{
  const LAMBDA = 0.25;
  const SEA_POWERS = new Set(['ptolemaic-egypt']);
  const fixed = new Set<number>(settlements.filter((s) => s.provinceIndex >= 0).map((s) => s.provinceIndex));
  for (const i of pinned) fixed.add(i);
  const protectedProvince = new Set<number>(pinned);
  for (const s of settlements) if (capitalOfPolity.has(s.id) || [...anatoliaCapital.values()].includes(s.id)) protectedProvince.add(s.provinceIndex);
  for (const [, settlementId] of ANCHORS) protectedProvince.add(settlements.find((x) => x.id === settlementId)!.provinceIndex);
  const origin = [...controller];
  const perimeter = P.map((p) => p.adj.reduce((sum, a) => sum + a.km, 0));
  const shareOf = (i: number, id: string): number => {
    if (coverage[i]! >= 0.35) { const covered = [...ownerVotes[i]!.values()].reduce((a, b) => a + b, 0); return (ownerVotes[i]!.get(id) ?? 0) / covered; }
    return origin[i] === id ? 1 : 0;
  };
  const held = new Map<string, number>();
  for (const c of controller) if (c) held.set(c, (held.get(c) ?? 0) + 1);
  // a polity may not drift more than 8% from the land its old ground now amounts to
  const areaHeld = areaByPolity();
  const target = new Map<string, number>();
  for (const id of areaHeld.keys()) target.set(id, P.reduce((sum, p, i) => sum + p.areaKm2 * shareOf(i, id), 0));
  const allowed = (from: string, to: string, area: number): boolean =>
    ((target.get(from) ?? 0) < 3000 || areaHeld.get(from)! - area >= 0.92 * target.get(from)!) && ((target.get(to) ?? 0) < 3000 || (areaHeld.get(to) ?? 0) + area <= 1.08 * target.get(to)!);
  // stage 2 holds every polity within 10% of the land it had before any cleaning and before stage 2; a polity a correction gave land to or took it from
  // is held to 2%, so the cleaning does not move a border the research has just placed
  const touchedByCorrection = new Set<string>();
  for (const c of correctionReport.changed) if (c.provinces.length > 0) { touchedByCorrection.add(c.to); for (const f of Object.keys(c.from)) touchedByCorrection.add(f); }
  let areaStage1 = new Map<string, number>();
  const band = (id: string): number => (touchedByCorrection.has(id) ? 0.02 : 0.1);
  const allowedTight = (from: string, to: string, area: number): boolean => {
    const keeps = (id: string, delta: number): boolean => {
      const held1 = areaHeld.get(id) ?? 0;
      for (const base of [areaPreClean.get(id) ?? 0, areaStage1.get(id) ?? 0]) if (base >= 3000 && Math.abs(held1 + delta - base) > band(id) * base && Math.abs(held1 + delta - base) > Math.abs(held1 - base)) return false;
      return true;
    };
    return keeps(from, -area) && keeps(to, area);
  };
  const borderEdges = (): number => { let n = 0; for (let i = 0; i < N; i++) for (const a of P[i]!.adj) if (a.n > i && controller[i] !== controller[a.n]) n++; return n; };
  const componentsOf = (): Map<string, number[][]> => {
    const seen = new Set<number>();
    const out = new Map<string, number[][]>();
    for (let i = 0; i < N; i++) {
      if (seen.has(i) || controller[i] === null) continue;
      const comp = [i];
      seen.add(i);
      for (let k = 0; k < comp.length; k++) for (const a of P[comp[k]!]!.adj) if (!seen.has(a.n) && controller[a.n] === controller[i]) { seen.add(a.n); comp.push(a.n); }
      (out.get(controller[i]!) ?? out.set(controller[i]!, []).get(controller[i]!)!).push(comp);
    }
    return out;
  };
  smoothing.edgesBefore = borderEdges();
  smoothing.componentsBefore = [...componentsOf().values()].reduce((s, c) => s + c.length, 0);
  const order = P.map((_, i) => i).sort((a, b) => idOf[a]!.localeCompare(idOf[b]!));
  const settle = (i: number, to: string): void => {
    const from = controller[i]!;
    for (const s of settlements) if (s.provinceIndex === i && s.controllerPolityId === from) { s.controllerPolityId = to; smoothing.foldedSettlements.push(`${s.id} ${from} -> ${to}`); }
    held.set(from, held.get(from)! - 1);
    held.set(to, (held.get(to) ?? 0) + 1);
    areaHeld.set(from, areaHeld.get(from)! - P[i]!.areaKm2);
    areaHeld.set(to, (areaHeld.get(to) ?? 0) + P[i]!.areaKm2);
    controller[i] = to;
  };
  const flip = (i: number, to: string): void => {
    const from = controller[i]!;
    held.set(from, held.get(from)! - 1); held.set(to, (held.get(to) ?? 0) + 1);
    areaHeld.set(from, areaHeld.get(from)! - P[i]!.areaKm2); areaHeld.set(to, (areaHeld.get(to) ?? 0) + P[i]!.areaKm2);
    controller[i] = to;
  };
  // the neighbours of a province in the order they lie around it; a gap wider than 0.7 pi is coast, where the ring is open
  const ring = P.map((p, i) => {
    const cos = Math.cos((p.centroid[1] * Math.PI) / 180);
    return p.adj.map((a) => ({ n: a.n, angle: Math.atan2(P[a.n]!.centroid[1] - p.centroid[1], (P[a.n]!.centroid[0] - p.centroid[0]) * cos) })).sort((u, v) => u.angle - v.angle);
  });
  /** turns beyond the one clean crossing that the border of `label` makes around province i */
  const excessTurns = (i: number, label: string): number => {
    const r = ring[i]!;
    if (r.length < 3) return 0;
    let turns = 0;
    let open = false;
    for (let k = 0; k < r.length; k++) {
      const next = r[(k + 1) % r.length]!;
      const gap = (next.angle - r[k]!.angle + 2 * Math.PI) % (2 * Math.PI);
      if (gap > 0.7 * Math.PI) { open = true; continue; }
      if ((controller[r[k]!.n] === label) !== (controller[next.n] === label)) turns++;
    }
    return turns === 0 ? 0 : Math.max(0, turns - (open ? 1 : 2));
  };
  // does the polity of province i stay in one piece around it if i leaves? (looked at locally, 300 provinces deep)
  const staysWhole = (i: number): boolean => {
    const own = P[i]!.adj.filter((a) => controller[a.n] === controller[i]).map((a) => a.n);
    if (own.length <= 1) return true;
    const seen = new Set<number>([own[0]!, i]);
    const queue = [own[0]!];
    for (let q = 0; q < queue.length && seen.size < 300; q++) for (const a of P[queue[q]!]!.adj) if (!seen.has(a.n) && controller[a.n] === controller[i]) { seen.add(a.n); queue.push(a.n); }
    return seen.size >= 300 || own.every((n) => seen.has(n));
  };
  const icm = (params: { lambda: number; curvature: number; ok: (from: string, to: string, area: number) => boolean; spikes: boolean; connected: boolean }): number => {
    let total = 0;
    for (let pass = 0; pass < 120; pass++) {
      let moved = 0;
      for (const i of order) {
        if (fixed.has(i) || controller[i] === null || held.get(controller[i]!)! <= 1) continue;
        const candidates = new Set<string>([controller[i]!]);
        for (const a of P[i]!.adj) if (controller[a.n]) candidates.add(controller[a.n]!);
        if (candidates.size === 1) continue;
        const energy = (label: string): number => P[i]!.adj.reduce((sum, a) => sum + (controller[a.n] !== label ? a.km : 0), 0) + params.lambda * perimeter[i]! * (1 - shareOf(i, label)) + params.curvature * perimeter[i]! * excessTurns(i, label);
        let best = controller[i]!;
        let bestEnergy = energy(best) - 1e-6;
        for (const label of [...candidates].sort()) {
          if (label === controller[i] || !params.ok(controller[i]!, label, P[i]!.areaKm2)) continue;
          const e = energy(label);
          if (e < bestEnergy) { bestEnergy = e; best = label; }
        }
        if (params.spikes && best === controller[i]) {
          // a spike or a notch: most of the border against one other polity
          const against = new Map<string, number>();
          for (const a of P[i]!.adj) { const c = controller[a.n]; if (c && c !== controller[i]) against.set(c, (against.get(c) ?? 0) + a.km); }
          const [top, km] = [...against.entries()].sort((u, v) => v[1] - u[1] || u[0].localeCompare(v[0]))[0] ?? [null, 0];
          if (top !== null && km >= 0.6 * perimeter[i]! && params.ok(controller[i]!, top, P[i]!.areaKm2)) { best = top; smoothing.spikesRemoved++; }
        }
        if (best !== controller[i]) {
          if (params.connected && !staysWhole(i)) continue;
          flip(i, best);
          moved++;
          if (params.spikes) smoothing.flippedStage2++; else smoothing.flipped++;
        }
      }
      total += moved;
      if (moved === 0) break;
    }
    return total;
  };
  // exclaves: on one landmass a polity is one piece; a small piece with no capital or anchor joins the polity around it (the piece keeps the neighbour that can best take the land; a capital or anchor keeps its piece, and is reported)
  const foldExclaves = (): number => {
    let changed = 0;
    for (const [polity, comps] of componentsOf()) {
      const byLandmass = new Map<number, number[][]>();
      for (const comp of comps) (byLandmass.get(find(comp[0]!)) ?? byLandmass.set(find(comp[0]!), []).get(find(comp[0]!))!).push(comp);
      for (const group of byLandmass.values()) {
        if (group.length < 2) continue;
        const areaOf = (c: number[]): number => c.reduce((s, i) => s + P[i]!.areaKm2, 0);
        group.sort((a, b) => areaOf(b) - areaOf(a));
        for (const comp of group.slice(1)) {
          if (comp.some((i) => protectedProvince.has(i))) continue;
          // the Ptolemies held Asia Minor's coast by sea: a piece with a town of theirs is a garrison, not an exclave to fold
          // a piece of eight provinces or more with a town its polity file gave it (Persepolis and Pasargadae behind the Zagros tribes) is a region, not an exclave
          if (comp.length >= 8 && comp.some((i) => settlements.some((s) => s.provinceIndex === i && s.controllerPolityId === polity && fileSettlement.has(s.id)))) continue;
          if (SEA_POWERS.has(polity) && comp.some((i) => settlements.some((s) => s.provinceIndex === i && s.controllerPolityId === polity))) continue;
          const border = new Map<string, number>();
          for (const i of comp) for (const a of P[i]!.adj) { const c = controller[a.n]; if (c && c !== polity) border.set(c, (border.get(c) ?? 0) + a.km); }
          const ranked = [...border.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
          const over = (id: string): number => ((areaHeld.get(id) ?? 0) + areaOf(comp)) / Math.max(1, target.get(id) ?? 1);
          const to = ranked.find((id) => over(id) <= 1.15) ?? [...ranked].sort((a, b) => over(a) - over(b))[0];
          if (!to) continue;
          for (const i of comp) settle(i, to);
          changed += comp.length;
          smoothing.folded += comp.length;
        }
      }
    }
    return changed;
  };
  for (let round = 0; round < 8; round++) {
    const changed = icm({ lambda: LAMBDA, curvature: 0, ok: allowed, spikes: false, connected: false }) + foldExclaves();
    if (changed === 0) break;
  }
  borderReports.stage1 = measureBorders(borderInput());
  areaStage1 = areaByPolity();
  for (let round = 0; round < 8; round++) {
    const changed = icm({ lambda: 0.1, curvature: 0.12, ok: allowedTight, spikes: true, connected: true }) + foldExclaves();
    if (changed === 0) break;
  }
  smoothing.edgesAfter = borderEdges();
  const after = componentsOf();
  smoothing.componentsAfter = [...after.values()].reduce((s, c) => s + c.length, 0);
  for (const [polity, comps] of after) {
    const groups = new Map<number, number>();
    for (const comp of comps) groups.set(find(comp[0]!), (groups.get(find(comp[0]!)) ?? 0) + 1);
    for (const [landmass, n] of groups) if (n > 1) smoothing.remainingSplits.push(`${polity}: ${n} pieces on landmass ${landmass} (${comps.filter((c) => find(c[0]!) === landmass).map((c) => c.length).join('+')} provinces)`);
  }
  const areaAfter = areaByPolity();
  for (const [id, a] of areaPreClean) { const b = areaAfter.get(id) ?? 0; if (Math.abs(b - a) > 0.05 * a && a > 3000) smoothing.shifted.push(`${id} ${Math.round(a)} -> ${Math.round(b)}`); }
  borderReports.final = measureBorders(borderInput());
}

// ---- names
// The most notable ancient place inside a province survives as an alias of it (formerNames); peoples, rivers, mountains, capes and lakes tell provinces of one region apart.
const TYPE_WEIGHT: Record<string, number> = { urban: 7, settlement: 6, island: 5, people: 4, fort: 3, port: 3, mountain: 2, sanctuary: 2, villa: 1, river: 1, region: 1 };
const placeName: (string | null)[] = P.map(() => null);
const placeKind: string[] = P.map(() => '');
interface Feature { kind: string; name: string; lon: number; lat: number }
const namedFeatures: Feature[] = [];
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
    const types = r.featureTypes.split(',').map((t) => t.trim());
    const featureKind = ['people', 'region', 'river', 'mountain', 'cape', 'lake'].find((k) => types.includes(k));
    if (featureKind) {
      const fname = featureNameOf(r.title ?? null);
      if (fname && !(featureKind === 'region' && maxDate !== null && maxDate < -270)) namedFeatures.push({ kind: featureKind, name: fname, lon, lat });
    }
    const weight = Math.max(0, ...types.map((t) => TYPE_WEIGHT[t] ?? 0));
    if (weight === 0) continue;
    const name = ancientNameOf(r.title ?? null, lat);
    if (!name) continue;
    const i = provinceAt(lon, lat);
    if (i < 0) continue;
    const alive = minDate !== null && maxDate !== null && minDate <= -270 && maxDate >= -270;
    const score = weight * 10 + (alive ? 5 : 0) + (minDate !== null && minDate <= -270 ? 2 : 0) + (r.id === P[i]!.seed.pleiades ? 1 : 0);
    if (score > best[i]! || (score === best[i]! && name.localeCompare(placeName[i]!) < 0)) { best[i] = score; placeName[i] = name; placeKind[i] = types.reduce((a, t) => ((TYPE_WEIGHT[t] ?? 0) > (TYPE_WEIGHT[a] ?? 0) ? t : a), ''); }
  }
}
// The province is named for the region it lies in; the towns stay settlements, and the old place name survives as an alias.
const named = nameProvinces({
  ids: idOf, centre: P.map((p) => p.centroid as Point), landmass: P.map((_, i) => find(i)), terrain,
  coast: P.map((p) => p.coast), coastKm: P.map((p) => p.coastKm), elevMean: P.map((p) => p.elevMean), riverFrac: P.map((p) => p.riverFrac), features: namedFeatures,
});
const finalName = named.names;
const nameKind = named.kinds;
const formerNames = P.map((_, i) => (placeName[i] && placeName[i] !== finalName[i] ? [placeName[i]!] : []));

// ---- the open desert belongs to no one: no settlement, no river or coast corridor, and 80 km from every town
const unownedDesert: number[] = [];
{
  const towns: Point[] = settlements.filter((t) => t.provinceIndex >= 0).map((t) => [t.lon, t.lat]);
  const hasTown = new Set(settlements.map((t) => t.provinceIndex));
  for (let i = 0; i < N; i++) {
    if (controller[i] === null || terrain[i] !== 'desert-steppe' || hasTown.has(i) || holdsDesert.has(i) || P[i]!.riverFrac >= 0.02 || P[i]!.coast) continue;
    if (towns.some((t) => haversineKm(t, centreOf(i)) <= 80)) continue;
    controller[i] = null;
    unownedDesert.push(i);
  }
  // no bubbles: a few unowned provinces with owned country around them are part of it (only in the desert belt, so the rest of the map keeps its owners)
  {
    const inBelt = (i: number): boolean => { const [lon, lat] = centreOf(i); return (lon >= -18 && lon <= 37 && lat >= 15.5 && lat <= 35.5) || (lon >= 34 && lon <= 56 && lat >= 15.5 && lat <= 33.5); };
    const seen = new Set<number>();
    let filled = 0;
    for (const start of unownedDesert) {
      if (seen.has(start) || controller[start] !== null) continue;
      const comp = [start];
      seen.add(start);
      for (let k = 0; k < comp.length; k++) for (const a of P[comp[k]!]!.adj) if (!seen.has(a.n) && controller[a.n] === null) { seen.add(a.n); comp.push(a.n); }
      if (comp.length >= 5 || !comp.every(inBelt)) continue;
      const votes = new Map<string, number>();
      let owned = 0;
      let total = 0;
      for (const i of comp) for (const a of P[i]!.adj) { total += a.km; const c = controller[a.n]; if (c !== null && c !== undefined) { owned += a.km; votes.set(c, (votes.get(c) ?? 0) + a.km); } }
      const best = [...votes.entries()].sort((x, y) => y[1] - x[1])[0];
      if (best && owned >= 0.5 * total) { for (const i of comp) controller[i] = best[0]; filled += comp.length; }
    }
    console.log(`unowned bubbles inside owned country given to their surroundings: ${filled}`);
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
  formerNames: formerNames[i]!,
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

export interface MapGraphProvince {
  readonly id: string;
  readonly name: string;
  readonly terrainId: string;
  /** Null where no polity holds it. */
  readonly controllerPolityId: string | null;
  readonly controlFirmnessBps: number;
  readonly areaKm2: number;
  readonly geo: { readonly latitude: number; readonly longitude: number };
  /** The most notable ancient place inside it, kept so a player who names the town finds the province. */
  readonly formerNames: readonly string[];
}

export interface MapGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly crossing: "land" | "pass" | "strait" | "sea_lane";
  /** Kilometres, centre to centre. */
  readonly distance: number;
}

export interface MapGraphPolity {
  readonly polityId: string;
  readonly name: string;
  readonly capitalSettlementId: string | null;
}

export interface MapGraphSettlement {
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
  `export const PUNIC_WARS_GRAPH_PROVINCES: readonly MapGraphProvince[] = ${lines(provinceRows)};`,
  '',
  `export const PUNIC_WARS_GRAPH_EDGES: readonly MapGraphEdge[] = ${lines(edgeRows)};`,
  '',
  `export const PUNIC_WARS_GRAPH_POLITIES: readonly MapGraphPolity[] = ${lines(polityRows)};`,
  '',
  `export const PUNIC_WARS_GRAPH_SETTLEMENTS: readonly MapGraphSettlement[] = ${lines(settlementRows)};`,
  '',
  '/** Cohesion and government form of the polities this map adds beyond the ones the scenario already writes. */',
  `export const POLITY_META: Readonly<Record<string, { readonly cohesionBps: number | null; readonly governmentForm: string }>> = ${JSON.stringify(polityMeta, null, 2)};`,
  '',
  '/** The new province that holds each place the scenario names, and each old province id it hard-codes. */',
  `export const PUNIC_ANCHORS: Readonly<Record<string, string>> = ${JSON.stringify({ ...namedAnchors, ...anchorMap }, null, 2)};`,
  '',
  '/** Every new province whose ground lay mostly in the old province, for the ids the scenario hard-codes. */',
  `export const PUNIC_OLD_REGION_PROVINCES: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(Object.fromEntries(anchorRows.map((a) => [a.oldId, a.regionProvinces])), null, 2)};`,
  '',
].join('\n'));

const features: string[] = [];
const regionOfId = new Map<string, Region>();
for (let i = 0; i < N; i++) {
  regionOfId.set(idOf[i]!, regionAt[i]!);
  const polygons = polygonsOfProvince[i]!;
  if (polygons.length === 0) continue;
  const geometry = polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons };
  features.push(JSON.stringify({ type: 'Feature', id: idOf[i], geometry, properties: { kind: 'province', name: finalName[i], terrain: terrain[i], regionId: named.regionIds[i] } }));
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
console.log(`islands adopted by the nearest polity: ${islandsAdopted}`);
console.log(`unowned after overlay: ${controller.filter((c) => c === null).length} (fringe adopted ${fringe}, from the Anatolian file ${fromAnatoliaFile.size})`);
console.log(`cities and towns on the shore made ports: ${madePorts.join(', ') || 'none'}`);
console.log(`settlements snapped to the nearest shore: ${snapped.join('; ') || 'none'}`);
console.log(`provinces adopted by a settlement's polity: ${adopted.length}\n  ${adopted.join('\n  ')}`);
console.log(`anchor provinces given their old province's owner: ${anchorOwners.join('; ') || 'none'}`);
console.log(`provinces sharing settlements: ${shared.map(([i, ids]) => `${idOf[i]!}: ${ids.join('+')}`).join('; ') || 'none'}`);
console.log(`settlements beyond the map, dropped: ${offMap.join(', ') || 'none'}`);
console.log(`off-map capitals: ${offMapPolities.join(', ') || 'none'}`);
console.log(`crossings ${crossings.length}`);
console.log(`open desert left to no one: ${unownedDesert.length}`);
console.log(`smoothing: border edges between polities ${smoothing.edgesBefore} -> ${smoothing.edgesAfter}; land components ${smoothing.componentsBefore} -> ${smoothing.componentsAfter}; provinces flipped ${smoothing.flipped}, folded as exclaves ${smoothing.folded}`);
console.log(`  settlements whose controller followed a folded province: ${smoothing.foldedSettlements.join('; ') || 'none'}`);
console.log(`  polities still in several pieces on one landmass: ${smoothing.remainingSplits.join('; ') || 'none'}`);
console.log(`  polities whose land moved over 5% (against before any cleaning): ${smoothing.shifted.join('; ') || 'none'}`);
console.log(`  stage 2: ${smoothing.flippedStage2} provinces flipped, ${smoothing.spikesRemoved} of them as spikes or notches`);
{
  const line = (label: string, r: BorderReport): string => `${label.padEnd(9)} border ${Math.round(r.borderKm).toLocaleString('en')} km, tortuosity ${r.meanTortuosity.toFixed(3)}, spikes ${r.spikes.length}, necks ${r.necks.length}, teeth ${r.combs}, exclaves ${r.exclaves}`;
  console.log('border cleanliness (whole map)');
  for (const k of ['overlay', 'stage1', 'final'] as const) console.log('  ' + line(k, borderReports[k]!));
  const area = new Map<string, number>();
  for (let i = 0; i < N; i++) if (controller[i]) area.set(controller[i]!, (area.get(controller[i]!) ?? 0) + P[i]!.areaKm2);
  const big = [...area.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id);
  console.log('  the ten biggest polities (border km / tortuosity / spikes / necks): overlay -> stage1 -> final');
  for (const id of big) {
    const cell = (r: BorderReport): string => { const q = r.perPolity.get(id); return q ? `${Math.round(q.borderKm)}/${q.tortuosity.toFixed(2)}/${q.spikes}/${q.necks}` : '-'; };
    console.log(`    ${id.padEnd(24)} ${cell(borderReports.overlay!)} -> ${cell(borderReports.stage1!)} -> ${cell(borderReports.final!)}`);
  }
  const worst = borderReports.final!.pairs.slice().sort((a, b) => b.km * (b.tortuosity - 1) - a.km * (a.tortuosity - 1)).slice(0, 8);
  console.log(`  raggedest borders left: ${worst.map((w) => `${w.a}|${w.b} ${Math.round(w.km)} km x${w.tortuosity.toFixed(2)}`).join('; ')}`);
}
console.log(`ownership corrections: files ${correctionReport.files.join(', ') || 'none'}; entries ${correctionReport.changed.length}; provinces changed ${correctionReport.changed.reduce((n, c) => n + c.provinces.length, 0)}`);
for (const c of correctionReport.changed) console.log(`  ${c.file} ${c.id} -> ${c.to}: ${c.provinces.length} provinces ${JSON.stringify(c.from)}`);
console.log(`  by polity pair: ${JSON.stringify(correctionReport.pairs)}`);
console.log(`  conflicts (kept, not overridden): ${correctionReport.conflicts.join('; ') || 'none'}`);
console.log(`  invalid polygons: ${correctionReport.invalid.join('; ') || 'none'}; unknown polities: ${correctionReport.unknownPolities.join('; ') || 'none'}`);
console.log(`  pins let go (a group of one or two provinces standing as a spike or neck): ${releasedPins.join('; ') || 'none'}; pinned provinces ${pinned.size}`);
console.log(`  settlements that followed their province: ${correctionReport.settlementsFollowed.join('; ') || 'none'}`);
{
  const kinds = count(nameKind);
  let seed = 20260929;
  const rand = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pool = P.map((_, i) => i);
  const sample: number[] = [];
  while (sample.length < 100) sample.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  const regions = [...named.regionCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const report = [
    `Province names by kind: ${JSON.stringify(kinds)}`,
    `${regions.length} regions over ${N} provinces; ${named.splits.length} split into districts; names unique: ${new Set(finalName).size === N}`,
    '', 'Regions and their provinces:', ...regions.map(([r, n]) => `${String(n).padStart(4)}  ${r}`),
    '', 'Regions that needed splitting:', ...named.splits.map((sp) => `${sp.region} (${sp.provinces}): ${sp.districts.join('; ')}`),
    '', '100 provinces chosen at random (id, region, kind, name):',
    ...sample.map((i) => `${idOf[i]}\t${named.regionNames[i]}\t${nameKind[i]}\t${finalName[i]}`),
  ].join('\n');
  writeFileSync(join(HERE, `names-report${tag}.txt`), `${report}\n`);
  console.log(report.split('\n').slice(0, 2).join('\n'));
}
console.log(`wrote ${OUT_GRAPH}\nwrote ${OUT_GEOJSON}\nwrote ${OUT_ANCHORS}`);
