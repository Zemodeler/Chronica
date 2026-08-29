/**
 * Topology-preserving simplification for the Europe/North-Africa ADM1 GeoJSON.
 *
 * Uses TopoJSON to merge shared province borders before simplifying, so
 * adjacent provinces stay perfectly flush after simplification.
 *
 * Tolerance reference: the planar quantization target (~1e-4 degrees) is
 * appropriate for interactive pan/zoom up to roughly zoom-6 tiles at the
 * bounds used by the Chronica map.
 *
 * Usage:
 *   node scripts/simplify-geojson.mjs [--tolerance <number>] [--dry-run]
 *
 * Writes the result to public/maps/europe-north-africa-adm1.geojson in-place
 * after creating a .orig backup.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as topojsonServer from "topojson-server";
import * as topojsonSimplify from "topojson-simplify";
import * as topojsonClient from "topojson-client";

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, "..");
const srcPath = join(repoRoot, "apps/web/public/maps/europe-north-africa-adm1.geojson");
const origPath = `${srcPath}.orig`;

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const toleranceIdx = args.indexOf("--tolerance");
// Default: 7e-5 degrees — empirically smooth at zoom ≤6 while retaining
// recognisable coastline detail. Reduce if borders are over-simplified.
const tolerance = toleranceIdx >= 0 ? Number(args[toleranceIdx + 1]) : 7e-5;

console.log(`Source:    ${srcPath}`);
console.log(`Tolerance: ${tolerance}`);
console.log(`Dry run:   ${dryRun}`);

const geojson = JSON.parse(readFileSync(srcPath, "utf8"));
console.log(`\nInput features: ${geojson.features.length}`);

// Count total vertices before
function vertexCount(geojson) {
  let n = 0;
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    const rings = g.type === "MultiPolygon" ? g.coordinates.flat() : g.coordinates;
    for (const ring of rings) n += ring.length;
  }
  return n;
}

const before = vertexCount(geojson);
console.log(`Input vertices: ${before.toLocaleString()}`);

// Step 1: GeoJSON → TopoJSON (shares arcs for touching boundaries)
const topology = topojsonServer.topology({ provinces: geojson });

// Step 2: pre-simplify presimplify adds z-values (importance weights) per vertex
const presimplified = topojsonSimplify.presimplify(topology);

// Step 3: simplify to tolerance
const simplified = topojsonSimplify.simplify(presimplified, tolerance);

// Step 4: TopoJSON → GeoJSON, preserving original feature properties and ids
const simplifiedGeojson = topojsonClient.feature(simplified, simplified.objects.provinces);

// Restore original ids (topojson-client uses feature.id from properties.id if present,
// but our source uses top-level id — copy it back)
for (let i = 0; i < geojson.features.length; i++) {
  if (geojson.features[i].id !== undefined) {
    simplifiedGeojson.features[i].id = geojson.features[i].id;
  }
}

const after = vertexCount(simplifiedGeojson);
console.log(`Output vertices: ${after.toLocaleString()} (${((1 - after / before) * 100).toFixed(1)}% reduction)`);

// Quick geometry health check: no feature should lose its geometry entirely
const nullGeom = simplifiedGeojson.features.filter((f) => !f.geometry || f.geometry.coordinates.length === 0);
if (nullGeom.length > 0) {
  console.error(`\nWARNING: ${nullGeom.length} features have null/empty geometry after simplification:`);
  for (const f of nullGeom) {
    console.error(`  - ${f.properties?.name ?? f.id}`);
  }
  process.exit(1);
}
console.log(`Geometry health: all ${simplifiedGeojson.features.length} features intact`);

if (dryRun) {
  console.log("\nDry run — not writing output.");
  process.exit(0);
}

// Backup original only once
if (!existsSync(origPath)) {
  copyFileSync(srcPath, origPath);
  console.log(`\nBacked up original to ${origPath}`);
}

writeFileSync(srcPath, JSON.stringify(simplifiedGeojson));
const outBytes = readFileSync(srcPath).length;
console.log(`Wrote ${(outBytes / 1024 / 1024).toFixed(2)} MB → ${srcPath}`);
