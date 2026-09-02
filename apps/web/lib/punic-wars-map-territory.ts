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
  "punic-italy-liguria-west": "ligurians", "punic-italy-liguria-genua": "ligurians", "punic-italy-liguria-east": "ligurians",
  "punic-italy-insubria-ticinum": "insubres", "punic-italy-insubria-mediolanum": "insubres",
  "punic-italy-boii-rhenus": "boii", "punic-italy-boii-felsina": "boii",
  "punic-italy-cenomani-brixia": "cenomani", "punic-italy-cenomani-mincius": "cenomani",
  "punic-italy-veneti-ateste": "veneti", "punic-italy-veneti-patavium": "veneti", "punic-italy-veneti-adria": "veneti",
  "punic-italy-etruria-north": "etruscan-cities", "punic-italy-etruria-central": "etruscan-cities", "punic-italy-etruria-south": "etruscan-cities",
  "punic-italy-latium": "rome",
  "punic-italy-sabines": "rome",
  "punic-italy-umbrians": "rome",
  "punic-italy-picentes": "rome",
  "punic-italy-marsi": "rome",
  "punic-italy-campania": "rome",
  "punic-italy-samnium": "rome",
  "punic-italy-daunians": "rome",
  "punic-italy-peucetians": "rome",
  "punic-italy-messapians": "rome",
  "punic-italy-tarentines": "rome",
  "punic-italy-lucanians": "rome",
  "punic-italy-bruttians": "rome",
  "punic-italy-rhegines": "rome",
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
};

const CARTHAGINIAN_IBERIAN_REGIONS = new Set([
  "punic-iberia-turdetani",
  "punic-iberia-turduli",
  "punic-iberia-celtici",
  "punic-iberia-conii",
  "punic-iberia-bastetani",
  "punic-iberia-contestani",
  "punic-iberia-edetani",
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
const GREEK_CONTROLLERS: Readonly<Record<string, string>> = {
  "grc-93993887b93147517098288": "macedon",
  "grc-93993887b75841959134679": "epirus",
  "grc-93993887b88980272284763": "athens",
  "grc-93993887b43116936981453": "achaean-league",
  "grc-93993887b20638565859558": "thessalian-league",
  "grc-93993887b64949910323779": "hellenic-islanders",
  "grc-93993887b85814589700959": "hellenic-islanders",
  "grc-93993887b40019078264500": "hellenic-islanders",
};

function controllerFor(provinceId: string): string | null {
  const italian = ITALIAN_CONTROLLERS[provinceId];
  if (italian !== undefined) return italian;
  if (provinceId.startsWith("punic-gaul-")) return `gaul-${provinceId.slice("punic-gaul-".length)}`;
  if (provinceId.startsWith("punic-britain-")) return `britain-${provinceId.slice("punic-britain-".length)}`;
  if (provinceId.startsWith("punic-iberia-")) return CARTHAGINIAN_IBERIAN_REGIONS.has(provinceId) ? "carthage" : `iberia-${provinceId.slice("punic-iberia-".length)}`;
  if (provinceId.startsWith("punic-illyria-")) return `illyria-${provinceId.slice("punic-illyria-".length)}`;
  if (provinceId.startsWith("punic-thrace-")) return `thrace-${provinceId.slice("punic-thrace-".length)}`;
  if (provinceId.startsWith("punic-belgica-")) return `belgica-${provinceId.slice("punic-belgica-".length)}`;
  if (provinceId.startsWith("punic-low-countries-")) return `low-countries-${provinceId.slice("punic-low-countries-".length)}`;
  if (provinceId.startsWith("punic-germania-")) return `germania-${provinceId.slice("punic-germania-".length)}`;
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
  const greek = GREEK_CONTROLLERS[provinceId];
  if (greek !== undefined) return greek;
  if (provinceId.startsWith("mkd-")) return "macedon";
  return null;
}

function confidenceFor(provinceId: string): HistoricalConfidence {
  if (provinceId.startsWith("punic-britain-")) return "cautious";
  if (provinceId.startsWith("punic-gaul-") || provinceId.startsWith("punic-iberia-") || provinceId.startsWith("punic-illyria-") || provinceId.startsWith("punic-thrace-") || provinceId.startsWith("punic-belgica-") || provinceId.startsWith("punic-low-countries-") || provinceId.startsWith("punic-germania-")) return "medium";
  return "high";
}

function nameFor(controllerPolityId: string, provinceName: string): string {
  return POLITY_NAMES[controllerPolityId]
    ?? (controllerPolityId.startsWith("gaul-") || controllerPolityId.startsWith("iberia-") || controllerPolityId.startsWith("britain-") || controllerPolityId.startsWith("illyria-") || controllerPolityId.startsWith("thrace-") || controllerPolityId.startsWith("belgica-") || controllerPolityId.startsWith("low-countries-") || controllerPolityId.startsWith("germania-") ? provinceName : controllerPolityId);
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
      terrainId: "coastal-plain",
      tier: "far",
    })),
    settlements: PUNIC_WARS_MAP_SETTLEMENTS,
    forces: [],
    conflicts: { battles: [], sieges: [], wars: [] },
  };
}
