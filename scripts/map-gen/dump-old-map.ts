// Freeze the 780-province map the game ships today, with ids, owners and settlements, so the new map can inherit its ownership.
// Run from apps/web:  MAP_GEN_DATA=<dir> tsx --tsconfig ../../scripts/map-graph/tsconfig.json ../../scripts/map-gen/dump-old-map.ts
import { writeFileSync } from 'node:fs';
import { punicWarsGeoJson } from '../../apps/web/lib/punic-wars-geojson';
import {
  PUNIC_WARS_GRAPH_POLITIES,
  PUNIC_WARS_GRAPH_PROVINCES,
  PUNIC_WARS_GRAPH_SETTLEMENTS,
} from '../../packages/db/src/punic-wars-map-graph';

const owner = new Map(PUNIC_WARS_GRAPH_PROVINCES.map((p) => [p.id, p.controllerPolityId]));
const features = punicWarsGeoJson.features as unknown as Array<{ id: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }>;

const provinces = features
  .filter((f) => f.properties.kind === 'province' && owner.has(f.id))
  .map((f) => ({ id: f.id, controller: owner.get(f.id)!, geometry: f.geometry }));
const placed = new Map(features.filter((f) => f.properties.kind === 'settlement').map((f) => [f.id, f]));
const settlements = PUNIC_WARS_GRAPH_SETTLEMENTS.map((s) => ({ ...s, coordinate: (placed.get(s.id)?.geometry.coordinates as [number, number] | undefined) ?? null, type: (placed.get(s.id)?.properties.type as string | undefined) ?? null }));

const out = `${process.env.MAP_GEN_DATA}/old-map.json`;
writeFileSync(out, JSON.stringify({ provinces, polities: PUNIC_WARS_GRAPH_POLITIES, settlements }));
console.log('old provinces', provinces.length, 'polities', PUNIC_WARS_GRAPH_POLITIES.length, 'settlements', settlements.length, 'without coordinate', settlements.filter((s) => s.coordinate === null).length, '->', out);
