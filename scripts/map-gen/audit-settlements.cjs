// Checks every settlement of the map against the Pleiades place of the same name.
// Usage: MAP_GEN_DATA=<dir> node scripts/map-gen/audit-settlements.cjs [maxKm=5] [map=<geojson>]
// Prints each settlement whose pin lies further than maxKm from the nearest Pleiades place carrying its name,
// and each it found no place for (to be checked by hand).
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '../..');
const DATA = process.env.MAP_GEN_DATA || path.join(ROOT, '.map-gen-data');
const dreq = require('module').createRequire(path.join(DATA, 'package.json'));
const { parse } = dreq('csv-parse/sync');
const maxKm = +(process.argv.find((a) => a.startsWith('maxKm='))?.slice(6) ?? 5);

const mapFile = process.argv.find((a) => a.startsWith('map='))?.slice(4) ?? path.join(ROOT, 'apps/web/public/maps/punic-wars-provinces.geojson');
const geojson = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const towns = geojson.features.filter((f) => f.properties.kind === 'settlement');
const rows = parse(fs.readFileSync(path.join(DATA, 'data/pleiades-places-latest.csv')), { columns: true, relax_quotes: true, relax_column_count: true });

const plain = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const byToken = new Map();
for (const r of rows) {
  if (r.reprLat === '' || r.reprLong === '') continue;
  for (const part of r.title.split(/[\/,]/)) {
    const key = plain(part);
    if (key === '') continue;
    if (!byToken.has(key)) byToken.set(key, []);
    byToken.get(key).push({ title: r.title, lon: +r.reprLong, lat: +r.reprLat, types: r.featureTypes });
  }
}
const km = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
};

let checked = 0;
const off = [];
const unmatched = [];
for (const f of towns) {
  const pin = f.geometry.coordinates;
  const names = [f.properties.name, f.id.replace(/^settlement-/, '').replace(/-/g, ' ')].map(plain);
  const words = new Set(names);
  for (const n of names) for (const w of n.split(' ')) if (w.length > 4) words.add(w);
  const found = [...words].flatMap((w) => byToken.get(w) ?? []).filter((p) => km(pin, [p.lon, p.lat]) < 120);
  if (found.length === 0) { unmatched.push(`${f.id} (${f.properties.name}) at ${pin.join(', ')}`); continue; }
  checked++;
  const nearest = found.map((p) => ({ p, d: km(pin, [p.lon, p.lat]) })).sort((a, b) => a.d - b.d)[0];
  if (nearest.d > maxKm) off.push({ id: f.id, name: f.properties.name, pin, pleiades: nearest.p.title, at: [nearest.p.lon, nearest.p.lat], d: nearest.d, types: nearest.p.types });
}
console.log(`${towns.length} settlements; ${checked} matched a Pleiades name; ${off.length} lie more than ${maxKm} km from it; ${unmatched.length} unmatched`);
for (const o of off.sort((a, b) => b.d - a.d)) console.log(`OFF ${o.d.toFixed(1).padStart(6)} km  ${o.id.padEnd(30)} pin ${o.pin.join(', ').padEnd(18)} Pleiades "${o.pleiades}" ${o.at.map((v) => v.toFixed(4)).join(', ')} [${o.types}]`);
for (const u of unmatched) console.log(`?   ${u}`);
