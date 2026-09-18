/**
 * Derives the Punic Wars province graph from the rendered map, once, and writes
 * it out as data.
 *
 * The map was always drawn with the whole western Mediterranean on it, but only
 * Italy, Sicily and the Carthaginian heartland were ever written down as true:
 * everything else was an overlay painted over polygons the simulation had no
 * record of. This closes that gap by making the drawn world the authored world.
 *
 * It runs as a build step rather than at load time for two reasons. Deriving
 * adjacency walks 110k polygon vertices and takes the better part of a second,
 * which is not a thing to repeat per process; and the result is data a person
 * should be able to read and diff, not a computation whose output nobody sees.
 * `apps/web/lib` also cannot be imported from `packages/db`, so the graph has to
 * cross that boundary as a file regardless.
 *
 * Usage (cwd must be apps/web, whose public/maps holds the source geometry):
 *   npm run maps:graph
 */
import { writeFileSync } from "node:fs";
import { punicWarsGeoJson } from "../../apps/web/lib/punic-wars-geojson";
import { PUNIC_WARS_CONTROL_MANIFEST, PUNIC_WARS_MAP_POLITIES } from "../../apps/web/lib/punic-wars-map-territory";

type Point = readonly number[];

const OUTPUT = new URL("../../packages/db/src/punic-wars-map-graph.ts", import.meta.url).pathname;

/**
 * How close two polygon vertices must be to count as the same border.
 *
 * Exact vertex matching is not usable here. The rendered map is stitched from
 * several source datasets -- one for France's departments, one for Italy's
 * regions, one for Britain's districts, one for Greece, and a base map under all
 * of them -- and two datasets tracing the same real border do not place their
 * vertices in the same spots. Matching exactly found borders *within* each
 * dataset and none between them, which split the continent into pieces and left
 * Sicily looking for a sea crossing to Britain.
 *
 * Two kilometres is tight enough that no real channel is bridged by accident
 * (the narrowest here, the Messana strait, is about three) and loose enough to
 * close the seams between datasets.
 */
const BORDER_TOLERANCE_DEGREES = 0.02;

/** Degrees of latitude to kilometres, near enough for classifying crossings. */
const KM_PER_DEGREE = 111;

/**
 * How a gap between two landmasses is recorded, by how wide it is.
 *
 * Every gap left after the land borders are drawn is water. Dataset seams --
 * the Pyrenees join between the Iberian and Gaulish sources, say -- close under
 * the border tolerance above and never reach this point, so there is no dry
 * category here: a gap up to 80km is a strait an army can force (Gibraltar,
 * Dover, Bonifacio), and anything wider is a voyage.
 */
const STRAIT_KM = 80;

function ringsOf(feature: { geometry: { type: string; coordinates: unknown } }): Point[][] {
  const { type, coordinates } = feature.geometry;
  if (type === "MultiPolygon") return (coordinates as Point[][][]).flat();
  if (type === "Polygon") return coordinates as Point[][];
  return [];
}

/**
 * A handful of names in the source geometry were written out as UTF-8 and read
 * back as Latin-1, so "Bragança" arrived as "BRAGANÃA". These names are
 * about to stop being decoration -- they go into the world, onto the player's
 * screen, and into the model's prompt -- so the damage is undone here rather
 * than carried forward. Only strings carrying the signature are touched, so a
 * correctly-encoded "Zürich" is left alone.
 */
function repairEncoding(name: string): string {
  if (!/Ã.|Â.|â€/u.test(name)) return name;
  const repaired = Buffer.from(name, "latin1").toString("utf8");
  return repaired.includes("�") ? name : repaired;
}

const provinceFeatures = punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "province");
const inScope = new Set(PUNIC_WARS_CONTROL_MANIFEST.map((record) => record.provinceId));
const scopedFeatures = provinceFeatures.filter((feature) => inScope.has(feature.id));

const ringsById = new Map<string, Point[][]>();
for (const feature of provinceFeatures) ringsById.set(feature.id, ringsOf(feature as { geometry: { type: string; coordinates: unknown } }));

/**
 * Coastal-ness is measured against *every* polygon the map draws, not only the
 * ones in scope, so a province on the inland edge of the scenario's frame is not
 * mistaken for a shoreline. It is derived from exact shared segments, which is
 * reliable for this: a boundary segment no other polygon in the same dataset
 * uses is the outer edge of the landmass.
 *
 * Being wrong here is cheap in one direction only. "coastal-plain" admits land,
 * straits and sea lanes, so an over-generous coast never makes a legal move
 * illegal -- it only offers a crossing where none was needed.
 */
const segmentUse = new Map<string, number>();
for (const rings of ringsById.values()) {
  for (const ring of rings) {
    for (let index = 1; index < ring.length; index++) {
      const a = pointKeyOf(ring[index - 1]!);
      const b = pointKeyOf(ring[index]!);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      segmentUse.set(key, (segmentUse.get(key) ?? 0) + 1);
    }
  }
}
function pointKeyOf(point: Point): string {
  return `${point[0]!.toFixed(4)},${point[1]!.toFixed(4)}`;
}
const coastal = new Set<string>();
for (const feature of scopedFeatures) {
  const rings = ringsById.get(feature.id) ?? [];
  outer: for (const ring of rings) {
    for (let index = 1; index < ring.length; index++) {
      const a = pointKeyOf(ring[index - 1]!);
      const b = pointKeyOf(ring[index]!);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if ((segmentUse.get(key) ?? 0) === 1) {
        coastal.add(feature.id);
        break outer;
      }
    }
  }
}

/**
 * Terrain is derived, not authored: nobody is going to hand-classify 779
 * provinces. The only distinction that changes what is *legal* is whether a
 * province can be entered from the water, so that is the distinction drawn.
 * Shoreline provinces are coastal plain; the interior is hills and uplands.
 * Both admit ordinary land movement, so every shared border stays crossable.
 */
const terrainById = new Map<string, string>();
for (const feature of scopedFeatures) terrainById.set(feature.id, coastal.has(feature.id) ? "coastal-plain" : "hills-uplands");

// Adjacency by proximity. Every vertex is dropped into a grid cell the width of
// the tolerance and compared against its own cell and the eight around it, so
// the search stays linear in vertices rather than quadratic in provinces.
const vertexBuckets = new Map<string, Set<string>>();
for (const feature of scopedFeatures) {
  for (const ring of ringsById.get(feature.id) ?? []) {
    for (const point of ring) {
      const cx = Math.floor(point[0]! / BORDER_TOLERANCE_DEGREES);
      const cy = Math.floor(point[1]! / BORDER_TOLERANCE_DEGREES);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${cx + dx}:${cy + dy}`;
          let bucket = vertexBuckets.get(key);
          if (bucket === undefined) {
            bucket = new Set();
            vertexBuckets.set(key, bucket);
          }
          bucket.add(feature.id);
        }
      }
    }
  }
}

const neighbours = new Map<string, Set<string>>();
for (const feature of scopedFeatures) neighbours.set(feature.id, new Set());
for (const bucket of vertexBuckets.values()) {
  if (bucket.size < 2) continue;
  const members = [...bucket];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      neighbours.get(members[i]!)!.add(members[j]!);
      neighbours.get(members[j]!)!.add(members[i]!);
    }
  }
}

const edges: { from: string; to: string; crossing: string; distance: number }[] = [];
const recorded = new Set<string>();
function addEdge(a: string, b: string, crossing: string, distance: number): void {
  const [from, to] = [a, b].sort() as [string, string];
  const key = `${from}|${to}`;
  if (recorded.has(key)) return;
  recorded.add(key);
  edges.push({ from, to, crossing, distance });
}
for (const [id, set] of neighbours) for (const other of set) addEdge(id, other, "land", 1);

// Landmasses: what the land borders alone connect.
const componentOf = new Map<string, number>();
const components: string[][] = [];
for (const feature of scopedFeatures) {
  if (componentOf.has(feature.id)) continue;
  const index = components.length;
  const members: string[] = [];
  const queue = [feature.id];
  componentOf.set(feature.id, index);
  while (queue.length > 0) {
    const current = queue.pop()!;
    members.push(current);
    for (const next of neighbours.get(current) ?? []) {
      if (componentOf.has(next)) continue;
      componentOf.set(next, index);
      queue.push(next);
    }
  }
  components.push(members);
}

/**
 * Each landmass is joined to the rest of the world at its own shortest crossing,
 * by building a minimum spanning tree over the landmasses. Doing it this way
 * rather than attaching each stranded province to whatever was nearest and
 * already connected is what keeps the result geography rather than an artefact
 * of iteration order -- the earlier version had Madeira reaching the world
 * through the Canaries.
 */
function verticesOf(members: readonly string[], cap: number): Point[] {
  const all: Point[] = [];
  for (const id of members) for (const ring of ringsById.get(id) ?? []) for (const point of ring) all.push(point);
  if (all.length <= cap) return all;
  // Far crossings are measured in hundreds of kilometres; thinning a large
  // landmass's outline costs nothing at that range and keeps the search cheap.
  const stride = Math.ceil(all.length / cap);
  return all.filter((_, index) => index % stride === 0);
}

const coastVertices = components.map((members) => verticesOf(members.filter((id) => terrainById.get(id) === "coastal-plain"), 1_500));

function closestPair(a: number, b: number): { from: Point; to: Point; distance: number } | null {
  let best: { from: Point; to: Point; distance: number } | null = null;
  for (const here of coastVertices[a]!) {
    for (const there of coastVertices[b]!) {
      const distance = Math.hypot(here[0]! - there[0]!, here[1]! - there[1]!);
      if (best === null || distance < best.distance) best = { from: here, to: there, distance };
    }
  }
  return best;
}

function provinceAt(component: number, point: Point): string {
  let best: { id: string; distance: number } | null = null;
  for (const id of components[component]!) {
    if (terrainById.get(id) !== "coastal-plain") continue;
    for (const ring of ringsById.get(id) ?? []) {
      for (const candidate of ring) {
        const distance = Math.hypot(candidate[0]! - point[0]!, candidate[1]! - point[1]!);
        if (best === null || distance < best.distance) best = { id, distance };
      }
    }
  }
  return best!.id;
}

const crossings: { from: string; to: string; crossing: string; km: number }[] = [];
const joined = new Set<number>([components.reduce((largest, members, index) => (members.length > components[largest]!.length ? index : largest), 0)]);
while (joined.size < components.length) {
  let best: { inside: number; outside: number; pair: { from: Point; to: Point; distance: number } } | null = null;
  for (const inside of joined) {
    for (let outside = 0; outside < components.length; outside++) {
      if (joined.has(outside)) continue;
      const pair = closestPair(inside, outside);
      if (pair === null) continue;
      if (best === null || pair.distance < best.pair.distance) best = { inside, outside, pair };
    }
  }
  if (best === null) break;
  const km = best.pair.distance * KM_PER_DEGREE;
  const crossing = km <= STRAIT_KM ? "strait" : "sea_lane";
  const from = provinceAt(best.inside, best.pair.from);
  const to = provinceAt(best.outside, best.pair.to);
  addEdge(from, to, crossing, Math.max(1, Math.round(best.pair.distance)));
  crossings.push({ from, to, crossing, km: Math.round(km) });
  joined.add(best.outside);
}

const nameById = new Map(provinceFeatures.map((feature) => [feature.id, repairEncoding((feature.properties as { name?: string }).name ?? feature.id)]));

/**
 * The settlements the map already draws, carried into the world with the
 * province that holds them.
 *
 * This is not decoration. A settlement drawn on the map but missing from the
 * world is visible and clickable to a player and impossible to besiege, which
 * is the same failure in miniature as a province that renders with nothing
 * behind it. Nothing is invented here: only what the map shows becomes real, so
 * no city appears in Pannonia that no polygon ever claimed.
 */
const controllerByProvince = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
const settlementKind = (type: string): string => (type === "capital" ? "city" : type === "fort" ? "fortress" : type);
const settlementSize = (type: string): number =>
  type === "capital" ? 100 : type === "city" ? 80 : type === "port" ? 70 : type === "fort" ? 55 : 40;
// The same convention `canvas-world.ts` used when it materialised a province
// from the canvas one at a time.
const fortification = (type: string): number => (type === "fort" ? 3 : type === "capital" ? 5 : 1);

const settlements = punicWarsGeoJson.features.flatMap((feature) => {
  if (feature.properties.kind !== "settlement") return [];
  const properties = feature.properties as { name?: string; provinceId: string; type: string };
  const controllerPolityId = controllerByProvince.get(properties.provinceId);
  if (controllerPolityId === undefined) return [];
  return [{
    id: feature.id,
    name: repairEncoding(properties.name ?? feature.id),
    kind: settlementKind(properties.type),
    provinceId: properties.provinceId,
    controllerPolityId,
    size: settlementSize(properties.type),
    fortificationLevel: fortification(properties.type),
  }];
}).sort((a, b) => a.id.localeCompare(b.id));

/**
 * A capital is a fact about a polity, and the map records four beyond the ones
 * the scenario authored by hand: Cirta, Volubilis, Garama and Cyrene. Naming
 * them matters past display -- a polity holding a named capital is one the
 * world will give a leader to before it gets around to the hill tribes.
 */
const CAPITAL_BY_SETTLEMENT: Readonly<Record<string, string>> = {
  "settlement-cirta": "numidian-kingdoms",
  "settlement-volubilis": "mauretanian-peoples",
  "settlement-garama": "garamantes",
  "settlement-cyrene": "ptolemaic-cyrenaica",
};
const capitalByPolity = new Map<string, string>();
for (const [settlementId, polityId] of Object.entries(CAPITAL_BY_SETTLEMENT)) {
  if (settlements.some((settlement) => settlement.id === settlementId)) capitalByPolity.set(polityId, settlementId);
}

const provinces = PUNIC_WARS_CONTROL_MANIFEST.map((record) => ({
  id: record.provinceId,
  name: nameById.get(record.provinceId) ?? record.provinceId,
  terrainId: terrainById.get(record.provinceId) ?? "hills-uplands",
  controllerPolityId: record.controllerPolityId,
  // Rome and Carthage hold their own ground harder than the peoples whose
  // territory is being asserted from outside. This mirrors what the opening
  // overlay claimed, so nothing already on screen changes meaning.
  controlFirmnessBps: record.controllerPolityId === "rome" || record.controllerPolityId === "carthage" ? 8_500 : 7_000,
})).sort((a, b) => a.id.localeCompare(b.id));

edges.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
const polities = [...PUNIC_WARS_MAP_POLITIES]
  .map((polity) => ({ ...polity, capitalSettlementId: capitalByPolity.get(polity.polityId) ?? null }))
  .sort((a, b) => a.polityId.localeCompare(b.polityId));

const reachable = new Set<string>();
for (const edge of edges) {
  reachable.add(edge.from);
  reachable.add(edge.to);
}
const unreachable = provinces.filter((province) => !reachable.has(province.id));

const lines = (rows: readonly unknown[]): string =>
  `[\n${rows.map((row) => `  ${JSON.stringify(row)},`).join("\n")}\n]`;

const header = `// GENERATED FILE -- do not edit by hand.
// Regenerate with \`npm run maps:graph\` (scripts/map-graph/build-punic-map-graph.ts).
//
// The Punic Wars province graph, derived from the map the game already draws.
// Every province the map gives a controller is here, with the terrain its
// shoreline implies and the borders its polygon actually shares. This is what
// makes the map true: before it, only Italy, Sicily and the Carthaginian
// heartland were written down, and the rest of the Mediterranean was an overlay
// painted over ground the simulation had no record of.
//
// Provinces: ${provinces.length}. Borders: ${edges.length}. Polities: ${polities.length}. Settlements: ${settlements.length}.
// Landmasses found: ${components.length}, joined by ${crossings.length} water or seam crossings:
${crossings.map((crossing) => `//   ${crossing.crossing.padEnd(9)} ~${String(crossing.km).padStart(4)} km  ${crossing.from} <-> ${crossing.to}`).join("\n")}

export interface MapGraphProvince {
  readonly id: string;
  readonly name: string;
  readonly terrainId: string;
  readonly controllerPolityId: string;
  readonly controlFirmnessBps: number;
}

export interface MapGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly crossing: "land" | "strait" | "sea_lane";
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

writeFileSync(OUTPUT, [
  header,
  `export const PUNIC_WARS_GRAPH_PROVINCES: readonly MapGraphProvince[] = ${lines(provinces)};`,
  "",
  `export const PUNIC_WARS_GRAPH_EDGES: readonly MapGraphEdge[] = ${lines(edges)};`,
  "",
  `export const PUNIC_WARS_GRAPH_POLITIES: readonly MapGraphPolity[] = ${lines(polities)};`,
  "",
  `export const PUNIC_WARS_GRAPH_SETTLEMENTS: readonly MapGraphSettlement[] = ${lines(settlements)};`,
  "",
].join("\n"));

console.log(`provinces: ${provinces.length}`);
console.log(`polities: ${polities.length}`);
console.log(`coastal: ${provinces.filter((province) => province.terrainId === "coastal-plain").length}`);
console.log(`settlements: ${settlements.length}`);
console.log(`named capitals: ${polities.filter((polity) => polity.capitalSettlementId !== null).length}`);
console.log(`land borders: ${edges.filter((edge) => edge.crossing === "land").length}`);
console.log(`landmasses: ${components.length}`);
for (const crossing of crossings) console.log(`  ${crossing.crossing.padEnd(9)} ~${String(crossing.km).padStart(4)} km  ${crossing.from} <-> ${crossing.to}`);
console.log(`unreachable: ${unreachable.length}${unreachable.length === 0 ? "" : ` ${unreachable.map((province) => province.id).join(", ")}`}`);
console.log(`written: ${OUTPUT}`);
