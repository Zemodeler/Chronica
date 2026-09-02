import "server-only";

import type { GeoJsonMap, GeoJsonMapFeature } from "@chronica/shared";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";

type Point = readonly [number, number];
type Ring = readonly Point[];
type Polygon = readonly Ring[];
type HistoricalSite = Readonly<{ id: string; name: string; coordinate: Point }>;

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
function organicEdge(first: Point, second: Point): [number, number][] {
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
  const amplitude = Math.min(0.16, length * (0.065 + (seed % 35) / 1_000));
  const direction = seed % 2 === 0 ? 1 : -1;
  const bent = [0.22, 0.48, 0.76].map((position, index) => {
    const wave = direction * amplitude * (index === 1 ? -0.7 : 1) * (0.8 + ((seed >>> (index * 5)) % 20) / 100);
    return roundedPoint([start[0] + dx * position + normal[0] * wave, start[1] + dy * position + normal[1] * wave]);
  });
  const result = [start, ...bent, end];
  return forward ? result : [...result].reverse();
}

/**
 * Replaces only borders shared by generated regions.  Each repeated edge uses
 * the same seeded polyline in reverse, so the map gains natural irregularity
 * without creating gaps or overlaps between neighbours.
 */
function organicizeInternalBorders(features: readonly GeoJsonMapFeature[]): GeoJsonMapFeature[] {
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
            const points = (edgeCounts.get(edgeKey(first, second)) ?? 0) > 1 ? organicEdge(first, second) : [roundedPoint(first), roundedPoint(second)];
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
function historicalRegions(source: readonly GeoJsonMapFeature[], sites: readonly HistoricalSite[]): GeoJsonMapFeature[] {
  const polygons = source.flatMap(polygonsFor);
  const regions: GeoJsonMapFeature[] = sites.map((site): GeoJsonMapFeature => {
    const coordinates = polygons.flatMap((polygon) => {
      let ring = polygon[0]?.map((point) => [point[0], point[1]] as [number, number]) ?? [];
      for (const other of sites) {
        if (other.id === site.id || ring.length === 0) continue;
        const [sx, sy] = site.coordinate;
        const [ox, oy] = other.coordinate;
        ring = clipRingToHalfPlane(ring, ([x, y]) => (x - sx) ** 2 + (y - sy) ** 2 - ((x - ox) ** 2 + (y - oy) ** 2));
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
  return organicizeInternalBorders(regions);
}

function replaceProvinceGroup(map: GeoJsonMap, sourceIds: ReadonlySet<string>, sites: readonly HistoricalSite[]): GeoJsonMap {
  const source = map.features.filter((feature) => sourceIds.has(feature.id));
  if (source.length !== sourceIds.size) throw new Error("A requested historical source province is missing from the base GeoJSON.");
  const replacement = historicalRegions(source, sites);
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

const GALLIC_SITES: readonly HistoricalSite[] = [
  { id: "punic-gaul-aquitani", name: "Aquitani", coordinate: [-0.65, 43.45] },
  { id: "punic-gaul-santones", name: "Santones", coordinate: [-0.95, 45.74] },
  { id: "punic-gaul-pictones", name: "Pictones", coordinate: [0.34, 46.58] },
  { id: "punic-gaul-armoricans", name: "Armorican peoples", coordinate: [-3.05, 48.21] },
  { id: "punic-gaul-veneti", name: "Veneti of Gaul", coordinate: [-2.76, 47.66] },
  { id: "punic-gaul-andecavi", name: "Andecavi", coordinate: [-0.56, 47.47] },
  { id: "punic-gaul-aulerci-eburovices", name: "Aulerci Eburovices", coordinate: [0.66, 49.09] },
  { id: "punic-gaul-aulerci-cenomani", name: "Aulerci Cenomani", coordinate: [0.20, 48.01] },
  { id: "punic-gaul-aulerci-diablintes", name: "Aulerci Diablintes", coordinate: [-0.75, 48.17] },
  { id: "punic-gaul-parisii", name: "Parisii", coordinate: [2.35, 48.86] },
  { id: "punic-gaul-senones", name: "Senones", coordinate: [3.28, 48.20] },
  { id: "punic-gaul-remi", name: "Remi", coordinate: [4.03, 49.26] },
  { id: "punic-gaul-bellovaci", name: "Bellovaci", coordinate: [2.08, 49.43] },
  { id: "punic-gaul-atrebates", name: "Atrebates", coordinate: [2.78, 50.29] },
  { id: "punic-gaul-biturgies", name: "Bituriges", coordinate: [2.40, 47.08] },
  { id: "punic-gaul-arverni", name: "Arverni", coordinate: [3.09, 45.78] },
  { id: "punic-gaul-aedui", name: "Aedui", coordinate: [4.30, 46.95] },
  { id: "punic-gaul-sequani", name: "Sequani", coordinate: [6.02, 47.24] },
  { id: "punic-gaul-allobroges", name: "Allobroges", coordinate: [5.72, 45.19] },
  { id: "punic-gaul-vocontii", name: "Vocontii", coordinate: [5.10, 44.30] },
  { id: "punic-gaul-salyes", name: "Salyes", coordinate: [5.45, 43.53] },
  { id: "punic-gaul-volcae", name: "Volcae", coordinate: [3.88, 43.61] },
  { id: "punic-gaul-ruteni", name: "Ruteni", coordinate: [2.57, 44.35] },
  { id: "punic-gaul-cadurci", name: "Cadurci", coordinate: [1.44, 44.45] },
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

const GERMANIC_SITES: readonly HistoricalSite[] = [
  { id: "punic-germania-cimbri", name: "Cimbri", coordinate: [9.80, 54.80] },
  { id: "punic-germania-teutones", name: "Teutones", coordinate: [10.10, 54.00] },
  { id: "punic-germania-chauci", name: "Chauci", coordinate: [8.50, 53.20] },
  { id: "punic-germania-bructeri", name: "Bructeri", coordinate: [7.50, 52.00] },
  { id: "punic-germania-cherusci", name: "Cherusci", coordinate: [10.50, 52.00] },
  { id: "punic-germania-langobardi", name: "Langobardi", coordinate: [11.60, 52.70] },
  { id: "punic-germania-semnones", name: "Semnones", coordinate: [13.00, 52.50] },
  { id: "punic-germania-chatti", name: "Chatti", coordinate: [9.10, 50.80] },
  { id: "punic-germania-hermunduri", name: "Hermunduri", coordinate: [11.50, 50.80] },
  { id: "punic-germania-suebi", name: "Suebi", coordinate: [10.50, 49.80] },
  { id: "punic-germania-ubii", name: "Ubii", coordinate: [6.80, 50.90] },
  { id: "punic-germania-treveri", name: "Treveri", coordinate: [6.50, 49.70] },
  { id: "punic-germania-vindelici", name: "Vindelici", coordinate: [10.80, 48.40] },
  { id: "punic-germania-boii", name: "Boii of the Danube", coordinate: [12.00, 48.80] },
];

const IBERIAN_SITES: readonly HistoricalSite[] = [
  { id: "punic-iberia-gallaeci", name: "Gallaeci", coordinate: [-8.41, 42.88] },
  { id: "punic-iberia-astures", name: "Astures", coordinate: [-5.85, 43.36] },
  { id: "punic-iberia-cantabri", name: "Cantabri", coordinate: [-4.08, 43.29] },
  { id: "punic-iberia-varduli", name: "Varduli and Autrigones", coordinate: [-2.69, 42.85] },
  { id: "punic-iberia-vascones", name: "Vascones", coordinate: [-1.64, 42.82] },
  { id: "punic-iberia-vaccei", name: "Vaccei", coordinate: [-4.72, 41.65] },
  { id: "punic-iberia-vettones", name: "Vettones", coordinate: [-5.75, 40.46] },
  { id: "punic-iberia-lusitani", name: "Lusitani", coordinate: [-7.35, 39.82] },
  { id: "punic-iberia-carpetani", name: "Carpetani", coordinate: [-3.70, 40.42] },
  { id: "punic-iberia-celtiberi", name: "Celtiberi", coordinate: [-2.22, 41.21] },
  { id: "punic-iberia-oretani", name: "Oretani", coordinate: [-3.42, 38.98] },
  { id: "punic-iberia-turdetani", name: "Turdetani", coordinate: [-5.99, 37.39] },
  { id: "punic-iberia-turduli", name: "Turduli", coordinate: [-6.18, 38.88] },
  { id: "punic-iberia-celtici", name: "Celtici", coordinate: [-6.80, 37.68] },
  { id: "punic-iberia-conii", name: "Conii", coordinate: [-7.96, 37.02] },
  { id: "punic-iberia-bastetani", name: "Bastetani", coordinate: [-2.77, 37.39] },
  { id: "punic-iberia-contestani", name: "Contestani", coordinate: [-0.70, 38.35] },
  { id: "punic-iberia-edetani", name: "Edetani", coordinate: [-0.38, 39.47] },
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
const italianExcludedIds = new Set(["ita-72843720b81376294924159", ...base.features.filter((feature) => feature.id.startsWith("ita-72843720b81376294924159-sicily-")).map((feature) => feature.id)]);
const italySourceIds = new Set([...provinceIds(base, "ita-")].filter((id) => !italianExcludedIds.has(id)));
const franceSourceIds = provinceIds(base, "fra-", ["fra-19338628b22604203385446"]);
const spainSourceIds = provinceIds(base, "esp-", ["esp-25490228b84620027724461", "esp-25490228b18225280299410", "esp-25490228b48808997991554", "esp-25490228b26609846683583"]);
const illyriaSourceIds = new Set(["alb-", "mne-", "hrv-", "bih-", "svn-", "xkx-"].flatMap((prefix) => [...provinceIds(base, prefix)]));
const thraceSourceIds = new Set(["bgr-", "rou-", "srb-"].flatMap((prefix) => [...provinceIds(base, prefix)]));
const belgiumSourceIds = provinceIds(base, "bel-");
const netherlandsSourceIds = provinceIds(base, "nld-");
const germaniaSourceIds = provinceIds(base, "deu-");

const withItaly = replaceProvinceGroup(base, italySourceIds, ITALIAN_SITES);
const withGaul = replaceProvinceGroup(withItaly, franceSourceIds, GALLIC_SITES);
const withIberia = replaceProvinceGroup(withGaul, spainSourceIds, IBERIAN_SITES);
const withIllyria = replaceProvinceGroup(withIberia, illyriaSourceIds, ILLYRIAN_SITES);
const withThrace = replaceProvinceGroup(withIllyria, thraceSourceIds, THRACIAN_SITES);
const withBelgica = replaceProvinceGroup(withThrace, belgiumSourceIds, BELGIC_SITES);
const withLowCountries = replaceProvinceGroup(withBelgica, netherlandsSourceIds, LOW_COUNTRIES_SITES);
const withGermania = replaceProvinceGroup(withLowCountries, germaniaSourceIds, GERMANIC_SITES);
const withEngland = replaceProvinceGroup(withGermania, new Set(["gbr-14339913b95766344400054"]), ENGLAND_SITES);
const withScotland = replaceProvinceGroup(withEngland, new Set(["gbr-14339913b23556801435424"]), SCOTLAND_SITES);
const withWales = replaceProvinceGroup(withScotland, new Set(["gbr-14339913b89763821047858"]), WALES_SITES);

const SETTLEMENT_PROVINCES: Readonly<Record<string, string>> = {
  "settlement-rome": "punic-italy-latium",
  "settlement-naples": "punic-italy-campania",
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
  { id: "settlement-genua", name: "Genua", provinceId: "punic-italy-liguria-genua", type: "port", coordinate: [8.95, 44.41] },
  { id: "settlement-mediolanum", name: "Mediolanum", provinceId: "punic-italy-insubria-mediolanum", type: "city", coordinate: [9.19, 45.46] },
  { id: "settlement-bononia", name: "Felsina", provinceId: "punic-italy-boii-felsina", type: "town", coordinate: [11.34, 44.50] },
  { id: "settlement-patavium", name: "Patavium", provinceId: "punic-italy-veneti-patavium", type: "city", coordinate: [11.88, 45.41] },
  { id: "settlement-volsinii", name: "Volsinii", provinceId: "punic-italy-etruria-central", type: "fort", coordinate: [11.88, 42.42] },
  { id: "settlement-capua", name: "Capua", provinceId: "punic-italy-campania", type: "city", coordinate: [14.17, 41.03] },
  { id: "settlement-bovianum", name: "Bovianum", provinceId: "punic-italy-samnium", type: "fort", coordinate: [14.48, 41.56] },
  { id: "settlement-tarentum", name: "Tarentum", provinceId: "punic-italy-tarentines", type: "port", coordinate: [17.23, 40.47] },
  { id: "settlement-rhegium", name: "Rhegium", provinceId: "punic-italy-rhegines", type: "port", coordinate: [15.65, 38.11] },
  { id: "settlement-massalia", name: "Massalia", provinceId: "punic-gaul-salyes", type: "port", coordinate: [5.37, 43.30] },
  { id: "settlement-bibracte", name: "Bibracte", provinceId: "punic-gaul-aedui", type: "fort", coordinate: [4.03, 46.92] },
  { id: "settlement-gergovia", name: "Gergovia", provinceId: "punic-gaul-arverni", type: "fort", coordinate: [3.13, 45.72] },
  { id: "settlement-gades", name: "Gades", provinceId: "punic-iberia-turdetani", type: "port", coordinate: [-6.29, 36.53] },
  { id: "settlement-numantia", name: "Numantia", provinceId: "punic-iberia-celtiberi", type: "fort", coordinate: [-2.44, 41.81] },
  { id: "settlement-carthago-nova", name: "Carthago Nova", provinceId: "punic-iberia-bastetani", type: "port", coordinate: [-0.98, 37.60] },
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
  italy: ITALIAN_SITES.length,
  gaul: GALLIC_SITES.length,
  iberia: IBERIAN_SITES.length,
  illyria: ILLYRIAN_SITES.length,
  thrace: THRACIAN_SITES.length,
  belgica: BELGIC_SITES.length,
  lowCountries: LOW_COUNTRIES_SITES.length,
  germania: GERMANIC_SITES.length,
  england: ENGLAND_SITES.length,
  scotland: SCOTLAND_SITES.length,
  wales: WALES_SITES.length,
} as const;
