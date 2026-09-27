import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeoJsonMap, GeoJsonMapFeature } from "@chronica/shared";
import { agrigentumDemoSettlement, caralisDemoSettlement, naplesDemoSettlement, romeDemoSettlement, syracuseDemoSettlement } from "./calibration-map-features";

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
  // Every Greek political entity in the 270 BCE opening is a single merged
  // province rather than a scatter of separately-shaped modern municipalities.
  // The four northern kingdoms (Macedon, Thessaly, Epirus, Aegean Thrace) are
  // each split into several broad sub-regions instead of one monolith, so
  // their internal geography (upland/lowland/coast) stays visible; every
  // southern and Aegean city-state/league/island group is exactly one region.
  // Thebes and Megalopolis are already single municipalities and need no group.
  {
    id: "53547021B28781406112722",
    name: "Upper Macedonia",
    members: [
      "53547021B66222242349127", "53547021B47328398338983", "53547021B28781406112722", "53547021B2383377581877", "53547021B85378803261485",
      "53547021B24865561164584", "53547021B51639145110891", "53547021B39142600406611", "53547021B74146807534658", "53547021B78625637491486",
      "53547021B48123523700382",
    ],
  },
  {
    id: "53547021B48713005805080",
    name: "Bottiaea",
    members: [
      "53547021B39990906216499", "53547021B88855189165217", "53547021B28890095708986", "53547021B20400809877088", "53547021B92339582809627",
      "53547021B48713005805080", "53547021B47822971652302",
    ],
  },
  {
    id: "53547021B7133830368092",
    name: "Pieria",
    members: ["53547021B7133830368092", "53547021B54315896732910", "53547021B45546194955397"],
  },
  {
    id: "53547021B56010870315220",
    name: "Amphaxitis",
    members: [
      "53547021B50579698605337", "53547021B8539280325295", "53547021B75591847630099", "53547021B93576040480111", "53547021B25127242481922",
      "53547021B77689448104002", "53547021B56010870315220", "53547021B18503575679457", "53547021B27852952685239", "53547021B67372955866360",
      "53547021B8633274333782", "53547021B66289561682340", "53547021B3249049019402", "53547021B82210761635723", "53547021B92788697254427", "53547021B15452068412187",
    ],
  },
  {
    id: "53547021B74318370838028",
    name: "Chalcidice",
    members: [
      "53547021B85097268009433", "53547021B74318370838028", "53547021B22263739106563", "53547021B31742213292685", "53547021B40832205739746",
      "53547021B80449020436996",
    ],
  },
  {
    id: "53547021B81638497609890",
    name: "Bisaltia",
    members: [
      "53547021B38858534933408", "53547021B34968344051936", "53547021B61086329555590", "53547021B82148027008131", "53547021B81638497609890",
      "53547021B45001441830807", "53547021B81524104874165", "53547021B28941291401601", "53547021B80454148409460", "53547021B50273584733503",
      "53547021B53070107446977", "53547021B52093950324767", "53547021B99961606275333", "53547021B28786686705921",
    ],
  },
  {
    id: "53547021B50324925273652",
    name: "Perrhaebia",
    members: [
      "53547021B50324925273652", "53547021B73635162331197", "53547021B74999258103464", "53547021B87097504018733", "53547021B58022395954792",
      "53547021B89544081839297", "53547021B47246241663244", "53547021B32913874834462",
    ],
  },
  {
    id: "53547021B2020511099741",
    name: "Trikala",
    members: [
      "53547021B47804939064948", "53547021B85296886824024", "53547021B2256644643216", "53547021B2020511099741", "53547021B52630088008915",
      "53547021B60994585435599", "53547021B54967540416011", "53547021B59505193782388", "53547021B55984090304412", "53547021B28195200899394",
      "53547021B95840700609502",
    ],
  },
  {
    id: "53547021B56732650890959",
    name: "Magnesia",
    members: ["53547021B37903470937517", "53547021B56732650890959", "53547021B75519572932281", "53547021B75531975007205", "53547021B57627199750210"],
  },
  {
    id: "53547021B41771817099424",
    name: "Sporades",
    members: ["53547021B41771817099424", "53547021B62030988298949", "53547021B78142724004700"],
  },
  {
    id: "53547021B74781806510115",
    name: "Molossia",
    members: [
      "53547021B74781806510115", "53547021B33840684001600", "53547021B6832739035226", "53547021B3340561155078", "53547021B737198605722",
      "53547021B96725942296710", "53547021B6509598985674", "53547021B27358197648048",
    ],
  },
  {
    id: "53547021B84065856572529",
    name: "Thesprotia",
    members: ["53547021B84065856572529", "53547021B96655726505688", "53547021B22998409098785", "53547021B28907502045859"],
  },
  {
    id: "53547021B99371501421593",
    name: "Ambracia",
    members: [
      "53547021B99371501421593", "53547021B31274906643847", "53547021B23189791257935", "53547021B59015446120444", "53547021B53341269381036",
    ],
  },
  {
    id: "53547021B75963391026292",
    name: "Preveza",
    members: ["53547021B75963391026292", "53547021B10735873642885"],
  },
  {
    id: "53547021B46158263543411",
    name: "Xanthi",
    members: ["53547021B46158263543411", "53547021B59212511746888", "53547021B35158137424672", "53547021B93267404928266"],
  },
  {
    id: "53547021B38986077120400",
    name: "Rodopi",
    members: ["53547021B38986077120400", "53547021B97495413305113", "53547021B28340391516050", "53547021B22321934068186"],
  },
  {
    id: "53547021B12719539164910",
    name: "Evros",
    members: ["53547021B12719539164910", "53547021B11230814438806", "53547021B96091145181184", "53547021B61977716091776"],
  },
  {
    id: "53547021B3259543617639",
    name: "Nestos",
    members: ["53547021B3259543617639", "53547021B62964358378279", "53547021B94603646495013", "53547021B9100129164717"],
  },
  {
    id: "53547021B2738722376900",
    name: "Athens",
    members: [
      "53547021B93190523098982", "53547021B9274256728427", "53547021B42038688650447", "53547021B59197259507031", "53547021B46856554305408",
      "53547021B73781600558558", "53547021B9872067267260", "53547021B54133435495657", "53547021B58919078390867", "53547021B78874173841678",
      "53547021B90895117321858", "53547021B62460080330009", "53547021B50341787829702", "53547021B73063922158983", "53547021B139863795",
      "53547021B60272535960699", "53547021B11381598519126", "53547021B26428037037954", "53547021B61397551596629", "53547021B43088565949702",
      "53547021B13585760966110", "53547021B13973442480426", "53547021B40828543742438", "53547021B77563010922332", "53547021B31053030759604",
      "53547021B66598831065721", "53547021B35436816313063", "53547021B49666897739583", "53547021B24220934156468", "53547021B43730380907048",
      "53547021B51158260814857", "53547021B98874047367663", "53547021B36167023330158", "53547021B41412986529583", "53547021B2738722376900",
      "53547021B48705604430403", "53547021B28142208211838", "53547021B98389785253572", "53547021B58485440362899", "53547021B71932835552379",
      "53547021B78031769692212", "53547021B84320611928141", "53547021B42397561694605", "53547021B28693517863347", "53547021B48888064243698",
      "53547021B27162960455281", "53547021B40329858246568", "53547021B39305400178376", "53547021B78495835617013", "53547021B41068859033459",
      "53547021B45296397879130", "53547021B69430193409893", "53547021B46293618367520", "53547021B31949944847371", "53547021B28343804278369",
      "53547021B79003090223986", "53547021B2228776915974", "53547021B11646633463152",
    ],
  },
  {
    id: "53547021B13999927787317",
    name: "Acarnania",
    members: ["53547021B50185168067572", "53547021B46612158755338", "53547021B13999927787317", "53547021B48337850511986", "53547021B25533689161556"],
  },
  {
    id: "53547021B64283449494832",
    name: "Achaea",
    members: ["53547021B64283449494832", "53547021B78793041565006", "53547021B8800773704362", "53547021B61637621590840"],
  },
  {
    id: "53547021B48314635979132",
    name: "Aeolis",
    members: [
      "53547021B27848080443845", "53547021B29376854507726", "53547021B48314635979132", "53547021B84204057813712", "53547021B51237961476559", "53547021B66988262983744",
    ],
  },
  {
    id: "53547021B94939044260752",
    name: "Aetolia",
    members: [
      "53547021B94939044260752", "53547021B49401995919175", "53547021B98291261217128", "53547021B62185300299797", "53547021B50444274561613",
      "53547021B50685952725825", "53547021B16404317109439",
    ],
  },
  {
    id: "53547021B21928215171810",
    name: "Arcadia",
    members: ["53547021B27793297184106", "53547021B95421116796613", "53547021B21928215171810"],
  },
  {
    id: "53547021B76628339296380",
    name: "Argos",
    members: [
      "53547021B34638618079058", "53547021B76628339296380", "53547021B66089273979602", "53547021B61284314661449", "53547021B68402716695830",
      "53547021B22944615886020", "53547021B47495045685041", "53547021B31670610652055",
    ],
  },
  {
    id: "53547021B64910393860585",
    name: "Boeotia",
    members: [
      "53547021B64910393860585", "53547021B7101265711670", "53547021B37029617742900", "53547021B5427658956553", "53547021B58173786897638",
      "53547021B35461032943071", "53547021B96323782975669",
    ],
  },
  {
    id: "53547021B7583828069802",
    name: "Corinthia",
    members: [
      "53547021B28596502705639", "53547021B7583828069802", "53547021B31633588775048", "53547021B57876303019843", "53547021B49340454870822", "53547021B9803331652981",
    ],
  },
  {
    id: "53547021B22915983963117",
    name: "Eastern Crete",
    members: [
      "53547021B53279819470328", "53547021B67677949028001", "53547021B51937330255180", "53547021B78630521546068", "53547021B56645835062764",
      "53547021B37686149214956", "53547021B50561479527523", "53547021B61294073718847", "53547021B22915983963117", "53547021B57383137441935",
      "53547021B55105718637699", "53547021B88004550076070", "53547021B31775501825799", "53547021B96945859655047", "53547021B69726865703456", "53547021B73687817516293",
    ],
  },
  {
    id: "53547021B84334822638882",
    name: "Western Crete",
    members: [
      "53547021B6491391664836", "53547021B84334822638882", "53547021B27647726174343", "53547021B36207579712353", "53547021B69991505918188",
      "53547021B95986693846291", "53547021B54920470672520", "53547021B40439292556203", "53547021B60830595805901",
    ],
  },
  {
    id: "53547021B73817444221742",
    name: "Cyclades",
    members: [
      "53547021B14587890141063", "53547021B68771809691865", "53547021B73836708319898", "53547021B73817444221742", "53547021B7637934364384",
      "53547021B50922238140388", "53547021B93700344623224", "53547021B91453036712640", "53547021B90088686662999", "53547021B1587257754392",
      "53547021B58981703500850", "53547021B31952026636048", "53547021B52309910958375", "53547021B57678197221990", "53547021B20655569007044",
      "53547021B65975063640854", "53547021B41286573070339", "53547021B2109852565692", "53547021B87111517925303",
    ],
  },
  {
    id: "53547021B33259065854290",
    name: "Rhodes",
    members: [
      "53547021B79831596850386", "53547021B33259065854290", "53547021B75170445936702", "53547021B47996092529292", "53547021B10109746206606",
      "53547021B81123909455737", "53547021B14104981349473", "53547021B57223359042947", "53547021B5655608109078", "53547021B65639562394227",
      "53547021B9865954519717", "53547021B27725910379906", "53547021B47933499934509", "53547021B11217134811414",
    ],
  },
  {
    id: "53547021B19956841510236",
    name: "Elis",
    members: [
      "53547021B61074290921347", "53547021B395224961321", "53547021B55397750885727", "53547021B6424451077968", "53547021B19956841510236",
      "53547021B46893578630881", "53547021B91519057350540", "53547021B54383895091480", "53547021B16915603941754",
    ],
  },
  {
    id: "53547021B4929221298038",
    name: "Euboea",
    members: [
      "53547021B4929221298038", "53547021B11940599573027", "53547021B35893397617258", "53547021B30143015860130", "53547021B88525152151548",
      "53547021B98799222939047", "53547021B66684372134379", "53547021B89364660535842",
    ],
  },
  {
    id: "53547021B1583318227364",
    name: "Ionia",
    members: ["53547021B1583318227364", "53547021B72748856763578"],
  },
  {
    id: "53547021B4893314686518",
    name: "Ionian Islands",
    members: [
      "53547021B56133984364891", "53547021B4893314686518", "53547021B36892489950572", "53547021B5259778029298", "53547021B56397537890065",
      "53547021B16096881973590", "53547021B71460328638082",
    ],
  },
  {
    id: "53547021B35192590886666",
    name: "Messenia",
    members: ["53547021B35192590886666", "53547021B67022327666840", "53547021B89272738567676"],
  },
  {
    id: "53547021B62210225540795",
    name: "Phocis",
    members: [
      "53547021B83448724449925", "53547021B80740180433739", "53547021B62210225540795", "53547021B68968081494032", "53547021B28305351611678",
    ],
  },
  {
    id: "53547021B92158672895518",
    name: "Sparta",
    members: [
      "53547021B55703563260454", "53547021B23400479427281", "53547021B84513117359577", "53547021B31587155744737", "53547021B92158672895518",
      "53547021B25281145353458", "53547021B20166446327707", "53547021B40993190034895", "53547021B99660133623789",
    ],
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

/**
 * Messapia -- the Sallentine peninsula, the heel of Italy -- was still free of
 * Rome in 270 (it fell in 267-266), so it cannot be painted as part of Apulia.
 * The source has only Puglia's regional outline, so the frontier is drawn here:
 * from the Ionian shore between Taras's territory and Messapian Manduria, north
 * past Oria, Ceglie and the Itria hills, to the Adriatic above Egnatia, the
 * last Messapian city. Frontiers follow ridges and streams rather than
 * surveyors' lines, so the course is broken up by a seeded midpoint
 * displacement: the same wandering line on every build.
 */
const MESSAPIAN_FRONTIER: readonly (readonly [number, number])[] = [
  [17.455, 40.285], // in the Gulf of Taranto, between Taras's shore and Manduria's
  [17.47, 40.33],
  [17.52, 40.37],
  [17.5, 40.42],
  [17.535, 40.47], // east of Grottaglie
  [17.49, 40.52],
  [17.51, 40.57],
  [17.45, 40.61], // Ceglie stays Messapian
  [17.44, 40.67],
  [17.38, 40.7], // the Itria hills
  [17.4, 40.76],
  [17.35, 40.8],
  [17.37, 40.85],
  [17.33, 40.9], // above Egnatia
  [17.33, 40.975], // in the Adriatic
];

function wanderingLine(points: readonly (readonly [number, number])[], depth: number, seed: number): [number, number][] {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000 - 0.5;
  };
  let line = points.map(([x, y]) => [x, y] as [number, number]);
  for (let level = 0; level < depth; level += 1) {
    const next: [number, number][] = [line[0]!];
    for (let index = 1; index < line.length; index += 1) {
      const [ax, ay] = line[index - 1]!;
      const [bx, by] = line[index]!;
      const length = Math.hypot(bx - ax, by - ay);
      // Offset the midpoint across the segment, by less at each level.
      const offset = random() * length * 0.55;
      next.push([(ax + bx) / 2 - ((by - ay) / length) * offset, (ay + by) / 2 + ((bx - ax) / length) * offset]);
      next.push(line[index]!);
    }
    line = next;
  }
  return line;
}

function segmentIntersection(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): { t: number; u: number; point: [number, number] } | null {
  const denominator = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (denominator === 0) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / denominator;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
}

function ringContains(ring: readonly (readonly [number, number])[], [x, y]: readonly [number, number]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index]!;
    const [xj, yj] = ring[previous]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Cut a closed ring in two along a line that enters and leaves it once each.
 * Both halves carry the line's own vertices, so the border they share is
 * exact and the province graph finds them adjacent.
 */
function splitRingAlongLine(ring: readonly (readonly [number, number])[], line: readonly (readonly [number, number])[]): [[number, number][], [number, number][]] {
  const crossings: { along: number; edge: number; u: number; point: [number, number] }[] = [];
  for (let segment = 1; segment < line.length; segment += 1) {
    for (let edge = 1; edge < ring.length; edge += 1) {
      const hit = segmentIntersection(line[segment - 1]!, line[segment]!, ring[edge - 1]!, ring[edge]!);
      if (hit !== null) crossings.push({ along: segment - 1 + hit.t, edge: edge - 1, u: hit.u, point: hit.point });
    }
  }
  if (crossings.length !== 2) throw new Error(`The Messapian frontier must cross Apulia's coast exactly twice; it crosses ${crossings.length} times.`);
  const [entry, exit] = crossings.sort((a, b) => a.along - b.along) as [typeof crossings[number], typeof crossings[number]];
  const inland = line.slice(Math.floor(entry.along) + 1, Math.floor(exit.along) + 1).map(([x, y]) => [x, y] as [number, number]);
  const open = ring.slice(0, -1).map(([x, y]) => [x, y] as [number, number]);
  // The coast from one crossing round to the other, walking the ring forward.
  const coastBetween = (from: typeof entry, to: typeof entry): [number, number][] => {
    const points: [number, number][] = [];
    let edge = from.edge;
    if (edge === to.edge && to.u > from.u) return points;
    do {
      edge = (edge + 1) % open.length;
      points.push(open[edge]!);
    } while (edge !== to.edge);
    return points;
  };
  const first: [number, number][] = [entry.point, ...coastBetween(entry, exit), exit.point, ...[...inland].reverse()];
  const second: [number, number][] = [exit.point, ...coastBetween(exit, entry), entry.point, ...inland];
  return [[...first, first[0]!], [...second, second[0]!]];
}

const MESSAPIA_ID = "ita-local-messapia";

function splitMessapiaFromApulia(map: GeoJsonMap): GeoJsonMap {
  return {
    ...map,
    features: map.features.flatMap((feature) => {
      if (feature.properties.kind !== "province" || feature.properties.name !== "Puglia" || feature.geometry.type !== "MultiPolygon") return [feature];
      const polygons = feature.geometry.coordinates;
      const mainland = polygons.reduce((largest, polygon) => ((polygon[0]?.length ?? 0) > (largest[0]?.length ?? 0) ? polygon : largest));
      const [one, other] = splitRingAlongLine(mainland[0]!, wanderingLine(MESSAPIAN_FRONTIER, 4, 267));
      const lupiae: readonly [number, number] = [18.17, 40.35];
      const [messapia, apulia] = ringContains(one, lupiae) ? [one, other] : [other, one];
      // Islets go with whichever side of the frontier they lie on.
      const islets = polygons.filter((polygon) => polygon !== mainland);
      const isMessapian = (polygon: (typeof polygons)[number]) => {
        const [longitude, latitude] = polygonCenter(polygon);
        return longitude > 17.5 && latitude < 40.85;
      };
      return [
        { ...feature, geometry: { type: "MultiPolygon" as const, coordinates: [[apulia], ...islets.filter((polygon) => !isMessapian(polygon))] } },
        { ...feature, id: MESSAPIA_ID, geometry: { type: "MultiPolygon" as const, coordinates: [[messapia], ...islets.filter(isMessapian)] }, properties: { ...feature.properties, name: "Sallentine Peninsula" } },
      ];
    }),
  };
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
        { ...feature, geometry: { type: "MultiPolygon" as const, coordinates: remaining }, properties: { ...feature.properties, name: "Sardinia" } },
        ...regions.map((region) => ({ ...feature, id: `${ITALIAN_ISLANDS_ID}-${region.id}`, geometry: { type: "MultiPolygon" as const, coordinates: sicilianCityRegion(sicily, region, regions) }, properties: { ...feature.properties, name: region.name } })),
      ];
    }),
  };
}

const splitRegionalMap = splitSicily(
  replaceWithLocalBoundaries(
    replaceWithLocalBoundaries(
      splitMessapiaFromApulia(replaceItalyWithLocalBoundaries(replaceFranceWithLocalBoundaries(regionalMap))),
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
    agrigentumDemoSettlement,
    caralisDemoSettlement,
  ],
};
