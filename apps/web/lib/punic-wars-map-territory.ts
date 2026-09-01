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
  "punic-italy-liguria": "ligurians",
  "punic-italy-insubria": "insubres",
  "punic-italy-boii": "boii",
  "punic-italy-cenomani": "cenomani",
  "punic-italy-veneti": "veneti",
  "punic-italy-etruria": "etruscan-cities",
  "punic-italy-latium": "rome",
  "punic-italy-sabines": "sabines",
  "punic-italy-umbrians": "umbrians",
  "punic-italy-picentes": "picentes",
  "punic-italy-marsi": "marsi-paeligni",
  "punic-italy-campania": "campanians",
  "punic-italy-samnium": "samnites",
  "punic-italy-daunians": "daunians",
  "punic-italy-peucetians": "peucetians",
  "punic-italy-messapians": "messapians",
  "punic-italy-tarentines": "tarentines",
  "punic-italy-lucanians": "lucanians",
  "punic-italy-bruttians": "bruttians",
  "punic-italy-rhegines": "rhegines",
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
  lusitanians: "Lusitanian peoples",
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

const ROMAN_ALLY_IDS = [
  "sabines", "umbrians", "picentes", "marsi-paeligni", "campanians", "samnites", "daunians", "peucetians", "messapians", "tarentines", "lucanians", "bruttians", "rhegines",
] as const;

function controllerFor(provinceId: string): string | null {
  const italian = ITALIAN_CONTROLLERS[provinceId];
  if (italian !== undefined) return italian;
  if (provinceId.startsWith("punic-gaul-")) return `gaul-${provinceId.slice("punic-gaul-".length)}`;
  if (provinceId.startsWith("punic-britain-")) return `britain-${provinceId.slice("punic-britain-".length)}`;
  if (provinceId.startsWith("punic-iberia-")) return CARTHAGINIAN_IBERIAN_REGIONS.has(provinceId) ? "carthage" : `iberia-${provinceId.slice("punic-iberia-".length)}`;
  if (provinceId.startsWith("prt-")) return "lusitanians";
  if (provinceId.startsWith("mar-") || provinceId.startsWith("dza-") || provinceId.startsWith("tun-") || provinceId.startsWith("lby-")) return "carthage";
  if (provinceId === "ita-72843720b81376294924159" || provinceId === "fra-19338628b22604203385446" || CARTHAGINIAN_IBERIAN_REGIONS.has(provinceId)) return "carthage";
  if (provinceId.startsWith("ita-72843720b81376294924159-sicily-")) {
    if (provinceId.endsWith("sicily-southeast")) return "syracuse";
    if (provinceId.endsWith("sicily-northeast")) return "mamertines";
    return "carthage";
  }
  const greek = GREEK_CONTROLLERS[provinceId];
  if (greek !== undefined) return greek;
  if (provinceId.startsWith("alb-") || provinceId.startsWith("mne-") || provinceId.startsWith("hrv-") || provinceId.startsWith("bih-") || provinceId.startsWith("svn-")) return "illyrian-communities";
  if (provinceId.startsWith("mkd-")) return "macedon";
  if (provinceId.startsWith("bgr-") || provinceId.startsWith("rou-") || provinceId.startsWith("srb-")) return "thracian-communities";
  return null;
}

function confidenceFor(provinceId: string): HistoricalConfidence {
  if (provinceId.startsWith("punic-britain-")) return "cautious";
  if (provinceId.startsWith("punic-gaul-") || provinceId.startsWith("punic-iberia-")) return "medium";
  return "high";
}

function nameFor(controllerPolityId: string, provinceName: string): string {
  return POLITY_NAMES[controllerPolityId]
    ?? (controllerPolityId.startsWith("gaul-") || controllerPolityId.startsWith("iberia-") || controllerPolityId.startsWith("britain-") ? provinceName : controllerPolityId);
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

const POLITY_NAME_BY_ID = new Map<string, string>();
for (const record of PUNIC_WARS_CONTROL_MANIFEST) {
  const province = punicWarsGeoJson.features.find((feature) => feature.id === record.provinceId);
  if (province?.properties.kind === "province") POLITY_NAME_BY_ID.set(record.controllerPolityId, nameFor(record.controllerPolityId, province.properties.name));
}

export const PUNIC_WARS_MAP_POLITIES: DynamicMapOverlay["polities"] = [...POLITY_NAME_BY_ID]
  .map(([polityId, name]) => ({ polityId, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const PUNIC_WARS_ROMAN_ALLIANCES: DynamicMapOverlay["politicalRelations"] = ROMAN_ALLY_IDS.map((memberPolityId) => ({
  id: `rome-alliance-${memberPolityId}`,
  kind: "alliance",
  leaderPolityId: "rome",
  memberPolityId,
  sourceNote: "Roman Italian alliance at the 270 BCE opening; visible context only, with no automatic military effect.",
}));

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
    settlements: [],
    forces: [],
    conflicts: { battles: [], sieges: [], wars: [] },
  };
}
