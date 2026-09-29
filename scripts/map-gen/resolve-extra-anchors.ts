/**
 * Finds the province holding each extra test anchor of `anchors-extra.json` (a point in the Rhineland, in Illyria, in
 * the Balkan interior) and writes `packages/db/src/punic-extra-ids.ts`.
 * Usage: tsx scripts/map-gen/resolve-extra-anchors.ts   (run again whenever the map is regenerated)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { polygonsOf, ringContains, type Ring } from './map-geometry';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const geojson = JSON.parse(readFileSync(join(ROOT, 'apps/web/public/maps/punic-wars-provinces.geojson'), 'utf8')) as {
  features: { id: string; geometry: { type: string; coordinates: unknown }; properties: { kind: string; name: string; terrain?: string } }[];
};
const provinces = geojson.features.filter((feature) => feature.properties.kind === 'province');
const extras = JSON.parse(readFileSync(join(HERE, 'anchors-extra.json'), 'utf8')) as { key: string; lon: number; lat: number; note: string }[];

const holds = (polygons: readonly (readonly Ring[])[], x: number, y: number): boolean =>
  polygons.some((rings) => rings.reduce((inside, ring) => (ringContains(ring, x, y) ? !inside : inside), false));

const resolved = extras.map(({ key, lon, lat }) => {
  const holder = provinces.find((province) => holds(polygonsOf(province.geometry), lon, lat));
  if (holder === undefined) throw new Error(`No province holds ${key} at ${lon}, ${lat}`);
  console.log(`${key.padEnd(12)} ${holder.id}  ${holder.properties.name} (${holder.properties.terrain ?? '?'})`);
  return { key, id: holder.id };
});

const lines = [
  '// GENERATED FILE -- do not edit by hand.',
  '// Regenerate with scripts/map-gen/resolve-extra-anchors.ts after the map changes.',
  '//',
  '// The provinces holding the extra places the tests name that no settlement marks: from the point in',
  '// scripts/map-gen/anchors-extra.json, by point-in-polygon on the map asset.',
  '',
  'export const PUNIC_EXTRA_IDS = {',
  ...resolved.map(({ key, id }) => `  ${key}: ${JSON.stringify(id)},`),
  '} as const;',
  '',
];
writeFileSync(join(ROOT, 'packages/db/src/punic-extra-ids.ts'), lines.join('\n'));
