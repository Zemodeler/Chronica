import "server-only";

import type { DynamicMapOverlay } from "@chronica/shared";
import { punicWarsGeoJson } from "./punic-wars-geojson";

export type HistoricalConfidence = "high" | "medium" | "cautious";
export type PunicWarsControlRecord = Readonly<{
  provinceId: string;
  controllerPolityId: string;
  confidence: HistoricalConfidence;
  sourceNote: string;
}>;

const ITALIAN_CONTROLLERS: Readonly<Record<string, string>> = {
  "punic-italy-ligurian-coast": "ligurians", "punic-italy-upper-padus-and-alpine-gate": "insubres", "punic-italy-insubrian-plain": "insubres",
  "punic-italy-middle-padus": "boii", "punic-italy-venetian-lagoon": "veneti", "punic-italy-isonzo-gate": "veneti",
  "punic-italy-etrurian-uplands": "rome", "punic-italy-umbrian-valleys": "rome", "punic-italy-picenum-coast": "rome",
  "punic-italy-latium": "rome", "punic-italy-marsian-highlands": "rome", "punic-italy-samnium": "rome",
  "punic-italy-campanian-plain": "rome", "punic-italy-apulian-coast": "rome", "punic-italy-lucanian-uplands": "rome", "punic-italy-bruttian-highlands": "rome",
  "punic-italy-alpine-passes": "noric-communities", "punic-italy-adige-passes": "noric-communities",
};

const POLITY_NAMES: Record<string, string> = {
  rome: "Roman Republic",
  carthage: "Carthage",
  syracuse: "Kingdom of Syracuse",
  mamertines: "Mamertines of Messana",
  ligurians: "Ligurian peoples",
  insubres: "Insubres",
  boii: "Boii",
  cenomani: "Cenomani",
  veneti: "Veneti",
  "etruscan-cities": "Etruscan cities",
  sabines: "Sabines",
  umbrians: "Umbrians",
  picentes: "Picentes",
  "marsi-paeligni": "Marsi and Paeligni",
  campanians: "Campanians",
  samnites: "Samnites",
  daunians: "Daunians",
  peucetians: "Peucetians",
  messapians: "Messapians",
  tarentines: "Tarentines",
  lucanians: "Lucanians",
  bruttians: "Bruttians",
  rhegines: "Rhegines",
  "mauretanian-peoples": "Mauretanian peoples",
  "numidian-kingdoms": "Numidian kingdoms",
  gaetuli: "Gaetuli",
  garamantes: "Garamantes",
  lusitanians: "Lusitanian peoples",
  "helvetian-peoples": "Helvetian peoples",
  "noric-communities": "Eastern Alpine communities",
  "transalpine-celts": "Transalpine Celtic peoples",
  "hellenic-islanders": "Aegean island communities",
  macedon: "Kingdom of Macedon",
  epirus: "Kingdom of Epirus",
  athens: "Athens",
  "achaean-league": "Achaean League",
  "aetolian-league": "Aetolian League",
  "thessalian-league": "Thessalian League",
  "illyrian-communities": "Illyrian communities",
  "thracian-communities": "Thracian communities",
  "ptolemaic-cyrenaica": "Ptolemaic Cyrenaica",
  "boii-middle-danube": "Boii of the Middle Danube",
  "thrace-scordisci": "Scordisci",
  "gaul-armorican-confederacy": "Armorican confederacy",
  "gaul-belgae": "Belgae",
  "gaul-treveri": "Treveri",
  "gaul-sequani": "Sequani",
  "gaul-aedui": "Aedui",
  "gaul-arverni": "Arverni",
  "gaul-bituriges": "Bituriges Cubi",
  "gaul-sequana-peoples": "Sequana peoples",
  "gaul-aquitani": "Aquitani",
  "gaul-volcae": "Volcae",
  "gaul-allobroges": "Allobroges",
  "gaul-salyens": "Salyens",
  massalia: "Massalia",
  "germania-suebi": "Suebi",
  "germania-ubii": "Ubii",
  "germania-vindelici": "Vindelici",
  "germania-boii": "Boii of the Danube",
  "germania-semnones": "Semnones",
  "germania-chauci": "Chauci",
  "germania-chatti": "Chatti",
  "germania-cherusci": "Cherusci",
  "germania-bructeri": "Bructeri",
  "germania-treveri": "Treveri",
  "germania-hermunduri": "Hermunduri",
  "germania-cimbri": "Cimbri",
  "iberia-gallaeci": "Gallaeci",
  "iberia-astures": "Astures",
  "iberia-cantabri": "Cantabri",
  "iberia-vascones": "Vascones",
  "iberia-vaccei": "Vaccaei",
  "iberia-vettones": "Vettones",
  "iberia-lusitani": "Lusitani",
  "iberia-carpetani": "Carpetani",
  "iberia-celtiberi": "Celtiberian peoples",
  "iberia-ilergetes": "Ilergetes",
  "canarian-peoples": "Canarian peoples",
  "thrace-dacian-highland-communities": "Dacian highland communities",
  "thrace-getae": "Getae",
  "thrace-eastern-carpathian-communities": "Eastern Carpathian communities",
  pannonii: "Pannonii",
  "carpathian-communities": "Carpathian Basin communities",
  "illyria-histri-liburni": "Histri and Liburni",
  "illyria-dalmatae": "Delmatae",
  "illyria-ardiaei": "Ardiaean Kingdom",
  "illyria-autariatae": "Autariatae",
  "illyria-taulantii": "Taulantii",
  "illyria-dardani": "Dardani",
  "illyria-paeonian-communities": "Paeonian communities",
  "britain-caledonian-communities": "Caledonian communities",
  "britain-northern-britons": "Northern Britons",
  "britain-welsh-communities": "Western Britons",
  "britain-southwestern-britons": "South-western Britons",
  "britain-thames-britons": "Thames Basin Britons",
  "britain-eastern-britons": "Eastern Britons",
  "britain-midland-britons": "Midland Britons",
  "britain-irish-sea-communities": "Irish Sea communities",
  acarnania: "Acarnanian League",
  "boeotian-league": "Boeotian League",
  thebes: "Thebes",
  elis: "Elis",
  messenia: "Messenia",
  sparta: "Sparta",
  megalopolis: "Megalopolis",
};

/**
 * The map retains surveyed local boundaries for movement and settlement
 * placement, but political control is deliberately broader.  These are the
 * substantial peoples and city-states attested around 270 BCE, not a modern
 * administrative area promoted to a state of its own.
 */
const HISTORICAL_POLITY_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["gaul-armorican-confederacy", ["Finistère", "Côtes d'Armor", "Morbihan", "Ille-et-Vilaine", "Loire-Atlantique", "Mayenne", "Sarthe", "Manche", "Calvados", "Orne", "Maine-et-Loire", "Vendée"]],
  ["gaul-belgae", ["Nord", "Pas-de-Calais", "Somme", "Oise", "Aisne", "Ardennes"]],
  ["gaul-treveri", ["Meuse", "Mosella Valley", "Meurthe-et-Moselle", "Vosges"]],
  ["gaul-sequani", ["Haute-Marne", "Haute-Saône", "Doubs", "Jura", "Territoire de Belfort", "Bas-Rhin", "Haut-Rhin"]],
  ["gaul-aedui", ["Ain", "Côte-d'Or", "Arar Heights", "Nièvre", "Yonne", "Loire", "Rhône"]],
  ["gaul-arverni", ["Allier", "Arvernian Cones", "Cantal", "Haute-Loire", "Creuse", "Corrèze", "Lozère", "Aveyron"]],
  ["gaul-bituriges", ["Cher", "Indre", "Loir-et-Cher", "Loiret", "Eure-et-Loir", "Indre-et-Loire "]],
  ["gaul-sequana-peoples", ["Lutetian Island", "Seine-et-Marne", "Yvelines", "Essonne", "Hauts-de-Seine", "Seine-Saint-Denis", "Val-de-Marne", "Val-d'Oise", "Aube", "Eure", "Seine-Maritime"]],
  ["gaul-aquitani", ["Charente", "Charente-Maritime", "Dordogne", "Gironde", "Landes", "Lot-et-Garonne", "Deux-Sèvres", "Vienne", "Haute-Vienne", "Gers", "Hautes-Pyrénées", "Pyrénées-Atlantiques", "Lot"]],
  ["gaul-volcae", ["Ariège", "Aude", "Gard", "Hérault", "Haute-Garonne", "Pyrénées-Orientales", "Tarn", "Tarn-et-Garonne"]],
  ["gaul-allobroges", ["Isère", "Drôme", "Ardèche", "Savoie", "Haute-Savoie"]],
  ["ligurians", ["Alpes-de-Haute-Provence", "Hautes-Alpes", "Alpes-Maritimes", "Var"]],
  ["gaul-salyens", ["Vaucluse"]],
  ["massalia", ["Rhodanus Delta"]],

  ["germania-suebi", ["Neckar Uplands", "Black Forest Gate", "Swabian Jura", "Naab Uplands", "Franconian Forest", "Middle Moenus", "Lower Moenus", "Moenus–Rhenus Gate", "Upper Rhenus Bend", "Saar Coal Hills"]],
  ["germania-ubii", ["Upper Rhenus Terrace", "Ubian Lower Rhenus", "Rhenus Gorge"]],
  ["germania-vindelici", ["Upper Isar Country", "Vindelician Lech"]],
  ["germania-boii", ["Boii of the Danube"]],
  ["germania-semnones", ["Spree–Havel Confluence", "Semnonian March", "Albis Heath", "Middle Albis", "Upper Albis Valley"]],
  ["germania-chauci", ["Visurgis Mouth", "Albis Mouth", "Baltic Lagoons"]],
  ["germania-chatti", ["Chattian Lahn", "Upper Visurgis", "Harz Foreland"]],
  ["germania-cherusci", ["Cheruscan Leine", "Teutoburg Ridge"]],
  ["germania-bructeri", ["Bructerian Plain", "Sauerland Heights"]],
  ["germania-treveri", ["Mosella–Rhenus Confluence", "Treveran Mosella"]],
  ["germania-hermunduri", ["Ore Mountain Passes", "Pleiße Lowland", "Hermundurian Basin"]],
  ["germania-cimbri", ["Cimbrian Jutland Approaches"]],

  ["canarian-peoples", ["Canarias"]],
  ["iberia-gallaeci", ["Galicia", "Gallaeci"]],
  ["iberia-astures", ["Principado de Asturias", "Astures"]],
  ["iberia-cantabri", ["Cantabria", "Cantabri"]],
  ["iberia-vascones", ["La Rioja", "País Vasco/Euskadi", "Comunidad Foral de Navarra", "Varduli and Autrigones", "Vascones"]],
  ["iberia-vaccei", ["Castilla y León", "Vaccei"]],
  ["iberia-vettones", ["Vettones"]],
  ["iberia-lusitani", ["Extremadura", "Lusitani"]],
  ["iberia-carpetani", ["Comunidad de Madrid", "Castilla-La Mancha", "Carpetani"]],
  ["iberia-celtiberi", ["Aragón", "Celtiberi"]],
  ["iberia-ilergetes", ["Cataluña/Catalunya", "Ilergetes", "Lacetani"]],
  ["carthage", ["Oretani", "Turdetani", "Turduli", "Celtici", "Conii", "Bastetani", "Contestani", "Edetani"]],

  ["thrace-dacian-highland-communities", ["ALBA", "ARAD", "BIHOR", "BISTRITA-NASAUD", "BRASOV", "CARAS-SEVERIN", "CLUJ", "COVASNA", "GORJ", "HARGHITA", "HUNEDOARA", "MARAMURES", "MURES", "SALAJ", "SATU MARE", "SIBIU", "MEHEDINTI", "VALCEA"]],
  ["thrace-getae", ["ARGES", "BRAILA", "BUZAU", "CALARASI", "CONSTANTA", "DAMBOVITA", "DOLJ", "GALATI", "GIURGIU", "IALOMITA", "ILFOV", "BUCURESTI", "OLT", "PRAHOVA", "TELEORMAN", "TULCEA", "VRANCEA"]],
  ["thrace-eastern-carpathian-communities", ["BACAU", "BOTOSANI", "IASI", "NEAMT", "SUCEAVA", "VASLUI"]],
];

const HISTORICAL_POLITY_BY_TERRITORY_NAME = new Map(
  HISTORICAL_POLITY_GROUPS.flatMap(([polityId, territoryNames]) => territoryNames.map((territoryName) => [territoryName, polityId] as const)),
);

const HISTORICAL_POLITY_BY_PROVINCE_ID = new Map(
  punicWarsGeoJson.features.flatMap((feature) => feature.properties.kind === "province"
    ? (() => {
        const polityId = HISTORICAL_POLITY_BY_TERRITORY_NAME.get(feature.properties.name);
        return polityId === undefined ? [] : [[feature.id, polityId] as const];
      })()
    : []),
);

const TRANSREGIONAL_TRIBAL_CONTROLLERS: Readonly<Record<string, string>> = {
  "punic-hungary-boii-western-pannonia": "boii-middle-danube",
  "punic-czechoslovakia-boii-bohemia": "boii-middle-danube",
  "punic-czechoslovakia-boii-moravia": "boii-middle-danube",
  "punic-czechoslovakia-boii-slovakia": "boii-middle-danube",
  "punic-hungary-scordisci": "thrace-scordisci",
  "punic-luxembourg-treveri": "germania-treveri",
};

const CARTHAGINIAN_IBERIAN_REGIONS = new Set([
  "punic-iberia-andalucia",
  "punic-iberia-region-de-murcia",
  "punic-iberia-comunitat-valenciana",
  "esp-25490228b26609846683583", // Balearic islands
  "esp-25490228b18225280299410", // Melilla
  "esp-25490228b48808997991554", // Ceuta
]);

// The supplied opening reference is retained for the Punic coastal belt. These
// interior and eastern regions remain independent African peoples in 270 BCE.
const NUMIDIAN_PROVINCES = new Set([
  "dza-43142294b54486011126442", "dza-43142294b89976296243107", "dza-43142294b45118294569306",
  "dza-43142294b7086800589276", "dza-43142294b35959348509380", "dza-43142294b67344016857851",
  "dza-43142294b52445945964546", "dza-43142294b60721224304202", "dza-43142294b80473805298321",
]);
const GAETULIAN_PROVINCES = new Set([
  "dza-43142294b97480278452280", "dza-43142294b70824426814000", "dza-43142294b43473078766346",
  "dza-43142294b57632161166824", "dza-43142294b83676700490594", "dza-43142294b80449327613638",
  "dza-43142294b23379165901565", "dza-43142294b64493603110073", "dza-43142294b58874984978475",
  "dza-43142294b74351585751074", "dza-43142294b66953226377953", "dza-43142294b26097348484504",
]);
const CARTHAGINIAN_MAURETANIAN_COAST = new Set([
  "mar-70788906b66040098455254", "mar-70788906b40056535803135", "mar-70788906b33851053053385", "mar-70788906b15955360211262",
]);
const PTOLEMAIC_CYRENAICA_PROVINCES = new Set([
  "lby-10800210b28216506156245", "lby-10800210b39782956615971", "lby-10800210b23470577588067",
  "lby-10800210b54463644997685", "lby-10800210b74925506200485",
]);
const GARAMANTIAN_PROVINCES = new Set([
  "lby-10800210b65194490964920", "lby-10800210b89898169718474", "lby-10800210b53073192190863",
  "lby-10800210b20515568933500", "lby-10800210b26344076542723", "lby-10800210b94224648391824",
  "lby-10800210b80153830865201", "lby-10800210b2800497533490",
]);

function provinceCentre(feature: (typeof punicWarsGeoJson.features)[number]): readonly [number, number] {
  if (feature.geometry.type === "Polygon") {
    const ring = feature.geometry.coordinates[0] ?? [];
    const points = ring.slice(0, -1);
    return points.reduce<[number, number]>((centre, point) => [centre[0] + point[0] / points.length, centre[1] + point[1] / points.length], [0, 0]);
  }
  if (feature.geometry.type === "MultiPolygon") {
    const points = feature.geometry.coordinates.flatMap((polygon) => (polygon[0] ?? []).slice(0, -1));
    return points.reduce<[number, number]>((centre, point) => [centre[0] + point[0] / points.length, centre[1] + point[1] / points.length], [0, 0]);
  }
  return [0, 0];
}

function greekControllerFor(feature: (typeof punicWarsGeoJson.features)[number]): string {
  const [longitude, latitude] = provinceCentre(feature);
  const name = feature.properties.name;
  if (name === "Thebes") return "thebes";
  if (name === "Athens") return "athens";
  if (name === "Sparta" || name === "Elafonisos") return "sparta";
  if (name === "Megalopolis") return "megalopolis";
  if (latitude >= 39.45) return longitude > 24.25 ? "thracian-communities" : "macedon";
  if (latitude < 36.65 || longitude > 24.25 || longitude < 20.75) return "hellenic-islanders";
  if (longitude < 21.35 && latitude >= 38.7) return "epirus";
  if (longitude < 21.45 && latitude >= 38.05) return "acarnania";
  if (longitude < 22.55 && latitude >= 37.85) return "aetolian-league";
  if (latitude >= 38.0 && latitude < 38.75 && longitude >= 22.55 && longitude < 23.55) return "boeotian-league";
  if (longitude >= 23.25 && latitude >= 37.65 && latitude < 38.25) return "athens";
  if (longitude < 22.05 && latitude >= 37.1 && latitude < 38.05) return "elis";
  if (longitude < 22.15 && latitude < 37.1) return "messenia";
  if (longitude >= 22.15 && longitude < 22.85 && latitude < 37.45) return "sparta";
  return "achaean-league";
}

function groundedControllerFor(feature: (typeof punicWarsGeoJson.features)[number]): string | null {
  if (feature.id.startsWith("punic-austria-")) return feature.properties.name === "Burgenland" ? "boii-middle-danube" : "noric-communities";
  if (feature.id.startsWith("punic-hungary-")) {
    const name = feature.properties.name ?? "";
    if (["Győr-Moson-Sopron", "Komárom-Esztergom", "Vas", "Zala", "Veszprém", "Fejér"].includes(name)) return "boii-middle-danube";
    if (["Baranya", "Somogy", "Tolna"].includes(name)) return "pannonii";
    if (["Bács-Kiskun", "Csongrád-Csanád", "Békés"].includes(name)) return "thrace-scordisci";
    if (["Borsod-Abaúj-Zemplén", "Szabolcs-Szatmár-Bereg", "Hajdú-Bihar"].includes(name)) return "thrace-dacian-highland-communities";
    return "carpathian-communities";
  }
  if (feature.id.startsWith("punic-illyria-alb-")) return "illyria-taulantii";
  if (feature.id.startsWith("punic-illyria-mne-")) return "illyria-ardiaei";
  if (feature.id.startsWith("punic-illyria-xkx-")) return "illyria-dardani";
  if (feature.id.startsWith("punic-illyria-mkd-")) return "illyria-paeonian-communities";
  if (feature.id.startsWith("punic-illyria-bih-")) return "illyria-dalmatae";
  if (feature.id.startsWith("punic-illyria-hrv-") || feature.id.startsWith("punic-illyria-svn-")) return "illyria-histri-liburni";
  if (feature.id.startsWith("punic-illyria-srb-")) return "illyria-autariatae";
  if (feature.id.startsWith("punic-britain-")) {
    const [longitude, latitude] = provinceCentre(feature);
    if (latitude >= 56.45) return "britain-caledonian-communities";
    if (latitude >= 54.7) return "britain-northern-britons";
    if (longitude < -5.15) return "britain-irish-sea-communities";
    if (longitude < -3.0 && latitude < 54.7) return "britain-welsh-communities";
    if (latitude < 51.55 && longitude < -2.2) return "britain-southwestern-britons";
    if (longitude > -0.25 && latitude < 53.2) return "britain-eastern-britons";
    if (latitude < 52.15) return "britain-thames-britons";
    return "britain-midland-britons";
  }
  if (feature.id.startsWith("punic-greece-")) return greekControllerFor(feature);
  return null;
}

const GROUNDED_POLITY_BY_PROVINCE_ID = new Map(
  punicWarsGeoJson.features.flatMap((feature) => feature.properties.kind === "province"
    ? (() => {
        const controllerPolityId = groundedControllerFor(feature);
        return controllerPolityId === null ? [] : [[feature.id, controllerPolityId] as const];
      })()
    : []),
);

function controllerFor(provinceId: string): string | null {
  const italian = ITALIAN_CONTROLLERS[provinceId];
  if (italian !== undefined) return italian;
  const transregionalTribe = TRANSREGIONAL_TRIBAL_CONTROLLERS[provinceId];
  if (transregionalTribe !== undefined) return transregionalTribe;
  const historicalPolity = HISTORICAL_POLITY_BY_PROVINCE_ID.get(provinceId);
  if (historicalPolity !== undefined) return historicalPolity;
  const groundedPolity = GROUNDED_POLITY_BY_PROVINCE_ID.get(provinceId);
  if (groundedPolity !== undefined) return groundedPolity;
  if (provinceId === "punic-gaul-corse-du-sud" || provinceId === "punic-gaul-haute-corse") return "carthage";
  if (provinceId.startsWith("punic-gaul-")) return `gaul-${provinceId.slice("punic-gaul-".length)}`;
  if (provinceId.startsWith("punic-iberia-")) return CARTHAGINIAN_IBERIAN_REGIONS.has(provinceId) ? "carthage" : `iberia-${provinceId.slice("punic-iberia-".length)}`;
  if (provinceId.startsWith("punic-thrace-")) return `thrace-${provinceId.slice("punic-thrace-".length)}`;
  if (provinceId.startsWith("punic-belgica-")) return `belgica-${provinceId.slice("punic-belgica-".length)}`;
  if (provinceId.startsWith("punic-low-countries-")) return `low-countries-${provinceId.slice("punic-low-countries-".length)}`;
  if (provinceId.startsWith("punic-germania-")) return `germania-${provinceId.slice("punic-germania-".length)}`;
  if (provinceId.startsWith("punic-hungary-")) return `hungary-${provinceId.slice("punic-hungary-".length)}`;
  if (provinceId.startsWith("punic-czechoslovakia-")) return `czechoslovakia-${provinceId.slice("punic-czechoslovakia-".length)}`;
  if (provinceId.startsWith("prt-")) return "lusitanians";
  if (provinceId.startsWith("mar-")) return CARTHAGINIAN_MAURETANIAN_COAST.has(provinceId) ? "carthage" : "mauretanian-peoples";
  if (provinceId.startsWith("dza-")) return GAETULIAN_PROVINCES.has(provinceId) ? "gaetuli" : NUMIDIAN_PROVINCES.has(provinceId) ? "numidian-kingdoms" : "carthage";
  if (provinceId.startsWith("tun-")) return "carthage";
  if (provinceId.startsWith("lby-")) return PTOLEMAIC_CYRENAICA_PROVINCES.has(provinceId) ? "ptolemaic-cyrenaica" : GARAMANTIAN_PROVINCES.has(provinceId) ? "garamantes" : "carthage";
  if (provinceId.startsWith("che-")) return "helvetian-peoples";
  if (provinceId.startsWith("aut-")) return "noric-communities";
  if (provinceId === "ita-72843720b81376294924159" || provinceId === "fra-19338628b22604203385446" || CARTHAGINIAN_IBERIAN_REGIONS.has(provinceId)) return "carthage";
  if (provinceId.startsWith("ita-72843720b81376294924159-sicily-")) {
    if (provinceId.endsWith("sicily-southeast")) return "syracuse";
    if (provinceId.endsWith("sicily-northeast")) return "mamertines";
    return "carthage";
  }
  if (provinceId.startsWith("mkd-")) return "macedon";
  return null;
}

function confidenceFor(provinceId: string): HistoricalConfidence {
  if (provinceId.startsWith("punic-britain-")) return "cautious";
  if (provinceId.startsWith("punic-gaul-") || provinceId.startsWith("punic-iberia-") || provinceId.startsWith("punic-illyria-") || provinceId.startsWith("punic-thrace-") || provinceId.startsWith("punic-belgica-") || provinceId.startsWith("punic-low-countries-") || provinceId.startsWith("punic-germania-") || provinceId.startsWith("punic-hungary-") || provinceId.startsWith("punic-czechoslovakia-") || provinceId.startsWith("punic-luxembourg-") || provinceId.startsWith("punic-austria-") || provinceId.startsWith("punic-greece-")) return "medium";
  return "high";
}

function nameFor(controllerPolityId: string, provinceName: string): string {
  return POLITY_NAMES[controllerPolityId]
    ?? (controllerPolityId.startsWith("gaul-") || controllerPolityId.startsWith("iberia-") || controllerPolityId.startsWith("britain-") || controllerPolityId.startsWith("illyria-") || controllerPolityId.startsWith("thrace-") || controllerPolityId.startsWith("belgica-") || controllerPolityId.startsWith("low-countries-") || controllerPolityId.startsWith("germania-") || controllerPolityId.startsWith("hungary-") || controllerPolityId.startsWith("czechoslovakia-") ? provinceName : controllerPolityId);
}

/** Terrain is a local movement description, independent from who rules it. */
function terrainFor(provinceId: string): string {
  if (GAETULIAN_PROVINCES.has(provinceId) || GARAMANTIAN_PROVINCES.has(provinceId)) return "desert-steppe";
  if (provinceId.startsWith("lby-")) return PTOLEMAIC_CYRENAICA_PROVINCES.has(provinceId) ? "coastal-plain" : "desert-steppe";
  if (provinceId.startsWith("tun-") || CARTHAGINIAN_MAURETANIAN_COAST.has(provinceId)) return "coastal-plain";
  if (provinceId.startsWith("mar-") || provinceId.startsWith("dza-")) return NUMIDIAN_PROVINCES.has(provinceId) ? "hills-uplands" : "desert-steppe";
  if (provinceId.startsWith("punic-italy-") || provinceId.startsWith("punic-illyria-") || provinceId.startsWith("punic-thrace-")) return "hills-uplands";
  if (provinceId.includes("black-forest") || provinceId.includes("jura") || provinceId.includes("harz") || provinceId.includes("erzgebirge") || provinceId.includes("sauerland") || provinceId.includes("uplands") || provinceId.includes("heights") || provinceId.includes("passes")) return "mountain-pass";
  if (provinceId.startsWith("punic-gaul-arverni") || provinceId.startsWith("punic-gaul-aedui")) return "hills-uplands";
  if (provinceId.includes("cimbri") || provinceId.includes("coast") || provinceId.includes("mouth") || provinceId.includes("estuary") || provinceId.includes("valley") || provinceId.includes("plain")) return "coastal-plain";
  return "hills-uplands";
}

/**
 * Checked opening map manifest.  Every in-scope polygon has exactly one
 * controller and carries the confidence appropriate to the evidence base.
 */
export const PUNIC_WARS_CONTROL_MANIFEST: readonly PunicWarsControlRecord[] = punicWarsGeoJson.features
  .filter((feature) => feature.properties.kind === "province")
  .flatMap((feature) => {
    const controllerPolityId = controllerFor(feature.id);
    return controllerPolityId === null ? [] : [{
      provinceId: feature.id,
      controllerPolityId,
      confidence: confidenceFor(feature.id),
      sourceNote: feature.id.startsWith("punic-britain-")
        ? "Broad Iron Age cultural region; labels avoid projecting later Roman-era tribal borders backwards."
        : controllerPolityId === "carthage"
          ? "Opening Carthaginian extent follows the supplied scenario reference image."
          : "270 BCE historical-control allocation; see the Punic Wars scenario research notes.",
    }];
  });

const CAPITAL_POLITY_BY_SETTLEMENT: Readonly<Record<string, string>> = {
  "settlement-rome": "rome",
  "settlement-carthage": "carthage",
  "settlement-syracuse": "syracuse",
  "settlement-messana": "mamertines",
  "settlement-cirta": "numidian-kingdoms",
  "settlement-volubilis": "mauretanian-peoples",
  "settlement-garama": "garamantes",
  "settlement-cyrene": "ptolemaic-cyrenaica",
};

const CONTROL_BY_PROVINCE = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
const PUNIC_WARS_MAP_SETTLEMENTS: DynamicMapOverlay["settlements"] = punicWarsGeoJson.features.flatMap((feature) => {
  if (feature.properties.kind !== "settlement") return [];
  const kind = feature.properties.type === "capital"
    ? "city"
    : feature.properties.type === "fort"
      ? "fortress"
      : feature.properties.type;
  const importance = feature.properties.type === "capital" ? 100 : feature.properties.type === "city" ? 80 : feature.properties.type === "port" ? 70 : feature.properties.type === "fort" ? 55 : 40;
  return [{
    settlementId: feature.id,
    provinceId: feature.properties.provinceId,
    anchorFeatureId: feature.id,
    name: feature.properties.name,
    kind,
    controllerPolityId: CONTROL_BY_PROVINCE.get(feature.properties.provinceId) ?? null,
    capitalPolityId: CAPITAL_POLITY_BY_SETTLEMENT[feature.id] ?? null,
    importance,
    underSiege: false,
    damaged: false,
  }];
});

const POLITY_NAME_BY_ID = new Map<string, string>();
for (const record of PUNIC_WARS_CONTROL_MANIFEST) {
  const province = punicWarsGeoJson.features.find((feature) => feature.id === record.provinceId);
  if (province?.properties.kind === "province") POLITY_NAME_BY_ID.set(record.controllerPolityId, nameFor(record.controllerPolityId, province.properties.name));
}

export const PUNIC_WARS_MAP_POLITIES: DynamicMapOverlay["polities"] = [...POLITY_NAME_BY_ID]
  .map(([polityId, name]) => ({ polityId, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** This opening has no tactical or diplomatic ties; Roman client regions are direct Roman territory. */
export const PUNIC_WARS_ROMAN_ALLIANCES: DynamicMapOverlay["politicalRelations"] = [];

export function punicWarsOpeningOverlay(revision: number): DynamicMapOverlay {
  return {
    revision,
    polities: PUNIC_WARS_MAP_POLITIES,
    politicalRelations: PUNIC_WARS_ROMAN_ALLIANCES,
    provinces: PUNIC_WARS_CONTROL_MANIFEST.map((record) => ({
      provinceId: record.provinceId,
      controllerPolityId: record.controllerPolityId,
      controlFirmnessBps: record.controllerPolityId === "carthage" || record.controllerPolityId === "rome" ? 8_500 : 7_000,
      terrainId: terrainFor(record.provinceId),
      tier: "far",
    })),
    settlements: PUNIC_WARS_MAP_SETTLEMENTS,
    forces: [],
    conflicts: { battles: [], sieges: [], wars: [] },
  };
}
