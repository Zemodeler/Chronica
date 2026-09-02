import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeoJsonMap, GeoJsonMapFeature } from "@chronica/shared";
import { agrigentumFortDemoSettlement, caralisDemoSettlement, naplesDemoSettlement, romeDemoSettlement, syracuseDemoSettlement } from "./calibration-map-features";

/**
 * Europe and Northern Africa provincial boundaries from geoBoundaries gbOpen.
 * Germany uses 38 ADM2 government districts; the remaining 49 country layers
 * use ADM1 boundaries. The source file has 901 province features in WGS84.
 * Source metadata: https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/
 * Germany: https://www.geoboundaries.org/api/current/gbOpen/DEU/ADM2/
 */
const mapPath = join(process.cwd(), "public", "maps", "europe-north-africa-adm1.geojson");
const regionalMap = JSON.parse(readFileSync(mapPath, "utf8")) as GeoJsonMap;
const franceDepartmentsPath = join(process.cwd(), "public", "maps", "france-adm2-simplified.geojson");
const franceDepartments = JSON.parse(readFileSync(franceDepartmentsPath, "utf8")) as Readonly<{
  features: readonly Readonly<{ geometry: GeoJsonMapFeature["geometry"]; properties: Readonly<{ shapeID: string; shapeName: string }> }> [];
}>;
const italyRegionsPath = join(process.cwd(), "public", "maps", "italy-adm2-simplified.geojson");
const italyRegions = JSON.parse(readFileSync(italyRegionsPath, "utf8")) as Readonly<{
  features: readonly Readonly<{ geometry: GeoJsonMapFeature["geometry"]; properties: Readonly<{ shapeID: string; shapeName: string }> }> [];
}>;
const unitedKingdomDistrictsPath = join(process.cwd(), "public", "maps", "united-kingdom-adm2-simplified.geojson");
const unitedKingdomDistricts = JSON.parse(readFileSync(unitedKingdomDistrictsPath, "utf8")) as Readonly<{
  features: readonly Readonly<{ geometry: GeoJsonMapFeature["geometry"]; properties: Readonly<{ shapeID: string; shapeName: string }> }> [];
}>;
const greeceRegionsPath = join(process.cwd(), "public", "maps", "greece-adm2-simplified.geojson");
const greeceRegions = JSON.parse(readFileSync(greeceRegionsPath, "utf8")) as Readonly<{
  features: readonly Readonly<{ geometry: GeoJsonMapFeature["geometry"]; properties: Readonly<{ shapeID: string; shapeName: string }> }> [];
}>;

type LocalRegion = (typeof greeceRegions.features)[number];
type LocalRegionGroup = Readonly<{ id: string; name: string; members: readonly string[] }>;

const ITALIAN_ISLANDS_ID = "ita-72843720b81376294924159";

/**
 * France's ADM1 areas are too broad for the same local-territory scale used
 * in Germania.  Replace only that country layer with the matching simplified
 * 96-area source so its shared borders remain surveyed and exactly aligned.
 */
function replaceFranceWithLocalBoundaries(map: GeoJsonMap): GeoJsonMap {
  let inserted = false;
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (!feature.id.startsWith("fra-")) return [feature];
      if (inserted) return [];
      inserted = true;
      return franceDepartments.features.map((department) => ({
        type: "Feature" as const,
        id: `fra-local-${department.properties.shapeID}`,
        geometry: department.geometry,
        properties: { kind: "province" as const, name: department.properties.shapeName },
      }));
    }),
  };
}

/** Keep the purpose-built Sicily split, while replacing mainland Italy's four broad blocks with its local regional source. */
function replaceItalyWithLocalBoundaries(map: GeoJsonMap): GeoJsonMap {
  const islands = new Set(["Sardegna", "Sicilia"]);
  let inserted = false;
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (!feature.id.startsWith("ita-") || feature.id === ITALIAN_ISLANDS_ID) return [feature];
      if (inserted) return [];
      inserted = true;
      return italyRegions.features
        .filter((region) => !islands.has(region.properties.shapeName))
        .map((region) => ({
          type: "Feature" as const,
          id: `ita-local-${region.properties.shapeID}`,
          geometry: region.geometry,
          properties: { kind: "province" as const, name: region.properties.shapeName },
        }));
    }),
  };
}

/**
 * Substitute a broad country shell with surveyed local boundaries.  The local
 * outlines remain territory geometry only: historical ownership is assigned
 * independently by the Punic Wars opening overlay.
 */
function replaceWithLocalBoundaries(
  map: GeoJsonMap,
  sourcePrefix: string,
  localPrefix: string,
  localFeatures: readonly Readonly<{ geometry: GeoJsonMapFeature["geometry"]; properties: Readonly<{ shapeID: string; shapeName: string }> }>[],
): GeoJsonMap {
  let inserted = false;
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (!feature.id.startsWith(sourcePrefix)) return [feature];
      if (inserted) return [];
      inserted = true;
      return localFeatures.map((localFeature) => ({
        type: "Feature" as const,
        id: `${localPrefix}${localFeature.properties.shapeID}`,
        geometry: localFeature.geometry,
        properties: { kind: "province" as const, name: localFeature.properties.shapeName },
      }));
    }),
  };
}

/**
 * The source's dense city layers use individual municipalities.  Those
 * city-block-sized territories are too fine-grained beside Marathon and
 * Acharnes, so retain their surveyed outlines while presenting them as
 * playable metropolitan regions.
 */
const GREEK_METRO_REGION_GROUPS: readonly LocalRegionGroup[] = [
  {
    id: "53547021B2738722376900",
    name: "Athens",
    members: ["53547021B2738722376900", "53547021B24220934156468", "53547021B31053030759604", "53547021B66598831065721", "53547021B11381598519126", "53547021B26428037037954", "53547021B61397551596629", "53547021B43088565949702", "53547021B28343804278369"],
  },
  {
    id: "53547021B60272535960699",
    name: "Northern Athens",
    members: ["53547021B60272535960699", "53547021B59197259507031", "53547021B13973442480426", "53547021B13585760966110", "53547021B40828543742438", "53547021B77563010922332"],
  },
  {
    id: "53547021B73781600558558",
    name: "Eastern Athens",
    members: ["53547021B73781600558558", "53547021B9872067267260", "53547021B78874173841678", "53547021B90895117321858"],
  },
  {
    id: "53547021B42397561694605",
    name: "Southern Athens",
    members: ["53547021B42397561694605", "53547021B54133435495657", "53547021B84320611928141", "53547021B78031769692212", "53547021B71932835552379", "53547021B98874047367663", "53547021B41412986529583", "53547021B36167023330158", "53547021B51158260814857", "53547021B43730380907048"],
  },
  {
    id: "53547021B46293618367520",
    name: "Piraeus and Western Athens",
    members: ["53547021B46293618367520", "53547021B69430193409893", "53547021B45296397879130", "53547021B31949944847371", "53547021B35436816313063", "53547021B48705604430403", "53547021B28142208211838", "53547021B58485440362899", "53547021B40329858246568", "53547021B39305400178376", "53547021B41068859033459", "53547021B78495835617013", "53547021B27162960455281", "53547021B48888064243698", "53547021B28693517863347"],
  },
  {
    id: "53547021B56010870315220",
    name: "Thessaloniki",
    members: ["53547021B56010870315220", "53547021B8633274333782", "53547021B66289561682340", "53547021B3249049019402", "53547021B82210761635723", "53547021B92788697254427", "53547021B15452068412187"],
  },
  {
    id: "53547021B36892489950572",
    name: "Acarnanian Islands",
    members: ["53547021B36892489950572", "53547021B5259778029298"],
  },
];

type BoundaryEdge = Readonly<{ first: readonly [number, number]; second: readonly [number, number] }>;

function localPointKey([longitude, latitude]: readonly [number, number]): string {
  return `${longitude},${latitude}`;
}

function localEdgeKey(first: readonly [number, number], second: readonly [number, number]): string {
  const firstKey = localPointKey(first);
  const secondKey = localPointKey(second);
  return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
}

/** Removes former municipal boundaries from a contiguous merged territory. */
function dissolveLocalRegionGroup(features: readonly LocalRegion[]): GeoJsonMapFeature["geometry"] {
  const edges = new Map<string, BoundaryEdge>();
  for (const feature of features) {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [];
    for (const polygon of polygons) for (const ring of polygon) for (let index = 1; index < ring.length; index++) {
      const edge = { first: ring[index - 1]!, second: ring[index]! };
      const key = localEdgeKey(edge.first, edge.second);
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, edge);
    }
  }

  const remaining = new Map([...edges.entries()]);
  const rings: [number, number][][] = [];
  while (remaining.size > 0) {
    const [, firstEdge] = remaining.entries().next().value as [string, BoundaryEdge];
    const ring: [number, number][] = [[...firstEdge.first]];
    let current = firstEdge;
    remaining.delete(localEdgeKey(current.first, current.second));
    while (localPointKey(current.second) !== localPointKey(ring[0]!)) {
      ring.push([...current.second]);
      const next = [...remaining.values()].find((edge) => localPointKey(edge.first) === localPointKey(current.second));
      if (next === undefined) throw new Error("A merged Greek territory has an open boundary.");
      remaining.delete(localEdgeKey(next.first, next.second));
      current = next;
    }
    ring.push([...ring[0]!]);
    rings.push(ring);
  }
  return rings.length === 1
    ? { type: "Polygon", coordinates: [rings[0]!] }
    : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
}

function mergeGreekMetroRegions(localFeatures: readonly LocalRegion[]): LocalRegion[] {
  const featureById = new Map(localFeatures.map((feature) => [feature.properties.shapeID, feature]));
  const groupByMemberId = new Map<string, LocalRegionGroup>();
  for (const group of GREEK_METRO_REGION_GROUPS) {
    for (const memberId of group.members) {
      if (!featureById.has(memberId)) throw new Error(`Greek metro region ${memberId} is missing from the local source map.`);
      if (groupByMemberId.has(memberId)) throw new Error(`Greek metro region ${memberId} was assigned twice.`);
      groupByMemberId.set(memberId, group);
    }
  }

  return localFeatures.flatMap((feature) => {
    const group = groupByMemberId.get(feature.properties.shapeID);
    if (group === undefined) return [feature];
    if (feature.properties.shapeID !== group.id) return [];
    return [{
      ...feature,
      geometry: dissolveLocalRegionGroup(group.members.map((memberId) => featureById.get(memberId)!)),
      properties: { ...feature.properties, shapeName: group.name },
    }];
  });
}

function withSettlementProvince(feature: GeoJsonMapFeature, provinceId: string): GeoJsonMapFeature {
  if (feature.properties.kind !== "settlement") throw new Error("Only settlement anchors can be reattached to a new territory.");
  return { ...feature, properties: { kind: "settlement", name: feature.properties.name, provinceId, type: feature.properties.type } };
}

function polygonCenter(polygon: readonly (readonly [number, number][])[]): readonly [number, number] {
  const ring = polygon[0] ?? [];
  const unique = ring.slice(0, -1);
  return unique.reduce<[number, number]>((sum, point) => [sum[0] + point[0] / unique.length, sum[1] + point[1] / unique.length], [0, 0]);
}

function clipRingToHalfPlane(ring: readonly (readonly [number, number])[], valueAt: (point: readonly [number, number]) => number): [number, number][] {
  const result: [number, number][] = [];
  const points = ring.slice(0, -1);
  for (let index = 0; index < points.length; index += 1) {
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
    if (currentInside !== nextInside && current[0] !== next[0]) result.push(crossing());
  }
  if (result.length < 3) return [];
  result.push([...result[0]!]);
  return result;
}

type SicilySite = Readonly<{ id: string; name: string; coordinate: readonly [number, number] }>;

function sicilianCityRegion(sicily: readonly (readonly (readonly [number, number][])[])[], site: SicilySite, allSites: readonly SicilySite[]) {
  return sicily.flatMap((polygon) => {
    let ring = polygon[0] === undefined ? [] : polygon[0].map((point) => [...point] as [number, number]);
    for (const other of allSites) {
      if (other.id === site.id || ring.length === 0) continue;
      // A Voronoi cell: every point is closer to this historical centre than
      // to another one. It follows Sicily's coast and produces angled, organic
      // city hinterlands rather than five artificial vertical strips.
      const [sx, sy] = site.coordinate;
      const [ox, oy] = other.coordinate;
      ring = clipRingToHalfPlane(ring, ([x, y]) => (x - sx) ** 2 + (y - sy) ** 2 - ((x - ox) ** 2 + (y - oy) ** 2));
    }
    return ring.length === 0 ? [] : [[ring]];
  });
}

/**
 * The source ADM1 feature combines Sicily with Sardinia and minor islands.
 * Split Sicily into five stable provinces before the map reaches the client.
 * This gives Rome, Carthage, and Syracuse independently visible opening
 * territories in the First Punic War rather than painting the whole island as
 * a single modern administrative region.
 * Corse is already a distinct French GeoJSON feature.
 */
function splitSicily(map: GeoJsonMap): GeoJsonMap {
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (feature.id !== ITALIAN_ISLANDS_ID || feature.geometry.type !== "MultiPolygon" || feature.properties.kind !== "province") return [feature];
      const sicily = feature.geometry.coordinates.filter((polygon) => {
        const [longitude, latitude] = polygonCenter(polygon);
        return longitude > 11 && longitude < 16 && latitude < 39.8;
      });
      const remaining = feature.geometry.coordinates.filter((polygon) => !sicily.includes(polygon));
      if (sicily.length === 0 || remaining.length === 0) return [feature];
      const regions: SicilySite[] = [
        { id: "sicily-west", name: "Lilybaeum and western Sicily", coordinate: [12.95, 37.8] },
        { id: "sicily-northwest", name: "Panormus and the north-west", coordinate: [13.36, 38.12] },
        { id: "sicily-central", name: "Agrigentum and the south-west", coordinate: [13.58, 37.31] },
        { id: "sicily-southeast", name: "Syracuse and the south-east", coordinate: [15.29, 37.08] },
        { id: "sicily-northeast", name: "Messana and the strait", coordinate: [15.55, 38.19] },
      ];
      return [
        { ...feature, geometry: { type: "MultiPolygon" as const, coordinates: remaining }, properties: { ...feature.properties, name: "Sardegna e isole" } },
        ...regions.map((region) => ({ ...feature, id: `${ITALIAN_ISLANDS_ID}-${region.id}`, geometry: { type: "MultiPolygon" as const, coordinates: sicilianCityRegion(sicily, region, regions) }, properties: { ...feature.properties, name: region.name } })),
      ];
    }),
  };
}

const splitRegionalMap = splitSicily(
  replaceWithLocalBoundaries(
    replaceWithLocalBoundaries(
      replaceItalyWithLocalBoundaries(replaceFranceWithLocalBoundaries(regionalMap)),
      "gbr-",
      "gbr-local-",
      unitedKingdomDistricts.features,
    ),
    "grc-",
    "grc-local-",
    mergeGreekMetroRegions(greeceRegions.features),
  ),
);

export const europeNorthAfricaGeoJson: GeoJsonMap = {
  ...splitRegionalMap,
  features: [
    ...splitRegionalMap.features,
    withSettlementProvince(romeDemoSettlement, "ita-local-23120603B86473916475875"),
    withSettlementProvince(naplesDemoSettlement, "ita-local-23120603B14973764900567"),
    syracuseDemoSettlement,
    agrigentumFortDemoSettlement,
    caralisDemoSettlement,
  ],
};
