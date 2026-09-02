import "server-only";

import type { GeoJsonMap, GeoJsonMapFeature } from "@chronica/shared";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";

type Point = readonly [number, number];
type Ring = readonly Point[];
type Polygon = readonly Ring[];
type HistoricalSite = Readonly<{ id: string; name: string; coordinate: Point; territorialWeight?: number }>;
type GroundedTerritory = Readonly<{ sourceId: string; id: string; name: string }>;
type BorderStyle = "default" | "carthaginian";

function clipRingToHalfPlane(ring: Ring, valueAt: (point: Point) => number): [number, number][] {
  const result: [number, number][] = [];
  const points = ring.slice(0, -1);
  for (let index = 0; index < points.length; index++) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const currentValue = valueAt(current);
    const nextValue = valueAt(next);
    const currentInside = currentValue <= 0;
    const nextInside = nextValue <= 0;
    const crossing = (): [number, number] => {
      const ratio = currentValue / (currentValue - nextValue);
      return [current[0] + (next[0] - current[0]) * ratio, current[1] + (next[1] - current[1]) * ratio];
    };
    if (currentInside) result.push([current[0], current[1]]);
    if (currentInside !== nextInside) result.push(crossing());
  }
  if (result.length < 3) return [];
  result.push([...result[0]!]);
  return result;
}

function polygonsFor(feature: GeoJsonMapFeature): Polygon[] {
  if (feature.geometry.type === "Polygon") return [feature.geometry.coordinates];
  if (feature.geometry.type === "MultiPolygon") return feature.geometry.coordinates;
  return [];
}

function roundedPoint([longitude, latitude]: Point): [number, number] {
  return [Number(longitude.toFixed(5)), Number(latitude.toFixed(5))];
}

function pointKey(point: Point): string {
  const [longitude, latitude] = roundedPoint(point);
  return `${longitude},${latitude}`;
}

function edgeKey(first: Point, second: Point): string {
  const firstKey = pointKey(first);
  const secondKey = pointKey(second);
  return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 0x01000193);
  return result >>> 0;
}

/** A deterministic, shared bend for a generated internal border segment. */
function organicEdge(first: Point, second: Point, irregularity = 1): [number, number][] {
  const firstKey = pointKey(first);
  const secondKey = pointKey(second);
  const forward = firstKey < secondKey;
  const start = forward ? roundedPoint(first) : roundedPoint(second);
  const end = forward ? roundedPoint(second) : roundedPoint(first);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.03) return forward ? [start, end] : [end, start];
  const seed = hash(`${start[0]},${start[1]}|${end[0]},${end[1]}`);
  const normal: [number, number] = [-dy / length, dx / length];
  const amplitude = Math.min(0.16 * irregularity, length * (0.065 + (seed % 35) / 1_000) * irregularity);
  const direction = seed % 2 === 0 ? 1 : -1;
  const bent = [0.16, 0.34, 0.54, 0.74, 0.89].map((position, index) => {
    const wave = direction * amplitude * (index % 2 === 0 ? 1 : -0.72) * (0.8 + ((seed >>> (index * 5)) % 20) / 100);
    return roundedPoint([start[0] + dx * position + normal[0] * wave, start[1] + dy * position + normal[1] * wave]);
  });
  const result = [start, ...bent, end];
  return forward ? result : [...result].reverse();
}

/**
 * A broad, deliberate core–hinterland border: one long basin-like turn and a
 * small shoulder rather than the alternating saw-teeth used by the older
 * tribal reconstruction. The seed makes both owners emit the exact same line
 * in reverse.
 */
function carthaginianEdge(first: Point, second: Point, irregularity = 1): [number, number][] {
  const firstKey = pointKey(first);
  const secondKey = pointKey(second);
  const forward = firstKey < secondKey;
  const start = forward ? roundedPoint(first) : roundedPoint(second);
  const end = forward ? roundedPoint(second) : roundedPoint(first);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.045) return forward ? [start, end] : [end, start];
  const seed = hash(`${start[0]},${start[1]}|${end[0]},${end[1]}|carthage`);
  const normal: [number, number] = [-dy / length, dx / length];
  const direction = seed % 2 === 0 ? 1 : -1;
  const amplitude = Math.min(0.12 * irregularity, length * (0.075 + (seed % 20) / 1_000) * irregularity);
  const shoulder = amplitude * (0.16 + ((seed >>> 5) % 12) / 100);
  const bend = [0.22, 0.49, 0.76].map((position) => {
    const main = Math.sin(Math.PI * position) * amplitude;
    const secondary = Math.sin(2 * Math.PI * position) * shoulder;
    return roundedPoint([start[0] + dx * position + normal[0] * direction * (main + secondary), start[1] + dy * position + normal[1] * direction * (main + secondary)]);
  });
  const result = [start, ...bend, end];
  return forward ? result : [...result].reverse();
}

/**
 * Replaces only borders shared by generated regions.  Each repeated edge uses
 * the same seeded polyline in reverse, so the map gains natural irregularity
 * without creating gaps or overlaps between neighbours.
 */
function organicizeInternalBorders(features: readonly GeoJsonMapFeature[], irregularity = 1): GeoJsonMapFeature[] {
  const edgeCounts = new Map<string, number>();
  for (const feature of features) {
    if (feature.geometry.type !== "MultiPolygon") continue;
    for (const polygon of feature.geometry.coordinates) for (const ring of polygon) for (let index = 1; index < ring.length; index++) {
      const key = edgeKey(ring[index - 1]!, ring[index]!);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  return features.map((feature) => {
    if (feature.geometry.type !== "MultiPolygon") return feature;
    return {
      ...feature,
      geometry: {
        type: "MultiPolygon" as const,
        coordinates: feature.geometry.coordinates.map((polygon) => polygon.map((ring) => {
          const result: [number, number][] = [roundedPoint(ring[0]!)];
          for (let index = 1; index < ring.length; index++) {
            const first = ring[index - 1]!;
            const second = ring[index]!;
            const points = (edgeCounts.get(edgeKey(first, second)) ?? 0) > 1 ? organicEdge(first, second, irregularity) : [roundedPoint(first), roundedPoint(second)];
            result.push(...points.slice(1));
          }
          return result;
        })),
      },
    };
  });
}

function carthaginianizeInternalBorders(features: readonly GeoJsonMapFeature[], irregularity = 1): GeoJsonMapFeature[] {
  const edgeCounts = new Map<string, number>();
  for (const feature of features) {
    if (feature.geometry.type !== "MultiPolygon") continue;
    for (const polygon of feature.geometry.coordinates) for (const ring of polygon) for (let index = 1; index < ring.length; index++) {
      const key = edgeKey(ring[index - 1]!, ring[index]!);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  return features.map((feature) => {
    if (feature.geometry.type !== "MultiPolygon") return feature;
    return {
      ...feature,
      geometry: {
        type: "MultiPolygon" as const,
        coordinates: feature.geometry.coordinates.map((polygon) => polygon.map((ring) => {
          const result: [number, number][] = [roundedPoint(ring[0]!)];
          for (let index = 1; index < ring.length; index++) {
            const first = ring[index - 1]!;
            const second = ring[index]!;
            const points = (edgeCounts.get(edgeKey(first, second)) ?? 0) > 1 ? carthaginianEdge(first, second, irregularity) : [roundedPoint(first), roundedPoint(second)];
            result.push(...points.slice(1));
          }
          return result;
        })),
      },
    };
  });
}

/**
 * Fixed historical centres form a clipped Voronoi partition.  The result
 * preserves every source coastline and gives regions organic hinterlands
 * instead of grid-like modern administrative fragments.
 */
function historicalRegions(source: readonly GeoJsonMapFeature[], sites: readonly HistoricalSite[], borderIrregularity = 1, borderStyle: BorderStyle = "default"): GeoJsonMapFeature[] {
  const polygons = source.flatMap(polygonsFor);
  const regions: GeoJsonMapFeature[] = sites.map((site): GeoJsonMapFeature => {
    const coordinates = polygons.flatMap((polygon) => {
      let ring = polygon[0]?.map((point) => [point[0], point[1]] as [number, number]) ?? [];
      for (const other of sites) {
        if (other.id === site.id || ring.length === 0) continue;
        const [sx, sy] = site.coordinate;
        const [ox, oy] = other.coordinate;
        ring = clipRingToHalfPlane(ring, ([x, y]) => (x - sx) ** 2 + (y - sy) ** 2 - (site.territorialWeight ?? 0) - ((x - ox) ** 2 + (y - oy) ** 2 - (other.territorialWeight ?? 0)));
      }
      return ring.length === 0 ? [] : [[ring]];
    });
    if (coordinates.length === 0) throw new Error(`Historical region ${site.id} does not intersect its source geography.`);
    return {
      type: "Feature",
      id: site.id,
      geometry: { type: "MultiPolygon", coordinates },
      properties: { kind: "province", name: site.name },
    };
  });
  return borderStyle === "carthaginian" ? carthaginianizeInternalBorders(regions, borderIrregularity) : organicizeInternalBorders(regions, borderIrregularity);
}

function replaceProvinceGroup(map: GeoJsonMap, sourceIds: ReadonlySet<string>, sites: readonly HistoricalSite[], borderIrregularity = 1, borderStyle: BorderStyle = "default"): GeoJsonMap {
  const source = map.features.filter((feature) => sourceIds.has(feature.id));
  if (source.length !== sourceIds.size) throw new Error("A requested historical source province is missing from the base GeoJSON.");
  const replacement = historicalRegions(source, sites, borderIrregularity, borderStyle);
  let inserted = false;
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (!sourceIds.has(feature.id)) return [feature];
      if (inserted) return [];
      inserted = true;
      return replacement;
    }),
  };
}

/**
 * Keeps a surveyed local boundary when it is already more meaningful than a
 * reconstructed one.  France and Germania used to be cut from their entire
 * modern outline by a site-centred tessellation; using the existing local
 * hydrographic/settlement-scale outlines avoids inventing a country-wide
 * lattice while still giving the 270 BCE map its own names and ownership.
 */
function replaceWithGroundedTerritories(map: GeoJsonMap, territories: readonly GroundedTerritory[]): GeoJsonMap {
  const territoryBySourceId = new Map(territories.map((territory) => [territory.sourceId, territory]));
  if (territoryBySourceId.size !== territories.length) throw new Error("A grounded territory source was assigned twice.");
  const sourceIds = new Set(territoryBySourceId.keys());
  const sourceCount = map.features.filter((feature) => sourceIds.has(feature.id)).length;
  if (sourceCount !== sourceIds.size) throw new Error("A grounded territory source is missing from the base GeoJSON.");
  return {
    ...map,
    features: map.features.map((feature) => {
      const territory = territoryBySourceId.get(feature.id);
      return territory === undefined
        ? feature
        : { ...feature, id: territory.id, properties: { ...feature.properties, name: territory.name } };
    }),
  };
}

function provinceIds(map: GeoJsonMap, prefix: string, omit: readonly string[] = []): Set<string> {
  const excluded = new Set(omit);
  return new Set(map.features.filter((feature) => feature.properties.kind === "province" && feature.id.startsWith(prefix) && !excluded.has(feature.id)).map((feature) => feature.id));
}

const ITALIAN_SITES: readonly HistoricalSite[] = [
  { id: "punic-italy-liguria-west", name: "Western Liguria", coordinate: [8.15, 44.15] },
  { id: "punic-italy-liguria-genua", name: "Genoate Liguria", coordinate: [8.95, 44.41] },
  { id: "punic-italy-liguria-east", name: "Eastern Liguria", coordinate: [9.45, 44.35] },
  { id: "punic-italy-insubria-ticinum", name: "Insubria of Ticinum", coordinate: [8.95, 45.20] },
  { id: "punic-italy-insubria-mediolanum", name: "Insubria of Mediolanum", coordinate: [9.19, 45.46] },
  { id: "punic-italy-boii-rhenus", name: "Boii of the Rhenus", coordinate: [10.75, 44.70] },
  { id: "punic-italy-boii-felsina", name: "Boii of Felsina", coordinate: [11.34, 44.50] },
  { id: "punic-italy-cenomani-brixia", name: "Cenomani of Brixia", coordinate: [10.22, 45.54] },
  { id: "punic-italy-cenomani-mincius", name: "Cenomani of the Mincius", coordinate: [10.70, 45.35] },
  { id: "punic-italy-veneti-ateste", name: "Veneti of Ateste", coordinate: [11.65, 45.22] },
  { id: "punic-italy-veneti-patavium", name: "Veneti of Patavium", coordinate: [11.88, 45.41] },
  { id: "punic-italy-veneti-adria", name: "Veneti of Adria", coordinate: [12.05, 45.05] },
  { id: "punic-italy-etruria-north", name: "Northern Etruria", coordinate: [11.85, 43.40] },
  { id: "punic-italy-etruria-central", name: "Central Etruria", coordinate: [11.88, 42.42] },
  { id: "punic-italy-etruria-south", name: "Southern Etruria", coordinate: [12.12, 41.87] },
  { id: "punic-italy-latium", name: "Latium", coordinate: [12.50, 41.90] },
  { id: "punic-italy-sabines", name: "Sabines", coordinate: [12.86, 42.41] },
  { id: "punic-italy-umbrians", name: "Umbria", coordinate: [12.57, 43.11] },
  { id: "punic-italy-picentes", name: "Picenum", coordinate: [13.58, 42.85] },
  { id: "punic-italy-marsi", name: "Marsi and Paeligni", coordinate: [13.62, 42.09] },
  { id: "punic-italy-campania", name: "Campania", coordinate: [14.17, 41.03] },
  { id: "punic-italy-samnium", name: "Samnium", coordinate: [14.48, 41.56] },
  { id: "punic-italy-daunians", name: "Daunia", coordinate: [15.34, 41.50] },
  { id: "punic-italy-peucetians", name: "Peucetia", coordinate: [16.50, 41.13] },
  { id: "punic-italy-messapians", name: "Messapia", coordinate: [17.95, 40.35] },
  { id: "punic-italy-tarentines", name: "Tarentum", coordinate: [17.23, 40.47] },
  { id: "punic-italy-lucanians", name: "Lucania", coordinate: [15.80, 40.64] },
  { id: "punic-italy-bruttians", name: "Bruttium", coordinate: [16.19, 39.30] },
  { id: "punic-italy-rhegines", name: "Rhegium", coordinate: [15.65, 38.11] },
];

// These are territorial reconstructions rather than exact frontiers.  They
// deliberately use broad Iron Age community areas, while keeping every base
// coastline and external border intact.
const ILLYRIAN_SITES: readonly HistoricalSite[] = [
  { id: "punic-illyria-histri", name: "Histri", coordinate: [13.85, 45.10] },
  { id: "punic-illyria-iapodes", name: "Iapodes", coordinate: [15.85, 44.90] },
  { id: "punic-illyria-liburni", name: "Liburni", coordinate: [15.30, 44.10] },
  { id: "punic-illyria-delmatae", name: "Delmatae", coordinate: [16.70, 43.60] },
  { id: "punic-illyria-daorsi", name: "Daorsi", coordinate: [17.90, 43.35] },
  { id: "punic-illyria-autariatae", name: "Autariatae", coordinate: [18.60, 43.55] },
  { id: "punic-illyria-pirustae", name: "Pirustae", coordinate: [19.80, 42.00] },
  { id: "punic-illyria-ardiaei", name: "Ardiaei", coordinate: [19.00, 42.30] },
  { id: "punic-illyria-docleatae", name: "Docleatae", coordinate: [19.30, 42.60] },
  { id: "punic-illyria-labeatae", name: "Labeatae", coordinate: [19.50, 42.20] },
  { id: "punic-illyria-taulantii", name: "Taulantii", coordinate: [19.50, 41.30] },
  { id: "punic-illyria-parthini", name: "Parthini", coordinate: [20.10, 41.30] },
  { id: "punic-illyria-dassaretii", name: "Dassaretii", coordinate: [20.70, 40.70] },
  { id: "punic-illyria-dardani", name: "Dardani", coordinate: [21.00, 42.70] },
  { id: "punic-illyria-breuci", name: "Breuci", coordinate: [18.70, 45.10] },
  { id: "punic-illyria-pannonii", name: "Pannonii", coordinate: [17.70, 45.50] },
];

const THRACIAN_SITES: readonly HistoricalSite[] = [
  { id: "punic-thrace-odrysians", name: "Odrysians", coordinate: [26.30, 42.50] },
  { id: "punic-thrace-bessi", name: "Bessi", coordinate: [24.70, 41.70] },
  { id: "punic-thrace-maedi", name: "Maedi", coordinate: [23.20, 41.80] },
  { id: "punic-thrace-dentheletae", name: "Dentheletae", coordinate: [23.40, 42.50] },
  { id: "punic-thrace-serdi", name: "Serdi", coordinate: [23.30, 42.70] },
  { id: "punic-thrace-triballi", name: "Triballi", coordinate: [22.10, 44.00] },
  { id: "punic-thrace-moesi", name: "Moesi", coordinate: [23.00, 43.80] },
  { id: "punic-thrace-getae", name: "Getae", coordinate: [26.00, 44.60] },
  { id: "punic-thrace-crobyzi", name: "Crobyzi", coordinate: [28.00, 44.30] },
  { id: "punic-thrace-tyrizagetae", name: "Tyrizagetae", coordinate: [28.40, 45.00] },
  { id: "punic-thrace-daci", name: "Daci", coordinate: [25.60, 46.20] },
  { id: "punic-thrace-carpi", name: "Carpi", coordinate: [27.60, 47.20] },
  { id: "punic-thrace-costoboci", name: "Costoboci", coordinate: [25.00, 47.30] },
  { id: "punic-thrace-buri", name: "Buri", coordinate: [22.80, 45.30] },
  { id: "punic-thrace-scordisci", name: "Scordisci", coordinate: [21.40, 44.70] },
];

const BULGARIAN_THRACIAN_SITES = THRACIAN_SITES.filter((site) => !new Set([
  "punic-thrace-triballi", "punic-thrace-getae", "punic-thrace-tyrizagetae", "punic-thrace-daci",
  "punic-thrace-carpi", "punic-thrace-costoboci", "punic-thrace-buri", "punic-thrace-scordisci",
]).has(site.id));

const BELGIC_SITES: readonly HistoricalSite[] = [
  { id: "punic-belgica-morini", name: "Morini", coordinate: [2.20, 50.80] },
  { id: "punic-belgica-menapii", name: "Menapii", coordinate: [3.20, 51.00] },
  { id: "punic-belgica-nervii", name: "Nervii", coordinate: [4.40, 50.40] },
  { id: "punic-belgica-aduatuci", name: "Aduatuci", coordinate: [5.10, 50.90] },
  { id: "punic-belgica-eburones", name: "Eburones", coordinate: [5.50, 50.70] },
];

const LOW_COUNTRIES_SITES: readonly HistoricalSite[] = [
  { id: "punic-low-countries-frisiavones", name: "Frisiavones", coordinate: [4.40, 51.60] },
  { id: "punic-low-countries-cananefates", name: "Cananefates", coordinate: [4.50, 52.10] },
  { id: "punic-low-countries-batavi", name: "Batavi", coordinate: [5.80, 51.90] },
  { id: "punic-low-countries-chamavi", name: "Chamavi", coordinate: [6.40, 52.30] },
  { id: "punic-low-countries-tubantes", name: "Tubantes", coordinate: [6.60, 52.30] },
  { id: "punic-low-countries-frisii", name: "Frisii", coordinate: [5.50, 53.20] },
];

// These labels identify Iron Age communities in the territory of today's
// Hungary and Czechia/Slovakia; they do not project modern national identities
// into the 270 BCE setting. Their boundaries are broad reconstructions.
const HUNGARIAN_SITES: readonly HistoricalSite[] = [
  { id: "punic-hungary-boii-western-pannonia", name: "Boii of western Pannonia", coordinate: [17.20, 47.65] },
  { id: "punic-hungary-pannonii", name: "Pannonii", coordinate: [18.25, 46.55] },
  { id: "punic-hungary-scordisci", name: "Scordisci", coordinate: [19.10, 46.15] },
  { id: "punic-hungary-carpathian-communities", name: "Carpathian communities", coordinate: [19.65, 47.50] },
  { id: "punic-hungary-upper-tisza-communities", name: "Upper Tisza communities", coordinate: [21.20, 47.85] },
];

const CZECHOSLOVAK_SITES: readonly HistoricalSite[] = [
  { id: "punic-czechoslovakia-boii-bohemia", name: "Boii of Bohemia", coordinate: [14.45, 50.05] },
  { id: "punic-czechoslovakia-boii-moravia", name: "Boii of Moravia", coordinate: [16.85, 49.20] },
  { id: "punic-czechoslovakia-boii-slovakia", name: "Boii of western Slovakia", coordinate: [17.45, 48.55] },
  { id: "punic-czechoslovakia-cotini", name: "Cotini", coordinate: [19.15, 48.95] },
  { id: "punic-czechoslovakia-eastern-carpathian-communities", name: "Eastern Carpathian communities", coordinate: [21.05, 48.75] },
];

const LUXEMBOURG_SITES: readonly HistoricalSite[] = [
  { id: "punic-luxembourg-treveri", name: "Treveri", coordinate: [6.10, 49.75] },
];

const IBERIAN_SITES: readonly HistoricalSite[] = [
  { id: "punic-iberia-gallaeci", name: "Gallaeci", coordinate: [-8.41, 42.88] },
  { id: "punic-iberia-astures", name: "Astures", coordinate: [-5.85, 43.36] },
  { id: "punic-iberia-cantabri", name: "Cantabri", coordinate: [-4.08, 43.29] },
  { id: "punic-iberia-varduli", name: "Varduli and Autrigones", coordinate: [-2.69, 42.85] },
  { id: "punic-iberia-vascones", name: "Vascones", coordinate: [-1.64, 42.82] },
  { id: "punic-iberia-vaccei", name: "Vaccei", coordinate: [-4.72, 41.65], territorialWeight: 0.07 },
  { id: "punic-iberia-vettones", name: "Vettones", coordinate: [-5.75, 40.46], territorialWeight: 0.11 },
  { id: "punic-iberia-lusitani", name: "Lusitani", coordinate: [-7.35, 39.82], territorialWeight: 0.15 },
  { id: "punic-iberia-carpetani", name: "Carpetani", coordinate: [-3.70, 40.42], territorialWeight: -0.05 },
  { id: "punic-iberia-celtiberi", name: "Celtiberi", coordinate: [-2.22, 41.21], territorialWeight: 0.16 },
  { id: "punic-iberia-oretani", name: "Oretani", coordinate: [-3.42, 38.98], territorialWeight: 0.04 },
  { id: "punic-iberia-turdetani", name: "Turdetani", coordinate: [-5.99, 37.39], territorialWeight: -0.08 },
  { id: "punic-iberia-turduli", name: "Turduli", coordinate: [-6.18, 38.88], territorialWeight: 0.09 },
  { id: "punic-iberia-celtici", name: "Celtici", coordinate: [-6.80, 37.68], territorialWeight: 0.08 },
  { id: "punic-iberia-conii", name: "Conii", coordinate: [-7.96, 37.02] },
  { id: "punic-iberia-bastetani", name: "Bastetani", coordinate: [-2.77, 37.39], territorialWeight: 0.06 },
  { id: "punic-iberia-contestani", name: "Contestani", coordinate: [-0.70, 38.35], territorialWeight: 0.1 },
  { id: "punic-iberia-edetani", name: "Edetani", coordinate: [-0.38, 39.47], territorialWeight: 0.09 },
  { id: "punic-iberia-ilergetes", name: "Ilergetes", coordinate: [0.62, 41.62] },
  { id: "punic-iberia-lacetani", name: "Lacetani", coordinate: [1.83, 41.58] },
];

const ENGLAND_SITES: readonly HistoricalSite[] = [
  { id: "punic-britain-cornish", name: "South-western Britons", coordinate: [-4.53, 50.42] },
  { id: "punic-britain-dorset", name: "Southern Chalkland Britons", coordinate: [-2.44, 50.72] },
  { id: "punic-britain-thames", name: "Thames Basin Britons", coordinate: [-0.13, 51.51] },
  { id: "punic-britain-kentish", name: "Channel Britons", coordinate: [0.52, 51.28] },
  { id: "punic-britain-fenland", name: "Fenland Britons", coordinate: [0.18, 52.64] },
  { id: "punic-britain-east-anglian", name: "East Anglian Britons", coordinate: [1.30, 52.63] },
  { id: "punic-britain-midlands", name: "Midland Britons", coordinate: [-1.54, 52.64] },
  { id: "punic-britain-marches", name: "Marchland Britons", coordinate: [-2.71, 52.35] },
  { id: "punic-britain-humber", name: "Humber Britons", coordinate: [-0.54, 53.75] },
  { id: "punic-britain-pennine", name: "Pennine Britons", coordinate: [-1.78, 54.16] },
  { id: "punic-britain-cumbrian", name: "Cumbrian Britons", coordinate: [-3.05, 54.89] },
  { id: "punic-britain-northumbrian", name: "Northern English Britons", coordinate: [-1.62, 55.05] },
];

const SCOTLAND_SITES: readonly HistoricalSite[] = [
  { id: "punic-britain-southern-uplands", name: "Southern Upland Britons", coordinate: [-3.55, 55.55] },
  { id: "punic-britain-forth-clyde", name: "Forth-Clyde Communities", coordinate: [-4.25, 55.95] },
  { id: "punic-britain-east-lowlands", name: "Eastern Lowland Communities", coordinate: [-3.18, 56.20] },
  { id: "punic-britain-grampian", name: "Grampian Communities", coordinate: [-4.60, 56.82] },
  { id: "punic-britain-northeast", name: "North-eastern Communities", coordinate: [-2.10, 57.25] },
  { id: "punic-britain-hebridean", name: "Hebridean Communities", coordinate: [-6.05, 57.50] },
  { id: "punic-britain-highland", name: "Northern Highland Communities", coordinate: [-4.85, 58.40] },
  { id: "punic-britain-northern-isles", name: "Northern Isles Communities", coordinate: [-3.00, 59.00] },
];

const WALES_SITES: readonly HistoricalSite[] = [
  { id: "punic-britain-welsh-northwest", name: "North-western Britons", coordinate: [-4.15, 53.15] },
  { id: "punic-britain-welsh-northeast", name: "North-eastern Welsh Britons", coordinate: [-3.08, 53.10] },
  { id: "punic-britain-welsh-midlands", name: "Central Upland Britons", coordinate: [-3.70, 52.35] },
  { id: "punic-britain-welsh-southwest", name: "South-western Welsh Britons", coordinate: [-4.25, 51.78] },
  { id: "punic-britain-welsh-southeast", name: "South-eastern Welsh Britons", coordinate: [-3.05, 51.67] },
  { id: "punic-britain-welsh-marches", name: "Welsh March Communities", coordinate: [-2.80, 52.05] },
];

const base = europeNorthAfricaGeoJson;

function localId(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const LOCAL_LANDSCAPE_NAMES: Readonly<Record<string, string>> = {
  "Bouches-du-Rhône": "Rhodanus Delta", "Saône-et-Loire": "Arar Heights", "Puy-de-Dôme": "Arvernian Cones",
  Moselle: "Mosella Valley", "Bas-Rhin": "Lower Rhenus Terrace", "Haut-Rhin": "Upper Rhenus Terrace", Vosges: "Vosges Passes", Paris: "Lutetian Island",
  Piemonte: "Upper Padus and Alpine Gate", Lombardia: "Insubrian Plain", "Valle d'Aosta": "Alpine Passes", "Trentino-Alto Adige": "Adige Passes",
  Veneto: "Venetian Lagoon", "Friuli Venezia Giulia": "Isonzo Gate", Liguria: "Ligurian Coast", "Emilia-Romagna": "Middle Padus",
  Toscana: "Etrurian Uplands", Umbria: "Umbrian Valleys", Marche: "Picenum Coast", Lazio: "Latium", Abruzzo: "Marsian Highlands",
  Molise: "Samnium", Campania: "Campanian Plain", Puglia: "Apulian Coast", Basilicata: "Lucanian Uplands", Calabria: "Bruttian Highlands",
};

function localLandscapeName(name: string): string {
  return LOCAL_LANDSCAPE_NAMES[name] ?? name;
}

const ITALY_GROUNDED_TERRITORIES: readonly GroundedTerritory[] = base.features
  .filter((feature) => feature.id.startsWith("ita-local-") && feature.properties.kind === "province")
  .map((feature) => {
    const name = feature.properties.name ?? feature.id;
    return { sourceId: feature.id, id: `punic-italy-${localId(localLandscapeName(name))}`, name: localLandscapeName(name) };
  });

// present in the map source.  The names are local landscape/corridor names,
// rather than modern administrative identities or single-label tribal cells.
const GAUL_GROUNDED_TERRITORIES: readonly GroundedTerritory[] = base.features
  .filter((feature) => feature.id.startsWith("fra-local-") && feature.properties.kind === "province")
  .map((feature) => {
    const name = feature.properties.name ?? feature.id;
    return { sourceId: feature.id, id: `punic-gaul-${localId(name)}`, name: localLandscapeName(name) };
  });

const IBERIA_GROUNDED_TERRITORIES: readonly GroundedTerritory[] = base.features
  .filter((feature) => feature.id.startsWith("esp-") && feature.properties.kind === "province")
  .map((feature) => {
    const name = feature.properties.name ?? feature.id;
    return { sourceId: feature.id, id: `punic-iberia-${localId(name)}`, name: localLandscapeName(name) };
  });

const ROMANIA_GROUNDED_TERRITORIES: readonly GroundedTerritory[] = base.features
  .filter((feature) => feature.id.startsWith("rou-") && feature.properties.kind === "province")
  .map((feature) => {
    const name = feature.properties.name ?? feature.id;
    return { sourceId: feature.id, id: `punic-thrace-${localId(name)}`, name: localLandscapeName(name) };
  });

const GERMANIA_GROUNDED_TERRITORIES: readonly GroundedTerritory[] = [
  { sourceId: "deu-9070358b86745718691241", id: "punic-germania-neckar-uplands", name: "Neckar Uplands" },
  { sourceId: "deu-9070358b19876986675637", id: "punic-germania-upper-rhine", name: "Upper Rhenus Terrace" },
  { sourceId: "deu-9070358b61051204169762", id: "punic-germania-black-forest", name: "Black Forest Gate" },
  { sourceId: "deu-9070358b15022388296844", id: "punic-germania-swabian-jura", name: "Swabian Jura" },
  { sourceId: "deu-9070358b1315543690610", id: "punic-germania-upper-isar", name: "Upper Isar Country" },
  { sourceId: "deu-9070358b22007842747726", id: "punic-germania-boii", name: "Boii of the Danube" },
  { sourceId: "deu-9070358b44987229854715", id: "punic-germania-naab", name: "Naab Uplands" },
  { sourceId: "deu-9070358b72727683862663", id: "punic-germania-franconian-forest", name: "Franconian Forest" },
  { sourceId: "deu-9070358b15061347548929", id: "punic-germania-middle-main", name: "Middle Moenus" },
  { sourceId: "deu-9070358b89448690772082", id: "punic-germania-lower-main", name: "Lower Moenus" },
  { sourceId: "deu-9070358b65596861168427", id: "punic-germania-vindelici", name: "Vindelician Lech" },
  { sourceId: "deu-9070358b20892132820961", id: "punic-germania-spree-havel", name: "Spree–Havel Confluence" },
  { sourceId: "deu-9070358b40185768535592", id: "punic-germania-semnones", name: "Semnonian March" },
  { sourceId: "deu-9070358b44391416804171", id: "punic-germania-weser-mouth", name: "Visurgis Mouth" },
  { sourceId: "deu-9070358b45896528657515", id: "punic-germania-elbe-mouth", name: "Albis Mouth" },
  { sourceId: "deu-9070358b42560167255242", id: "punic-germania-main-rhine", name: "Moenus–Rhenus Gate" },
  { sourceId: "deu-9070358b56635429978008", id: "punic-germania-chatti", name: "Chattian Lahn" },
  { sourceId: "deu-9070358b5760978041875", id: "punic-germania-upper-weser", name: "Upper Visurgis" },
  { sourceId: "deu-9070358b60782008682549", id: "punic-germania-baltic-lagoons", name: "Baltic Lagoons" },
  { sourceId: "deu-9070358b23702346475723", id: "punic-germania-harz-foreland", name: "Harz Foreland" },
  { sourceId: "deu-9070358b94432643063062", id: "punic-germania-cherusci", name: "Cheruscan Leine" },
  { sourceId: "deu-9070358b4064771181754", id: "punic-germania-elbe-heath", name: "Albis Heath" },
  { sourceId: "deu-9070358b2639969244614", id: "punic-germania-chauci", name: "Chaucian Coastal Plain" },
  { sourceId: "deu-9070358b16138204042833", id: "punic-germania-ubii", name: "Ubian Lower Rhenus" },
  { sourceId: "deu-9070358b57109950257038", id: "punic-germania-rhine-gorge", name: "Rhenus Gorge" },
  { sourceId: "deu-9070358b93499833428165", id: "punic-germania-bructeri", name: "Bructerian Plain" },
  { sourceId: "deu-9070358b64982818747725", id: "punic-germania-teutoburg", name: "Teutoburg Ridge" },
  { sourceId: "deu-9070358b40774776719210", id: "punic-germania-sauerland", name: "Sauerland Heights" },
  { sourceId: "deu-9070358b14573642950642", id: "punic-germania-moselle-rhine", name: "Mosella–Rhenus Confluence" },
  { sourceId: "deu-9070358b88105018400154", id: "punic-germania-treveri", name: "Treveran Mosella" },
  { sourceId: "deu-9070358b81909410124776", id: "punic-germania-upper-rhine-bend", name: "Upper Rhenus Bend" },
  { sourceId: "deu-9070358b83775792336645", id: "punic-germania-saar", name: "Saar Coal Hills" },
  { sourceId: "deu-9070358b71091673137763", id: "punic-germania-elbe-valley", name: "Upper Albis Valley" },
  { sourceId: "deu-9070358b71894413182695", id: "punic-germania-erzgebirge", name: "Ore Mountain Passes" },
  { sourceId: "deu-9070358b77675294704498", id: "punic-germania-pleisse", name: "Pleiße Lowland" },
  { sourceId: "deu-9070358b23625801106445", id: "punic-germania-middle-elbe", name: "Middle Albis" },
  { sourceId: "deu-9070358b46069870964378", id: "punic-germania-cimbri", name: "Cimbrian Jutland Approaches" },
  { sourceId: "deu-9070358b67217417145666", id: "punic-germania-hermunduri", name: "Hermundurian Basin" },
];

// Keep the whole former-Yugoslav theatre together in the active map so the
// Adriatic and Morava–Vardar corridors read as one uneven frontier system.
const illyriaSourceIds = new Set(["alb-", "bih-", "hrv-", "mkd-", "mne-", "srb-", "svn-", "xkx-"].flatMap((prefix) => [...provinceIds(base, prefix)]));
const thraceSourceIds = provinceIds(base, "bgr-");
const belgiumSourceIds = provinceIds(base, "bel-");
const netherlandsSourceIds = provinceIds(base, "nld-");
const hungarySourceIds = provinceIds(base, "hun-");
const czechoslovakiaSourceIds = new Set(["cze-", "svk-"].flatMap((prefix) => [...provinceIds(base, prefix)]));
const luxembourgSourceIds = provinceIds(base, "lux-");

const withItaly = replaceWithGroundedTerritories(base, ITALY_GROUNDED_TERRITORIES);
const withGaul = replaceWithGroundedTerritories(withItaly, GAUL_GROUNDED_TERRITORIES);
const withIberia = replaceWithGroundedTerritories(withGaul, IBERIA_GROUNDED_TERRITORIES);
const withIllyria = replaceProvinceGroup(withIberia, illyriaSourceIds, ILLYRIAN_SITES, 1.18, "carthaginian");
const withThrace = replaceProvinceGroup(withIllyria, thraceSourceIds, BULGARIAN_THRACIAN_SITES);
const withRomania = replaceWithGroundedTerritories(withThrace, ROMANIA_GROUNDED_TERRITORIES);
const withBelgica = replaceProvinceGroup(withRomania, belgiumSourceIds, BELGIC_SITES);
const withLowCountries = replaceProvinceGroup(withBelgica, netherlandsSourceIds, LOW_COUNTRIES_SITES);
const withGermania = replaceWithGroundedTerritories(withLowCountries, GERMANIA_GROUNDED_TERRITORIES);
const withHungary = replaceProvinceGroup(withGermania, hungarySourceIds, HUNGARIAN_SITES, 1.1, "carthaginian");
const withCzechoslovakia = replaceProvinceGroup(withHungary, czechoslovakiaSourceIds, CZECHOSLOVAK_SITES);
const withLuxembourg = replaceProvinceGroup(withCzechoslovakia, luxembourgSourceIds, LUXEMBOURG_SITES);
const withEngland = replaceProvinceGroup(withLuxembourg, new Set(["gbr-14339913b95766344400054"]), ENGLAND_SITES);
const withScotland = replaceProvinceGroup(withEngland, new Set(["gbr-14339913b23556801435424"]), SCOTLAND_SITES);
const withWales = replaceProvinceGroup(withScotland, new Set(["gbr-14339913b89763821047858"]), WALES_SITES);

const SETTLEMENT_PROVINCES: Readonly<Record<string, string>> = {
  "settlement-rome": "punic-italy-latium",
  "settlement-naples": "punic-italy-campanian-plain",
  "settlement-caralis": "ita-72843720b81376294924159",
  "settlement-syracuse": "ita-72843720b81376294924159-sicily-southeast",
  "settlement-agrigentum-fort": "ita-72843720b81376294924159-sicily-central",
};

type HistoricalSettlement = Readonly<{
  id: string;
  name: string;
  provinceId: string;
  type: "capital" | "city" | "town" | "fort" | "port";
  coordinate: Point;
}>;

/** Major political and military anchors for the 270 BCE political map. */
const PUNIC_WARS_SETTLEMENTS: readonly HistoricalSettlement[] = [
  { id: "settlement-carthage", name: "Carthage", provinceId: "tun-13205935b88806172084765", type: "capital", coordinate: [10.33, 36.85] },
  { id: "settlement-utica", name: "Utica", provinceId: "tun-13205935b29646166511918", type: "city", coordinate: [10.57, 37.06] },
  { id: "settlement-hippo-diarrhytus", name: "Hippo Diarrhytus", provinceId: "tun-13205935b29646166511918", type: "port", coordinate: [9.88, 37.27] },
  { id: "settlement-hadrumetum", name: "Hadrumetum", provinceId: "tun-13205935b49970022939178", type: "port", coordinate: [10.64, 35.83] },
  { id: "settlement-leptis-minor", name: "Leptis Minor", provinceId: "tun-13205935b953488337212", type: "city", coordinate: [10.75, 35.67] },
  { id: "settlement-thapsus", name: "Thapsus", provinceId: "tun-13205935b953488337212", type: "port", coordinate: [11.05, 35.40] },
  { id: "settlement-cirta", name: "Cirta", provinceId: "dza-43142294b54486011126442", type: "capital", coordinate: [6.62, 36.36] },
  { id: "settlement-hippo-regius", name: "Hippo Regius", provinceId: "dza-43142294b62233719624556", type: "port", coordinate: [7.76, 36.90] },
  { id: "settlement-iol", name: "Iol", provinceId: "dza-43142294b44506325294932", type: "port", coordinate: [2.88, 36.58] },
  { id: "settlement-tingis", name: "Tingis", provinceId: "mar-70788906b66040098455254", type: "port", coordinate: [-5.83, 35.76] },
  { id: "settlement-volubilis", name: "Volubilis", provinceId: "mar-70788906b83815134303720", type: "capital", coordinate: [-5.55, 34.07] },
  { id: "settlement-garama", name: "Garama", provinceId: "lby-10800210b2800497533490", type: "capital", coordinate: [13.02, 26.52] },
  { id: "settlement-cyrene", name: "Cyrene", provinceId: "lby-10800210b23470577588067", type: "capital", coordinate: [21.86, 32.82] },
  { id: "settlement-apollonia-cyrene", name: "Apollonia", provinceId: "lby-10800210b23470577588067", type: "port", coordinate: [21.75, 32.95] },
  { id: "settlement-messana", name: "Messana", provinceId: "ita-72843720b81376294924159-sicily-northeast", type: "capital", coordinate: [15.55, 38.19] },
  { id: "settlement-lilybaeum", name: "Lilybaeum", provinceId: "ita-72843720b81376294924159-sicily-west", type: "port", coordinate: [12.95, 37.80] },
  { id: "settlement-genua", name: "Genua", provinceId: "punic-italy-ligurian-coast", type: "port", coordinate: [8.95, 44.41] },
  { id: "settlement-mediolanum", name: "Mediolanum", provinceId: "punic-italy-insubrian-plain", type: "city", coordinate: [9.19, 45.46] },
  { id: "settlement-bononia", name: "Felsina", provinceId: "punic-italy-middle-padus", type: "town", coordinate: [11.34, 44.50] },
  { id: "settlement-patavium", name: "Patavium", provinceId: "punic-italy-venetian-lagoon", type: "city", coordinate: [11.88, 45.41] },
  { id: "settlement-volsinii", name: "Volsinii", provinceId: "punic-italy-etrurian-uplands", type: "fort", coordinate: [11.88, 42.42] },
  { id: "settlement-capua", name: "Capua", provinceId: "punic-italy-campanian-plain", type: "city", coordinate: [14.17, 41.03] },
  { id: "settlement-bovianum", name: "Bovianum", provinceId: "punic-italy-samnium", type: "fort", coordinate: [14.48, 41.56] },
  { id: "settlement-tarentum", name: "Tarentum", provinceId: "punic-italy-apulian-coast", type: "port", coordinate: [17.23, 40.47] },
  { id: "settlement-massalia", name: "Massalia", provinceId: "punic-gaul-bouches-du-rhone", type: "port", coordinate: [5.37, 43.30] },
  { id: "settlement-bibracte", name: "Bibracte", provinceId: "punic-gaul-saone-et-loire", type: "fort", coordinate: [4.03, 46.92] },
  { id: "settlement-gergovia", name: "Gergovia", provinceId: "punic-gaul-puy-de-dome", type: "fort", coordinate: [3.13, 45.72] },
  { id: "settlement-gades", name: "Gades", provinceId: "punic-iberia-andalucia", type: "port", coordinate: [-6.29, 36.53] },
  { id: "settlement-numantia", name: "Numantia", provinceId: "punic-iberia-castilla-y-leon", type: "fort", coordinate: [-2.44, 41.81] },
  { id: "settlement-carthago-nova", name: "Carthago Nova", provinceId: "punic-iberia-region-de-murcia", type: "port", coordinate: [-0.98, 37.60] },
  { id: "settlement-maiden-castle", name: "Maiden Castle", provinceId: "punic-britain-dorset", type: "fort", coordinate: [-2.49, 50.70] },
  { id: "settlement-danebury", name: "Danebury", provinceId: "punic-britain-thames", type: "fort", coordinate: [-1.49, 51.18] },
  { id: "settlement-traprain-law", name: "Traprain Law", provinceId: "punic-britain-east-lowlands", type: "fort", coordinate: [-2.65, 55.93] },
  { id: "settlement-pella", name: "Pella", provinceId: "grc-93993887b93147517098288", type: "capital", coordinate: [22.52, 40.76] },
  { id: "settlement-athens", name: "Athens", provinceId: "grc-93993887b88980272284763", type: "capital", coordinate: [23.73, 37.98] },
];

export const punicWarsGeoJson: GeoJsonMap = {
  ...withWales,
  features: [
    ...withWales.features.map((feature) => feature.properties.kind !== "settlement" || SETTLEMENT_PROVINCES[feature.id] === undefined
      ? feature
      : { ...feature, properties: { ...feature.properties, provinceId: SETTLEMENT_PROVINCES[feature.id]!, ...(feature.id === "settlement-syracuse" ? { type: "capital" as const } : {}) } }),
    ...PUNIC_WARS_SETTLEMENTS.map((settlement) => ({
      type: "Feature" as const,
      id: settlement.id,
      geometry: { type: "Point" as const, coordinates: [...settlement.coordinate] as [number, number] },
      properties: { kind: "settlement" as const, name: settlement.name, provinceId: settlement.provinceId, type: settlement.type },
    })),
  ],
};

export const PUNIC_WARS_REGION_COUNTS = {
  italy: ITALY_GROUNDED_TERRITORIES.length,
  gaul: GAUL_GROUNDED_TERRITORIES.length,
  iberia: IBERIA_GROUNDED_TERRITORIES.length,
  illyria: ILLYRIAN_SITES.length,
  thrace: BULGARIAN_THRACIAN_SITES.length + ROMANIA_GROUNDED_TERRITORIES.length,
  belgica: BELGIC_SITES.length,
  lowCountries: LOW_COUNTRIES_SITES.length,
  germania: GERMANIA_GROUNDED_TERRITORIES.length,
  hungary: HUNGARIAN_SITES.length,
  czechoslovakia: CZECHOSLOVAK_SITES.length,
  luxembourg: LUXEMBOURG_SITES.length,
  england: ENGLAND_SITES.length,
  scotland: SCOTLAND_SITES.length,
  wales: WALES_SITES.length,
} as const;
