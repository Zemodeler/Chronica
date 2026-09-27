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
  "punic-italy-ligurian-coast": "ligurians", "punic-italy-upper-padus-and-alpine-gate": "taurini", "punic-italy-insubrian-plain": "insubres",
  "punic-italy-middle-padus": "boii", "punic-italy-venetian-lagoon": "veneti", "punic-italy-isonzo-gate": "veneti",
  // Rome governs Latium and Campania; the rest are its allies by foedus
  // (packages/db/src/punic-wars-scenario.ts, `alliedItaly`).
  "punic-italy-etrurian-uplands": "etruscan-cities", "punic-italy-umbrian-valleys": "umbrians", "punic-italy-picenum-coast": "picentes",
  "punic-italy-latium": "rome", "punic-italy-marsian-highlands": "marsi-paeligni", "punic-italy-samnium": "samnites",
  "punic-italy-campanian-plain": "rome", "punic-italy-apulian-coast": "apulian-cities", "punic-italy-lucanian-uplands": "lucanians", "punic-italy-bruttian-highlands": "bruttians",
  "punic-italy-sallentine-peninsula": "messapians",
  // Aosta is the Salassi's valley and the Adige the Raeti's: the western and
  // central Alps, a long way from Noricum.
  "punic-italy-alpine-passes": "salassi", "punic-italy-adige-passes": "raeti",
};

const POLITY_NAMES: Record<string, string> = {
  rome: "Roman Republic",
  carthage: "Carthage",
  syracuse: "Kingdom of Syracuse",
  mamertines: "Mamertines of Messana",
  ligurians: "Ligurian peoples",
  taurini: "Taurini",
  salassi: "Salassi",
  raeti: "Raeti",
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
  "apulian-cities": "Apulian cities",
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
  macedon: "Kingdom of Macedon",
  epirus: "Kingdom of Epirus",
  athens: "Athens",
  "achaean-league": "Achaean League",
  "aetolian-league": "Aetolian League",
  "illyrian-communities": "Illyrian communities",
  "thracian-communities": "Thracian communities",
  // Magas broke with Ptolemy II c. 276 and ruled Cyrene as its king until c. 250.
  cyrene: "Kingdom of Cyrene",
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
  "gaul-santones": "Santones",
  "gaul-pictones": "Pictones",
  "gaul-lemovices": "Lemovices",
  "gaul-petrocorii": "Petrocorii",
  "gaul-cadurci": "Cadurci",
  "gaul-volcae": "Volcae",
  "gaul-allobroges": "Allobroges",
  "gaul-salyens": "Salyens",
  massalia: "Massalia",
  "germania-ubii": "Ubii",
  "germania-vindelici": "Vindelici",
  "germania-semnones": "Semnones",
  "germania-chauci": "Chauci",
  "germania-chatti": "Chatti",
  "germania-cherusci": "Cherusci",
  "germania-bructeri": "Bructeri",
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
  "iberia-turdetani": "Turdetani",
  "iberia-edetani": "Edetani",
  "iberia-contestani": "Contestani",
  "balearic-islanders": "Balearic islanders",
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
  "low-countries-rhine-delta": "Rhine delta peoples",
  "britain-caledonian-communities": "Caledonian communities",
  "britain-northern-britons": "Northern Britons",
  "britain-welsh-communities": "Western Britons",
  "britain-southwestern-britons": "South-western Britons",
  "britain-thames-britons": "Thames Basin Britons",
  "britain-eastern-britons": "Eastern Britons",
  "britain-midland-britons": "Midland Britons",
  "ireland-ulster-communities": "Ulster communities",
  acarnania: "Acarnanian League",
  "boeotian-league": "Boeotian League",
  "phocian-league": "Phocian League",
  "arcadian-league": "Arcadian cities",
  "euboean-cities": "Euboean cities",
  "ionian-islands": "Ionian Islands",
  // The Nesiotic League, under Ptolemaic hegemony since c. 287.
  "cycladic-islanders": "League of the Islanders",
  rhodes: "Rhodes",
  "aeolis-communities": "Aeolis",
  "ionia-communities": "Ionia",
  "cretan-cities-west": "Western Crete",
  "cretan-cities-east": "Eastern Crete",
  argos: "Argos",
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
  ["gaul-belgae", ["Marne"]],
  ["gaul-treveri", ["Meuse", "Mosella Valley", "Meurthe-et-Moselle", "Vosges Passes", "Saar Coal Hills", "Mosella–Rhenus Confluence", "Treveran Mosella"]],
  ["gaul-sequani", ["Haute-Marne", "Haute-Saône", "Doubs", "Jura", "Territoire de Belfort", "Lower Rhenus Terrace"]],
  ["gaul-aedui", ["Ain", "Côte-d'Or", "Arar Heights", "Nièvre", "Yonne", "Loire", "Rhône"]],
  ["gaul-arverni", ["Allier", "Arvernian Cones", "Cantal", "Haute-Loire", "Creuse", "Corrèze", "Lozère", "Aveyron"]],
  ["gaul-bituriges", ["Cher", "Indre", "Loir-et-Cher", "Loiret", "Eure-et-Loir", "Indre-et-Loire "]],
  ["gaul-sequana-peoples", ["Lutetian Island", "Seine-et-Marne", "Yvelines", "Essonne", "Hauts-de-Seine", "Seine-Saint-Denis", "Val-de-Marne", "Val-d'Oise", "Aube", "Eure", "Seine-Maritime"]],
  // The Aquitani lived between the Garonne and the Pyrenees; north of the
  // river the peoples were Celtic.
  ["gaul-aquitani", ["Gironde", "Landes", "Lot-et-Garonne", "Gers", "Hautes-Pyrénées", "Pyrénées-Atlantiques"]],
  ["gaul-santones", ["Charente", "Charente-Maritime"]],
  ["gaul-pictones", ["Vienne", "Deux-Sèvres"]],
  ["gaul-lemovices", ["Haute-Vienne"]],
  ["gaul-petrocorii", ["Dordogne"]],
  ["gaul-cadurci", ["Lot"]],
  ["gaul-volcae", ["Ariège", "Aude", "Gard", "Hérault", "Haute-Garonne", "Pyrénées-Orientales", "Tarn", "Tarn-et-Garonne"]],
  ["gaul-allobroges", ["Isère", "Drôme", "Ardèche", "Savoie", "Haute-Savoie"]],
  ["ligurians", ["Alpes-de-Haute-Provence", "Hautes-Alpes", "Alpes-Maritimes", "Var"]],
  ["gaul-salyens", ["Vaucluse"]],
  ["massalia", ["Rhodanus Delta"]],

  // The south-west was Celtic in 270: the Helvetii held the land between the
  // Rhine, the Main and the Hercynian forest (Tacitus, Germania 28), and the
  // Suebi reached it only with Ariovistus. North Bavaria faced Boian Bohemia.
  ["helvetian-peoples", ["Neckar Uplands", "Black Forest Gate", "Swabian Jura", "Middle Moenus", "Lower Moenus", "Moenus–Rhenus Gate", "Upper Rhenus Bend"]],
  ["boii-middle-danube", ["Naab Uplands", "Franconian Forest", "Boii of the Danube"]],
  ["germania-ubii", ["Upper Rhenus Terrace", "Ubian Lower Rhenus", "Rhenus Gorge"]],
  ["germania-vindelici", ["Upper Isar Country", "Vindelician Lech"]],
  ["germania-semnones", ["Spree–Havel Confluence", "Semnonian March", "Albis Heath", "Middle Albis", "Upper Albis Valley"]],
  ["germania-chauci", ["Visurgis Mouth", "Albis Mouth", "Baltic Lagoons"]],
  ["germania-chatti", ["Chattian Lahn", "Upper Visurgis", "Harz Foreland"]],
  ["germania-cherusci", ["Cheruscan Leine", "Teutoburg Ridge"]],
  ["germania-bructeri", ["Bructerian Plain", "Sauerland Heights"]],
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
  // Before the Barcid conquest (237 on) Carthage held no Iberian territory,
  // only Gades as an ally and the Punic ports; see SETTLEMENT_CONTROLLERS.
  ["iberia-turdetani", ["Andalucía"]],
  ["iberia-edetani", ["Comunitat Valenciana"]],
  ["iberia-contestani", ["Región de Murcia"]],
  ["balearic-islanders", ["Illes Balears"]],
  ["mauretanian-peoples", ["Ciudad Autónoma de Ceuta", "Ciudad Autónoma de Melilla"]],

  ["thrace-dacian-highland-communities", ["ALBA", "ARAD", "BIHOR", "TIMIS", "BISTRITA-NASAUD", "BRASOV", "CARAS-SEVERIN", "CLUJ", "COVASNA", "GORJ", "HARGHITA", "HUNEDOARA", "MARAMURES", "MURES", "SALAJ", "SATU MARE", "SIBIU", "MEHEDINTI", "VALCEA"]],
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
  "punic-luxembourg-treveri": "gaul-treveri",
  // Alsace's southern terrace shares its polygon name with the German bank's.
  "punic-gaul-haut-rhin": "gaul-sequani",
  // The Batavi and Cananefates split from the Chatti in the 1st century BCE,
  // and the Aduatuci descend from the Cimbri and Teutones (c. 103 BCE).
  "punic-low-countries-batavi": "low-countries-rhine-delta",
  "punic-low-countries-cananefates": "low-countries-rhine-delta",
  "punic-belgica-aduatuci": "belgica-eburones",
  "punic-czechoslovakia-eastern-carpathian-communities": "carpathian-communities",
};

/**
 * Carthage's Algerian coast: the strip of Punic ports (Hippo Regius, Rusicade,
 * Igilgili, Saldae, Icosium, Iol, Cartennae, Siga's shore). Carthage held the
 * harbours, never the hinterland -- every other Algerian province is Numidian
 * or, south of the Atlas, Gaetulian.
 */
const CARTHAGINIAN_ALGERIAN_COAST = new Set([
  "dza-43142294b15861145285183", // El Tarf
  "dza-43142294b62233719624556", // Annaba
  "dza-43142294b45005324618688", // Skikda
  "dza-43142294b41901445774444", // Jijel
  "dza-43142294b58957670986273", // Bejaia
  "dza-43142294b98012200258451", // Boumerdès
  "dza-43142294b57836115778835", // Algiers
  "dza-43142294b44506325294932", // Tipaza
  "dza-43142294b40291105422873", // Chlef
  "dza-43142294b83605883333857", // Mostaganem
  "dza-43142294b89431929839902", // Oran
  "dza-43142294b30165394777555", // Aïn Témouchent
]);
const GAETULIAN_PROVINCES = new Set([
  "dza-43142294b97480278452280", "dza-43142294b70824426814000", "dza-43142294b43473078766346",
  "dza-43142294b57632161166824", "dza-43142294b83676700490594", "dza-43142294b80449327613638",
  "dza-43142294b23379165901565", "dza-43142294b64493603110073", "dza-43142294b58874984978475",
  "dza-43142294b74351585751074", "dza-43142294b66953226377953", "dza-43142294b26097348484504",
  "dza-43142294b6851000275455", // El Oued
  // The chotts and the desert south of Carthage's African territory.
  "tun-13205935b95771050896452", // Tozeur
  "tun-13205935b11721331776240", // Kébili
  "tun-13205935b85172640982228", // Tataouine
]);
/** Carthage reached Theveste only c. 247 (Hanno the Great); the high steppe beyond its border was Numidian. */
const NUMIDIAN_TUNISIAN_PROVINCES = new Set([
  "tun-13205935b54080015312342", // Gafsa (Capsa)
  "tun-13205935b52637504718586", // Kasserine
]);
/** Only for terrain: the Atlantic and Mediterranean shore of Mauretania, which Carthage traded along but did not hold. */
const MAURETANIAN_COAST = new Set([
  "mar-70788906b66040098455254", "mar-70788906b40056535803135", "mar-70788906b33851053053385", "mar-70788906b15955360211262",
]);
const CYRENE_PROVINCES = new Set([
  "lby-10800210b28216506156245", "lby-10800210b39782956615971", "lby-10800210b23470577588067",
  "lby-10800210b54463644997685", "lby-10800210b74925506200485",
  "lby-10800210b44488917334986", // Al Qubbah, in the Jebel Akhdar east of Cyrene itself
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

/**
 * Every Greek political entity in the 270 BCE opening is now a single merged
 * province (see GREEK_METRO_REGION_GROUPS): the four northern kingdoms each
 * split into several broad sub-regions, every southern/Aegean league,
 * city-state, and island group collapsed into exactly one region apiece. So
 * geometry and politics line up 1:1 — this is a straight name lookup, not a
 * lon/lat reconstruction.
 */
const GREEK_PROVINCE_POLITY_BY_NAME: Readonly<Record<string, string>> = {
  // Macedon
  "Upper Macedonia": "macedon", Bottiaea: "macedon", Pieria: "macedon", Amphaxitis: "macedon", Chalcidice: "macedon", Bisaltia: "macedon",
  // Thessaly, Antigonid since Demetrius; Demetrias in Magnesia was a royal city.
  Perrhaebia: "macedon", Trikala: "macedon", Magnesia: "macedon", Sporades: "macedon",
  // Epirus
  Molossia: "epirus", Thesprotia: "epirus", Ambracia: "epirus", Preveza: "epirus",
  // Aegean Thrace
  Xanthi: "thracian-communities", Rodopi: "thracian-communities", Evros: "thracian-communities", Nestos: "thracian-communities",
  // Central and southern Greece
  // Acrocorinth and Chalcis were two of Gonatas's "fetters of Greece"; Thebes
  // had rejoined the Boeotian League c. 287.
  Athens: "athens", Acarnania: "acarnania", Achaea: "achaean-league", Aetolia: "aetolian-league", Arcadia: "arcadian-league",
  Argos: "argos", Boeotia: "boeotian-league", Thebes: "boeotian-league", Corinthia: "macedon", Elis: "elis", Euboea: "macedon",
  Messenia: "messenia", Phocis: "phocian-league", Sparta: "sparta", Megalopolis: "megalopolis",
  // Aegean and Ionian islands
  "Eastern Crete": "cretan-cities-east", "Western Crete": "cretan-cities-west", Cyclades: "cycladic-islanders",
  Rhodes: "rhodes", Aeolis: "aeolis-communities", Ionia: "ionia-communities", "Ionian Islands": "ionian-islands",
};

function greekControllerFor(feature: (typeof punicWarsGeoJson.features)[number]): string {
  const name = feature.properties.name;
  const polityId = name === undefined ? undefined : GREEK_PROVINCE_POLITY_BY_NAME[name];
  if (polityId === undefined) throw new Error(`Unrecognised Greek province name "${name ?? feature.id}" — add it to GREEK_PROVINCE_POLITY_BY_NAME.`);
  return polityId;
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
    // Ulster is Irish, not British: its districts sit west of the North
    // Channel, between the Mournes and the Causeway coast.
    if (longitude < -5.5 && latitude > 54 && latitude < 55.4) return "ireland-ulster-communities";
    if (latitude >= 54.7) return "britain-northern-britons";
    // Cornwall and Scilly were Dumnonian, with Devon.
    if (latitude < 50.8) return "britain-southwestern-britons";
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
  if (provinceId.startsWith("punic-iberia-")) return `iberia-${provinceId.slice("punic-iberia-".length)}`;
  if (provinceId.startsWith("punic-thrace-")) return `thrace-${provinceId.slice("punic-thrace-".length)}`;
  if (provinceId.startsWith("punic-belgica-")) return `belgica-${provinceId.slice("punic-belgica-".length)}`;
  if (provinceId.startsWith("punic-low-countries-")) return `low-countries-${provinceId.slice("punic-low-countries-".length)}`;
  if (provinceId.startsWith("punic-germania-")) return `germania-${provinceId.slice("punic-germania-".length)}`;
  if (provinceId.startsWith("punic-hungary-")) return `hungary-${provinceId.slice("punic-hungary-".length)}`;
  if (provinceId.startsWith("punic-czechoslovakia-")) return `czechoslovakia-${provinceId.slice("punic-czechoslovakia-".length)}`;
  if (provinceId.startsWith("prt-")) return "lusitanians";
  if (provinceId.startsWith("mar-")) return "mauretanian-peoples";
  if (provinceId.startsWith("dza-")) return GAETULIAN_PROVINCES.has(provinceId) ? "gaetuli" : CARTHAGINIAN_ALGERIAN_COAST.has(provinceId) ? "carthage" : "numidian-kingdoms";
  if (provinceId.startsWith("tun-")) return GAETULIAN_PROVINCES.has(provinceId) ? "gaetuli" : NUMIDIAN_TUNISIAN_PROVINCES.has(provinceId) ? "numidian-kingdoms" : "carthage";
  if (provinceId.startsWith("lby-")) return CYRENE_PROVINCES.has(provinceId) ? "cyrene" : GARAMANTIAN_PROVINCES.has(provinceId) ? "garamantes" : "carthage";
  if (provinceId.startsWith("che-")) return "helvetian-peoples";
  if (provinceId.startsWith("aut-")) return "noric-communities";
  if (provinceId === "ita-72843720b81376294924159" || provinceId === "fra-19338628b22604203385446") return "carthage";
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
// Greek terrain follows the same political reconstruction rather than a
// separate geometry pass: island leagues sit on their own island/coastal
// terrain, the mountainous western and central leagues get a pass/upland
// terrain, and the rest (river plains, the Argolid, Attica, the Macedonian
// coastal lowlands) read as ordinary coastal plain.
const GREEK_ISLAND_POLITIES = new Set([
  "ionian-islands", "cycladic-islanders", "rhodes", "aeolis-communities", "ionia-communities", "cretan-cities-west", "cretan-cities-east",
]);
const GREEK_MOUNTAIN_POLITIES = new Set(["epirus", "arcadian-league", "aetolian-league", "phocian-league"]);

function terrainFor(provinceId: string): string {
  if (GAETULIAN_PROVINCES.has(provinceId) || GARAMANTIAN_PROVINCES.has(provinceId)) return "desert-steppe";
  if (provinceId.startsWith("lby-")) return CYRENE_PROVINCES.has(provinceId) ? "coastal-plain" : "desert-steppe";
  if (provinceId.startsWith("tun-") || MAURETANIAN_COAST.has(provinceId) || CARTHAGINIAN_ALGERIAN_COAST.has(provinceId)) return "coastal-plain";
  if (provinceId.startsWith("mar-") || provinceId.startsWith("dza-")) return controllerFor(provinceId) === "numidian-kingdoms" ? "hills-uplands" : "desert-steppe";
  if (provinceId.startsWith("punic-greece-")) {
    const polity = GROUNDED_POLITY_BY_PROVINCE_ID.get(provinceId);
    if (polity !== undefined && GREEK_ISLAND_POLITIES.has(polity)) return "island-coastal";
    if (polity !== undefined && GREEK_MOUNTAIN_POLITIES.has(polity)) return "mountain-pass";
    return "coastal-plain";
  }
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

export const CAPITAL_POLITY_BY_SETTLEMENT: Readonly<Record<string, string>> = {
  "settlement-rome": "rome",
  "settlement-carthage": "carthage",
  "settlement-syracuse": "syracuse",
  "settlement-messana": "mamertines",
  "settlement-cirta": "numidian-kingdoms",
  "settlement-volubilis": "mauretanian-peoples",
  "settlement-garama": "garamantes",
  "settlement-cyrene": "cyrene",
  "settlement-pella": "macedon",
  "settlement-athens": "athens",
};

/**
 * Towns held by someone other than the people around them. Gades was Carthage's
 * ally and Ebusus a Punic colony while their hinterlands were Turdetanian and
 * Talayotic; Numantia was the Arevaci's, a Celtiberian people, standing in the
 * Vaccaei's province.
 */
const SETTLEMENT_CONTROLLERS: Readonly<Record<string, string>> = {
  // Rome's Latin colonies, its garrisons inside its allies' lands.
  "settlement-cosa": "rome",
  "settlement-narnia": "rome",
  "settlement-alba-fucens": "rome",
  "settlement-luceria": "rome",
  "settlement-venusia": "rome",
  "settlement-rhegium": "rhegium-campanians",
  "settlement-gades": "carthage",
  "settlement-ebusus": "carthage",
  "settlement-numantia": "iberia-celtiberi",
};

export function settlementControllerFor(settlementId: string, provinceId: string): string | null {
  return SETTLEMENT_CONTROLLERS[settlementId] ?? CONTROL_BY_PROVINCE.get(provinceId) ?? null;
}

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
    controllerPolityId: settlementControllerFor(feature.id, feature.properties.provinceId),
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

/** Rome's allies by foedus, as the map's standing panel names them. Mirrors the scenario's `alliedItaly`. */
export const PUNIC_WARS_ROMAN_ALLIANCES: DynamicMapOverlay["politicalRelations"] = [
  "etruscan-cities", "umbrians", "picentes", "marsi-paeligni", "samnites", "lucanians", "bruttians", "apulian-cities",
].map((memberPolityId) => ({ id: `foedus-${memberPolityId}`, kind: "alliance" as const, leaderPolityId: "rome", memberPolityId, sourceNote: "Allied to Rome by foedus: soldiers for Rome's wars, no tribute, no war or peace of their own." }));

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
