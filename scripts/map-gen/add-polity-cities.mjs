/** Research-backed additions and explicitly modeled tribal seats. Run after build-map-graph. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const graphPath = fileURLToPath(new URL('packages/db/src/punic-wars-map-graph.ts', root));
const mapPath = fileURLToPath(new URL('apps/web/public/maps/punic-wars-provinces.geojson', root));
const research = JSON.parse(readFileSync(new URL('./city-research.json', import.meta.url), 'utf8'));
let graph = readFileSync(graphPath, 'utf8');
const readRows = (name) => graph.split(`export const ${name}`)[1].split('= [')[1].split('];')[0]
  .split('\n').filter((line) => line.trim().startsWith('{')).map((line) => JSON.parse(line.trim().replace(/,$/, '')));
const provinces = readRows('PUNIC_WARS_GRAPH_PROVINCES');
const polities = readRows('PUNIC_WARS_GRAPH_POLITIES');
for (const definition of research.polityDefinitions ?? []) {
  if (!polities.some((polity) => polity.polityId === definition.polityId)) polities.push({ polityId: definition.polityId, name: definition.name, capitalSettlementId: definition.capitalSettlementId });
  const home = provinces.find((province) => province.id === definition.homeProvinceId);
  if (!home) throw new Error(`Missing historical home ${definition.homeProvinceId}`);
  home.controllerPolityId = definition.polityId;
}
const excluded = new Set(research.excluded.map((site) => site.settlementId).filter(Boolean));
const cities = readRows('PUNIC_WARS_GRAPH_SETTLEMENTS').filter((city) => !excluded.has(city.id));
// This garrison rules Rhegium's city while the Bruttians hold its countryside.
if (!polities.some((polity) => polity.polityId === 'rhegium-campanians')) {
  polities.push({ polityId: 'rhegium-campanians', name: 'Campanian legion of Rhegium', capitalSettlementId: 'settlement-rhegium' });
}
const map = JSON.parse(readFileSync(mapPath, 'utf8'));
map.features = map.features.filter((feature) => !excluded.has(feature.id));
const features = new Map(map.features.map((feature) => [feature.id, feature]));
const ringContains = (ring, [x, y]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const contains = (province, point) => {
  const geometry = features.get(province.id).geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(([outer, ...holes]) => ringContains(outer, point) && !holes.some((hole) => ringContains(hole, point)));
};
const distance = (province, [lon, lat]) => (province.geo.longitude - lon) ** 2 * Math.cos(lat * Math.PI / 180) ** 2 + (province.geo.latitude - lat) ** 2;
const add = (polity, site, province, coordinate) => {
  const previous = cities.find((city) => city.id === site.id);
  const city = { ...(previous ?? { kind: 'city', size: site.id.endsWith('-market') ? 6 : 25, fortificationLevel: site.id.endsWith('-market') ? 0 : 2 }),
    id: site.id, name: site.name, provinceId: province.id, controllerPolityId: polity.polityId };
  if (previous) cities[cities.indexOf(previous)] = city;
  else cities.push(city);
  const feature = { type: 'Feature', id: site.id, geometry: { type: 'Point', coordinates: coordinate },
    properties: { kind: 'settlement', name: site.name, provinceId: province.id, type: city.kind, historicalBasis: site.basis } };
  const index = map.features.findIndex((feature) => feature.id === site.id);
  if (index >= 0) map.features[index] = feature;
  else map.features.push(feature);
};
for (const polity of polities) {
  let held = provinces.filter((province) => province.controllerPolityId === polity.polityId);
  if (!held.length) held = provinces.filter((province) => cities.some((city) => city.provinceId === province.id && city.controllerPolityId === polity.polityId));
  if (!held.length) throw new Error(`No ground for ${polity.polityId}`);
  for (const site of research.settlements.filter((site) => site.polityId === polity.polityId)) {
    const point = [site.longitude, site.latitude];
    // A historical place stays at its real location even where the game border differs.
    // City control can differ from countryside control, as it already does at Rhegium.
    const province = held.find((province) => contains(province, point))
      ?? provinces.find((province) => contains(province, point))
      ?? [...provinces].sort((a, b) => distance(a, point) - distance(b, point))[0];
    add(polity, site, province, point);
    if (site.capital === true || (site.capital === undefined && site.basis !== 'historical-settlement')) polity.capitalSettlementId = site.id;
  }
  const owned = cities.filter((city) => city.controllerPolityId === polity.polityId);
  if (!owned.length) throw new Error(`Missing researched settlement for ${polity.polityId}`);
  if (!owned.some((city) => city.id === polity.capitalSettlementId)) {
    const preferred = `settlement-${research.preferredExistingSeats[polity.polityId]}`;
    polity.capitalSettlementId = owned.find((city) => city.id === preferred)?.id
      ?? [...owned].sort((a, b) => b.size - a.size || a.id.localeCompare(b.id))[0].id;
  }

}
for (const [name, rows] of [['PUNIC_WARS_GRAPH_PROVINCES', provinces], ['PUNIC_WARS_GRAPH_POLITIES', polities], ['PUNIC_WARS_GRAPH_SETTLEMENTS', cities]]) {
  const pattern = new RegExp(`(export const ${name}[^=]*= )\\[[\\s\\S]*?\\];`);
  graph = graph.replace(pattern, (_, prefix) => `${prefix}[\n${rows.sort((a, b) => (a.id ?? a.polityId).localeCompare(b.id ?? b.polityId)).map((row) => `  ${JSON.stringify(row)},`).join('\n')}\n];`);
}
graph = graph.replace(/Polities: \d+\. Settlements: \d+\./, `Polities: ${polities.length}. Settlements: ${cities.length}.`);
writeFileSync(graphPath, graph);
// Preserve the map generator's one-feature-per-line format for readable diffs.
writeFileSync(mapPath, `{"type":"FeatureCollection","features":[\n${map.features.map((feature) => JSON.stringify(feature)).join(',\n')}\n]}\n`);
writeFileSync(new URL('./city-provenance.json', import.meta.url), JSON.stringify({ epoch: research.epoch, policy: research.policy, additions: map.features.filter((feature) => feature.properties.historicalBasis).map((feature) => ({ settlementId: feature.id, name: feature.properties.name, provinceId: feature.properties.provinceId, basis: feature.properties.historicalBasis, ...Object.fromEntries(['source', 'nameEvidence', 'chronology', 'chronologyNote', 'capitalNote', 'politicalAttribution'].map((key) => [key, research.settlements.find((site) => site.id === feature.id)?.[key] ?? null])) })), seats: polities.map((polity) => ({ polityId: polity.polityId, settlementId: polity.capitalSettlementId, basis: research.settlements.find((site) => site.id === polity.capitalSettlementId)?.basis ?? (polity.capitalSettlementId.endsWith('-assembly') ? 'modeled-town' : 'existing-scenario-site') })) }, null, 2) + '\n');
console.log(`${polities.length} polities now have cities and capitals; ${cities.length} settlements total.`);
