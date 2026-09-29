/**
 * Loads the emitted map through the real schemas and checks what the schemas cannot: unique names, legal crossings,
 * connectivity, ownership, border topology, and how the new map's land compares with the old one's, polity by polity.
 * Usage: MAP_GEN_DATA=<dir> tsx scripts/map-gen/validate-map-graph.ts   (exit code 1 on any failure)
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeoJsonMapSchema } from '../../packages/shared/src/world/geojson';
import { ProvinceGraphSchema } from '../../packages/shared/src/world/map';
import { haversineKm, polygonsOf, ringAreaKm2, signedArea, type Point } from './map-geometry';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const STRAIGHT_KM = +(process.env.STRAIGHT_KM ?? 60);
const DATA = process.env.MAP_GEN_DATA ?? join(ROOT, '.map-gen-data');
// out=<suffix> checks a suffixed build (punic-wars-map-graph-<suffix>.ts, punic-wars-provinces-<suffix>.geojson); the default is the shipped one
const SUFFIX = process.argv.find((a) => a.startsWith('out='))?.slice(4);
const tag = SUFFIX === undefined || SUFFIX === '' ? '' : `-${SUFFIX}`;
const graphModule = createRequire(import.meta.url)(`../../packages/db/src/punic-wars-map-graph${tag}`);
const { PUNIC_ANCHORS, PUNIC_WARS_GRAPH_EDGES, PUNIC_WARS_GRAPH_POLITIES, PUNIC_WARS_GRAPH_PROVINCES, PUNIC_WARS_GRAPH_SETTLEMENTS } = graphModule as typeof import('../../packages/db/src/punic-wars-map-graph');

// The terrains of packages/db/src/punic-wars-scenario.ts, definition.map.terrains.
const ALLOWED: Record<string, readonly string[]> = {
  'coastal-plain': ['land', 'strait', 'sea_lane'],
  hills: ['land', 'pass'],
  'hills-uplands': ['land', 'pass'],
  'mountain-pass': ['pass'],
  'desert-steppe': ['land'],
};
// Controllers the scenario declares itself, outside the map's own polity list.
const DECLARED_BY_SCENARIO = new Set(['rhegium-campanians']);

let failures = 0;
const check = (ok: boolean, message: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures++;
};
const percentile = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

const provinces = PUNIC_WARS_GRAPH_PROVINCES;
const edges = PUNIC_WARS_GRAPH_EDGES;
const polities = PUNIC_WARS_GRAPH_POLITIES;
const settlements = PUNIC_WARS_GRAPH_SETTLEMENTS;

// ---- the graph through the schema
const graph = {
  provinces: provinces.map((p) => ({
    id: p.id, name: p.name, formerNames: [...p.formerNames], terrainId: p.terrainId, controllerPolityId: p.controllerPolityId, controlFirmnessBps: p.controlFirmnessBps,
    areaKm2: p.areaKm2, geo: p.geo,
    settlements: settlements.filter((s) => s.provinceId === p.id).map((s) => ({ ...s, kind: s.kind as 'city' })),
  })),
  edges: edges.map((e) => ({ ...e })),
  polities: [...polities.map((p) => ({ id: p.polityId, name: p.name, capitalSettlementId: p.capitalSettlementId })), ...[...DECLARED_BY_SCENARIO].map((id) => ({ id, name: id, capitalSettlementId: null }))],
};
const parsed = ProvinceGraphSchema.safeParse(graph);
check(parsed.success, `ProvinceGraphSchema accepts ${provinces.length} provinces, ${edges.length} edges, ${polities.length} polities${parsed.success ? '' : `: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`}`);

// ---- ids, names, edges
const ids = new Set(provinces.map((p) => p.id));
check(ids.size === provinces.length, 'province ids are unique');
const names = new Map<string, string>();
for (const p of provinces) names.set(p.name.toLowerCase(), p.id);
check(names.size === provinces.length, `province names are unique (${provinces.length - names.size} clashes)`);
check(provinces.every((p) => /^[a-z]{2,4}-[0-9a-z]{5}$/.test(p.id)), 'ids are <slug 2-4 letters>-<5 base36>');
check(edges.every((e) => ids.has(e.from) && ids.has(e.to)), 'every edge endpoint exists');
check(edges.every((e) => e.from < e.to), 'edges are stored from < to');
check(new Set(edges.map((e) => `${e.from}|${e.to}`)).size === edges.length, 'no duplicate edges');
const terrainOf = new Map(provinces.map((p) => [p.id, p.terrainId]));
const illegal = edges.filter((e) => !ALLOWED[terrainOf.get(e.from)!]?.includes(e.crossing) || !ALLOWED[terrainOf.get(e.to)!]?.includes(e.crossing));
check(illegal.length === 0, `every crossing is admitted by both terrains (${illegal.length} illegal${illegal.length ? `, e.g. ${JSON.stringify(illegal[0])}` : ''})`);
check(edges.every((e) => Number.isInteger(e.distance) && e.distance >= 1), 'edge distances are integer kilometres >= 1');

// ---- connectivity from Rome's province
const adjacency = new Map<string, string[]>();
for (const e of edges) { (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e.to); (adjacency.get(e.to) ?? adjacency.set(e.to, []).get(e.to)!).push(e.from); }
const rome = PUNIC_ANCHORS.rome!;
const seen = new Set([rome]);
const queue = [rome];
while (queue.length) for (const next of adjacency.get(queue.pop()!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
check(seen.size === provinces.length, `all ${provinces.length} provinces reachable from Rome's province ${rome} (${seen.size})`);

// ---- ownership
const declared = new Set([...polities.map((p) => p.polityId), ...DECLARED_BY_SCENARIO]);
check(provinces.every((p) => p.controllerPolityId === null || declared.has(p.controllerPolityId)), 'every controller is declared');
check(settlements.every((s) => declared.has(s.controllerPolityId)), 'every settlement controller is declared');
const held = new Map<string, number>();
for (const p of provinces) if (p.controllerPolityId) held.set(p.controllerPolityId, (held.get(p.controllerPolityId) ?? 0) + 1);
check(polities.every((p) => (held.get(p.polityId) ?? 0) > 0), 'no polity holds zero provinces');
check(polities.every((p) => p.capitalSettlementId === null || settlements.some((s) => s.id === p.capitalSettlementId)), 'every capital exists as a settlement');
// only open desert is left to no one: desert-steppe with no settlement
const unowned = provinces.filter((p) => p.controllerPolityId === null);
const townProvinces = new Set(settlements.map((s) => s.provinceId));
const badlyUnowned = unowned.filter((p) => p.terrainId !== 'desert-steppe' || townProvinces.has(p.id));
check(badlyUnowned.length === 0, `unowned provinces are all desert-steppe without a settlement (${unowned.length} unowned, ${badlyUnowned.length} not open desert${badlyUnowned.length ? `: ${badlyUnowned.slice(0, 5).map((p) => p.name).join(', ')}` : ''})`);

// ---- stats
const km = edges.map((e) => e.distance).sort((a, b) => a - b);
const landKm = edges.filter((e) => e.crossing === 'land' || e.crossing === 'pass').map((e) => e.distance).sort((a, b) => a - b);
const area = provinces.map((p) => p.areaKm2).sort((a, b) => a - b);
const degree = [...adjacency.values()].map((v) => v.length).sort((a, b) => a - b);
console.log(`     edge km: p10 ${percentile(km, 0.1)}, median ${percentile(km, 0.5)}, p90 ${percentile(km, 0.9)}, max ${km.at(-1)}, mean ${(km.reduce((a, b) => a + b, 0) / km.length).toFixed(1)}; land+pass median ${percentile(landKm, 0.5)}`);
console.log(`     province km2: min ${area[0]}, p10 ${percentile(area, 0.1)}, median ${percentile(area, 0.5)}, p90 ${percentile(area, 0.9)}, max ${area.at(-1)}`);
console.log(`     degree: median ${percentile(degree, 0.5)}, max ${degree.at(-1)}; crossings ${JSON.stringify(edges.reduce<Record<string, number>>((m, e) => ({ ...m, [e.crossing]: (m[e.crossing] ?? 0) + 1 }), {}))}`);
console.log(`     terrain ${JSON.stringify(provinces.reduce<Record<string, number>>((m, p) => ({ ...m, [p.terrainId]: (m[p.terrainId] ?? 0) + 1 }), {}))}; settlements ${settlements.length}, provinces with one: ${new Set(settlements.map((s) => s.provinceId)).size}`);

// ---- the GeoJSON
const geojson = JSON.parse(readFileSync(join(ROOT, `apps/web/public/maps/punic-wars-provinces${tag}.geojson`), 'utf8')) as { features: { id: string; geometry: { type: string; coordinates: unknown }; properties: { kind: string } }[] };
const geoParsed = GeoJsonMapSchema.safeParse(geojson);
check(geoParsed.success, `GeoJsonMapSchema accepts ${geojson.features.length} features${geoParsed.success ? '' : `: ${JSON.stringify(geoParsed.error.issues.slice(0, 3))}`}`);
const geoProvinces = geojson.features.filter((f) => f.properties.kind === 'province');
check(geoProvinces.length === provinces.length && geoProvinces.every((f) => ids.has(f.id)), 'one polygon feature per province');
check(geojson.features.filter((f) => f.properties.kind === 'settlement').length === settlements.length, 'one point feature per settlement');
{
  const segments = new Map<string, number>();
  for (const f of geoProvinces) for (const polygon of polygonsOf(f.geometry)) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const a = `${ring[i - 1]![0]},${ring[i - 1]![1]}`;
    const b = `${ring[i]![0]},${ring[i]![1]}`;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    segments.set(key, (segments.get(key) ?? 0) + 1);
  }
  const counts = [0, 0, 0, 0];
  for (const n of segments.values()) counts[Math.min(3, n)]!++;
  check(counts[3] < 100, `border topology: ${counts[2]} segments shared by two provinces, ${counts[1]} coast, ${counts[3]} over-used (pinch points)`);
  // ruler-straight outer edges: runs of single-use segments that keep one heading for more than 60 km
  const runs: { km: number; from: Point; to: Point }[] = [];
  const km = (a: Point, b: Point): number => haversineKm(a, b);
  for (const f of geoProvinces) for (const polygon of polygonsOf(f.geometry)) for (const ring of polygon) {
    const single = (i: number): boolean => { const a = `${ring[i - 1]![0]},${ring[i - 1]![1]}`; const b = `${ring[i]![0]},${ring[i]![1]}`; return segments.get(a < b ? `${a}|${b}` : `${b}|${a}`) === 1; };
    const heading = (i: number): number => Math.atan2(ring[i]![1] - ring[i - 1]![1], (ring[i]![0] - ring[i - 1]![0]) * Math.cos((ring[i]![1] * Math.PI) / 180));
    let start = -1;
    let base = 0;
    let length = 0;
    const flush = (end: number): void => { if (start >= 0 && length > STRAIGHT_KM) runs.push({ km: Math.round(length), from: ring[start - 1] as Point, to: ring[end] as Point }); start = -1; length = 0; };
    for (let i = 1; i < ring.length; i++) {
      if (!single(i)) { flush(i - 1); continue; }
      const h = heading(i);
      const drift = start < 0 ? 0 : Math.abs(Math.atan2(Math.sin(h - base), Math.cos(h - base)));
      if (start >= 0 && drift > (4 * Math.PI) / 180) flush(i - 1);
      if (start < 0) { start = i; base = h; }
      length += km(ring[i - 1] as Point, ring[i] as Point);
    }
    flush(ring.length - 1);
  }
  runs.sort((a, b) => b.km - a.km);
  console.log(`     straight outer edges over ${STRAIGHT_KM} km: ${runs.length}${runs.length ? `; longest ${runs.slice(0, 8).map((r) => `${r.km} km from ${r.from.map((v) => v.toFixed(2))} to ${r.to.map((v) => v.toFixed(2))}`).join(' | ')}` : ''}`);
}

// ---- old map versus new, by polity
interface OldMap { provinces: { id: string; controller: string; geometry: { type: string; coordinates: unknown } }[] }
const old = JSON.parse(readFileSync(join(DATA, 'old-map.json'), 'utf8')) as OldMap;
const oldArea = new Map<string, number>();
for (const p of old.provinces) {
  let a = 0;
  for (const polygon of polygonsOf(p.geometry)) polygon.forEach((ring, k) => { a += (k === 0 ? 1 : -1) * ringAreaKm2(ring) * (signedArea(ring) === 0 ? 0 : 1); });
  oldArea.set(p.controller, (oldArea.get(p.controller) ?? 0) + a);
}
const newArea = new Map<string, number>();
for (const p of provinces) if (p.controllerPolityId) newArea.set(p.controllerPolityId, (newArea.get(p.controllerPolityId) ?? 0) + p.areaKm2);
const rows = [...oldArea.entries()].map(([id, o]) => ({ id, old: Math.round(o), now: Math.round(newArea.get(id) ?? 0), ratio: (newArea.get(id) ?? 0) / o }));
const total = rows.reduce((s, r) => s + r.old, 0);
const within = rows.filter((r) => Math.abs(r.ratio - 1) <= 0.1);
console.log(`     land per old polity: ${within.length} of ${rows.length} within 10% (${rows.filter((r) => Math.abs(r.ratio - 1) <= 0.05).length} within 5%); old total ${Math.round(total)} km2, new ${Math.round([...newArea.values()].reduce((a, b) => a + b, 0))} km2`);
const big = rows.filter((r) => r.old >= 5000).sort((a, b) => Math.abs(b.ratio - 1) * b.old - Math.abs(a.ratio - 1) * a.old).slice(0, 25);
console.log('     biggest discrepancies (polities over 5000 km2 old, by km2 lost or gained):');
for (const r of big) console.log(`       ${r.id.padEnd(34)} old ${String(r.old).padStart(8)}  new ${String(r.now).padStart(8)}  ${(r.ratio * 100).toFixed(0)}%`);
const newcomers = [...newArea.keys()].filter((id) => !oldArea.has(id));
console.log(`     polities with no old land (the Anatolian file): ${newcomers.length ? newcomers.map((id) => `${id} ${Math.round(newArea.get(id)!)}`).join(', ') : 'none'}`);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
