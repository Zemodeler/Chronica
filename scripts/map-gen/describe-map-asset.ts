/**
 * Describes the Punic Wars map asset as its database row needs it (feature count, bounding box, byte size, checksum)
 * and writes `packages/db/src/punic-map-asset.ts`, so the row is written without reading the file at runtime.
 * Usage: tsx scripts/map-gen/describe-map-asset.ts   (run again whenever the map is regenerated)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { polygonsOf } from './map-geometry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const bytes = readFileSync(join(ROOT, 'apps/web/public/maps/punic-wars-provinces.geojson'));
const geojson = JSON.parse(bytes.toString('utf8')) as { features: { geometry: { type: string; coordinates: unknown } }[] };

const box = [Infinity, Infinity, -Infinity, -Infinity];
for (const feature of geojson.features) {
  const points = feature.geometry.type === 'Point' ? [feature.geometry.coordinates as [number, number]] : polygonsOf(feature.geometry).flat(2);
  for (const [x, y] of points) {
    box[0] = Math.min(box[0]!, x); box[1] = Math.min(box[1]!, y);
    box[2] = Math.max(box[2]!, x); box[3] = Math.max(box[3]!, y);
  }
}
const round = (value: number): number => Math.round(value * 1e4) / 1e4;

const lines = [
  '// GENERATED FILE -- do not edit by hand.',
  '// Regenerate with scripts/map-gen/describe-map-asset.ts after the map changes.',
  '//',
  "// The Punic Wars map asset (apps/web/public/maps/punic-wars-provinces.geojson) as its database row records it.",
  '',
  'export const PUNIC_WARS_MAP_ASSET = {',
  `  featureCount: ${geojson.features.length},`,
  `  boundingBox: [${box.map(round).join(', ')}],`,
  `  byteSize: ${bytes.length},`,
  `  checksum: ${JSON.stringify(createHash('sha256').update(bytes).digest('hex'))},`,
  '} as const;',
  '',
];
writeFileSync(join(ROOT, 'packages/db/src/punic-map-asset.ts'), lines.join('\n'));
console.log(lines.slice(5).join('\n'));
