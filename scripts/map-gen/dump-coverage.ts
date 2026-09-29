// Dump the polygons of the provinces the game already simulates, to use as the land coverage mask.
import { writeFileSync } from 'node:fs';
import { punicWarsGeoJson } from '../../apps/web/lib/punic-wars-geojson';
import { PUNIC_WARS_GRAPH_PROVINCES } from '../../packages/db/src/punic-wars-map-graph';

const ids = new Set(PUNIC_WARS_GRAPH_PROVINCES.map((p: { id: string }) => p.id));
const feats = (punicWarsGeoJson as { features: Array<{ id?: string; geometry: unknown; properties: { kind?: string } }> }).features;
const kept = feats.filter((f) => f.id !== undefined && ids.has(String(f.id)) && f.geometry);
console.log('graph provinces', ids.size, 'geojson features', feats.length, 'matched', kept.length);
writeFileSync(
  process.env.MAP_GEN_DATA ? `${process.env.MAP_GEN_DATA}/coverage.geojson` : '../../.map-gen-data/coverage.geojson',
  JSON.stringify({ type: 'FeatureCollection', features: kept.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: {} })) }),
);
