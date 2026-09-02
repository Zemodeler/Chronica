/**
 * Rebuild the French, German, and Spanish internal province arcs without
 * changing any country's national outline. The source is converted to a local TopoJSON
 * topology first, so each shared border is one arc and is emitted identically
 * (in reverse) for the two provinces that use it.
 *
 * Usage:
 *   node scripts/rework-france-germany-geojson.mjs --check
 *   node scripts/rework-france-germany-geojson.mjs --apply
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as topojsonClient from "topojson-client";
import * as topojsonServer from "topojson-server";

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dir, "..");
const mapPath = join(repoRoot, "apps/web/public/maps/europe-north-africa-adm1.geojson");
const apply = process.argv.includes("--apply");
const countryArgument = process.argv.indexOf("--country");
const selectedCountry = countryArgument === -1 ? undefined : process.argv[countryArgument + 1];

const settings = {
  // Germany's raw ADM2 arcs have thousands of near-collinear survey points.
  // This keeps the terrain-led turns and basin shapes, not digitising noise.
 deu: { tolerance: 0.01 },
  // France retains its broad regional form while shedding only short survey wiggles.
  fra: { tolerance: 0.03 },
  // Spain combines broad interior regions with rugged coast- and mountain-led edges.
  esp: { tolerance: 0.018 },
  // Romania already has a strong basin-and-corridor rhythm; remove survey noise only.
  rou: { tolerance: 0.0015 },
};

const round = (value) => Number(value.toFixed(5));
const pointKey = ([x, y]) => `${x},${y}`;
const arcIndex = (index) => (index < 0 ? ~index : index);

function visitArcIndexes(geometry, visit) {
  if (geometry.type === "Polygon") {
    for (const ring of geometry.arcs) for (const index of ring) visit(arcIndex(index));
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.arcs) for (const ring of polygon) for (const index of ring) visit(arcIndex(index));
  }
}

function arcUses(topology) {
  const uses = new Map();
  for (const geometry of topology.objects.provinces.geometries) {
    visitArcIndexes(geometry, (index) => uses.set(index, (uses.get(index) ?? 0) + 1));
  }
  return uses;
}

function distanceToSegment(point, start, end) {
  const [px, py] = point;
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  if (dx === 0 && dy === 0) return Math.hypot(px - sx, py - sy);
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
}

function simplifyArc(arc, tolerance) {
  if (arc.length <= 2) return arc.map(([x, y]) => [round(x), round(y)]);
  const keep = new Uint8Array(arc.length);
  keep[0] = 1;
  keep[arc.length - 1] = 1;
  const simplifyRange = (first, last) => {
    let distance = tolerance;
    let candidate = -1;
    for (let index = first + 1; index < last; index += 1) {
      const nextDistance = distanceToSegment(arc[index], arc[first], arc[last]);
      if (nextDistance > distance) {
        distance = nextDistance;
        candidate = index;
      }
    }
    if (candidate !== -1) {
      keep[candidate] = 1;
      simplifyRange(first, candidate);
      simplifyRange(candidate, last);
    }
  };
  simplifyRange(0, arc.length - 1);
  return arc.filter((_, index) => keep[index]).map(([x, y]) => [round(x), round(y)]);
}

function vertexCount(feature) {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polygons.reduce((sum, polygon) => sum + polygon.reduce((ringSum, ring) => ringSum + ring.length - 1, 0), 0);
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[index + 1];
    area += ax * by - bx * ay;
  }
  return area / 2;
}

function geometryArea(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((sum, polygon) => sum + polygon.reduce((polygonArea, ring, index) => polygonArea + (index === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0), 0);
}

function canonicalArc(arc) {
  const forward = arc.map(pointKey).join(";");
  const backward = [...arc].reverse().map(pointKey).join(";");
  return forward < backward ? forward : backward;
}

function exteriorArcs(topology) {
  const uses = arcUses(topology);
  return new Set([...uses].filter(([, count]) => count === 1).map(([index]) => canonicalArc(topology.arcs[index])));
}

function orientation([ax, ay], [bx, by], [cx, cy]) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function haveSharedEndpoint(first, second) {
  const firstEndpoints = new Set([pointKey(first.start), pointKey(first.end)]);
  return firstEndpoints.has(pointKey(second.start)) || firstEndpoints.has(pointKey(second.end));
}

function properlyIntersect(first, second) {
  if (haveSharedEndpoint(first, second)) return false;
  const abC = orientation(first.start, first.end, second.start);
  const abD = orientation(first.start, first.end, second.end);
  const cdA = orientation(second.start, second.end, first.start);
  const cdB = orientation(second.start, second.end, first.end);
  return abC * abD <= 0 && cdA * cdB <= 0;
}

function assertNoInternalCrossings(code, topology, changedArcs) {
  const gridSize = 0.1;
  const cells = new Map();
  const segments = [];
  for (let arc = 0; arc < topology.arcs.length; arc += 1) {
    const points = topology.arcs[arc];
    for (let index = 0; index < points.length - 1; index += 1) {
      const segment = { arc, index, start: points[index], end: points[index + 1] };
      if (pointKey(segment.start) === pointKey(segment.end)) continue;
      const id = segments.push(segment) - 1;
      const minX = Math.floor(Math.min(segment.start[0], segment.end[0]) / gridSize);
      const maxX = Math.floor(Math.max(segment.start[0], segment.end[0]) / gridSize);
      const minY = Math.floor(Math.min(segment.start[1], segment.end[1]) / gridSize);
      const maxY = Math.floor(Math.max(segment.start[1], segment.end[1]) / gridSize);
      for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`;
        const cell = cells.get(key);
        if (cell === undefined) cells.set(key, [id]);
        else cell.push(id);
      }
    }
  }
  const compared = new Set();
  for (const cell of cells.values()) for (let left = 0; left < cell.length; left += 1) for (let right = left + 1; right < cell.length; right += 1) {
    const firstId = cell[left];
    const secondId = cell[right];
    const key = firstId < secondId ? `${firstId}:${secondId}` : `${secondId}:${firstId}`;
    if (compared.has(key)) continue;
    compared.add(key);
    const first = segments[firstId];
    const second = segments[secondId];
    if (!changedArcs.has(first.arc) && !changedArcs.has(second.arc)) continue;
    if (first.arc === second.arc && Math.abs(first.index - second.index) <= 1) continue;
    if (properlyIntersect(first, second)) return [first, second];
  }
  return undefined;
}

function validateCountry({ code, before, after, topology, changedArcs }) {
  const originalTopology = topojsonServer.topology({ provinces: { type: "FeatureCollection", features: before } });
  const beforeExterior = exteriorArcs(originalTopology);
  const afterExterior = exteriorArcs(topology);
  if (beforeExterior.size !== afterExterior.size || [...beforeExterior].some((arc) => !afterExterior.has(arc))) {
    throw new Error(`${code}: the national/coastal outline changed.`);
  }

  for (const feature of after) {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      if (ring.length < 4 || pointKey(ring[0]) !== pointKey(ring[ring.length - 1])) throw new Error(`${code}: an output ring is not closed.`);
      for (const point of ring) if (point[0] !== round(point[0]) || point[1] !== round(point[1])) throw new Error(`${code}: coordinates are not consistently rounded to five decimals.`);
    }
  }

  const featureArea = after.reduce((sum, feature) => sum + geometryArea(feature.geometry), 0);
  const merged = topojsonClient.merge(topology, topology.objects.provinces.geometries);
  const mergedArea = geometryArea(merged);
  // Spain is repaired with GEOS before this step because the source contains
  // malformed zero-area fragments. Its robust coverage check is performed by
  // repair-spain-geojson.py; TopoJSON's arc merge cannot faithfully measure
  // that mixed island geometry before it has been polygonized.
  if (code !== "esp" && Math.abs(featureArea - mergedArea) > 1e-8) throw new Error(`${code}: provinces do not form an exact partition (gap or overlap detected).`);
  const crossing = assertNoInternalCrossings(code, topology, changedArcs);
  if (crossing !== undefined) throw new Error(`${code}: simplified internal arcs self-intersect or cross another boundary (arcs ${crossing[0].arc}:${crossing[0].index} ${pointKey(crossing[0].start)}→${pointKey(crossing[0].end)} and ${crossing[1].arc}:${crossing[1].index} ${pointKey(crossing[1].start)}→${pointKey(crossing[1].end)}).`);

  const counts = after.map(vertexCount).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  console.log(`${code}: ${after.length} provinces; vertices min/median/max ${counts[0]}/${median}/${counts.at(-1)}; outline preserved; partition area ${featureArea.toFixed(6)}.`);
}

const map = JSON.parse(readFileSync(mapPath, "utf8"));
const replacements = new Map();

for (const [code, { tolerance }] of Object.entries(settings)) {
  if (selectedCountry !== undefined && selectedCountry !== code) continue;
  const source = map.features.filter((feature) => feature.id.startsWith(`${code}-`) && feature.properties.kind === "province");
  if (!apply) {
    const topology = topojsonServer.topology({ provinces: { type: "FeatureCollection", features: source } });
    validateCountry({ code, before: source, after: source, topology, changedArcs: new Set(topology.arcs.map((_, index) => index)) });
    continue;
  }
  let topology = topojsonServer.topology({ provinces: { type: "FeatureCollection", features: source } });
  const uses = arcUses(topology);
  const originalArcs = topology.arcs.map((arc) => arc.map(([x, y]) => [x, y]));
  let changedArcs = 0;
  const changedArcIndexes = new Set();
  for (const [index, count] of uses) {
    // One-use arcs form the exterior, whether a coastline or an international border.
    if (count !== 2) {
      topology.arcs[index] = originalArcs[index];
      continue;
    }
    topology.arcs[index] = simplifyArc(topology.arcs[index], tolerance);
    changedArcs += 1;
    changedArcIndexes.add(index);
  }
  // Douglas–Peucker is applied only to internal arcs.  If a very tight river
  // or border corridor would fold after reduction, retain that one source arc
  // rather than trade a small amount of detail for invalid topology.
  for (let crossing = assertNoInternalCrossings(code, topology, changedArcIndexes); crossing !== undefined; crossing = assertNoInternalCrossings(code, topology, changedArcIndexes)) {
    const restore = [crossing[0].arc, crossing[1].arc].find((index) => changedArcIndexes.has(index));
    if (restore === undefined) throw new Error(`${code}: an unchanged boundary already crosses a simplified arc.`);
    topology.arcs[restore] = originalArcs[restore];
    changedArcIndexes.delete(restore);
  }
  const rebuilt = topojsonClient.feature(topology, topology.objects.provinces).features;
  for (let index = 0; index < rebuilt.length; index += 1) {
    rebuilt[index].id = source[index].id;
    rebuilt[index].properties = source[index].properties;
    replacements.set(source[index].id, rebuilt[index]);
  }
  console.log(`${code}: simplified ${changedArcIndexes.size}/${changedArcs} shared internal arcs with tolerance ${tolerance}.`);
  validateCountry({ code, before: source, after: rebuilt, topology, changedArcs: changedArcIndexes });
}

if (!apply) {
  console.log("Check complete.");
  process.exit(0);
}

map.features = map.features.map((feature) => replacements.get(feature.id) ?? feature);
writeFileSync(mapPath, JSON.stringify(map));
console.log(`Wrote ${mapPath}`);
