import "server-only";

import type { DynamicMapOverlay } from "@chronica/shared";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";

/**
 * Political control/sphere shown at the opening of 264 BCE. This intentionally
 * represents Carthage's western-Mediterranean empire and dependent coastal
 * territories, not modern national borders or later Barcid conquests.
 */
const CARTHAGINIAN_REGION_PREFIXES = ["tun-", "dza-", "mar-", "lby-"] as const;
const CARTHAGINIAN_ISLAND_AND_IBERIAN_REGION_IDS = new Set([
  "ita-72843720b81376294924159", // Sardinia and minor islands
  "fra-19338628b22604203385446", // Corsica
  "esp-25490228b88831207743232", // Andalusia / Gades
  "esp-25490228b27950689864224", // Murcia
  "esp-25490228b14384488423733", // Valencian coast
  "esp-25490228b26609846683583", // Balearics
]);

export const FIRST_PUNIC_CARTHAGINIAN_PROVINCE_IDS = europeNorthAfricaGeoJson.features
  .filter((feature) => feature.properties.kind === "province")
  .map((feature) => feature.id)
  .filter((id) => CARTHAGINIAN_REGION_PREFIXES.some((prefix) => id.startsWith(prefix)) || CARTHAGINIAN_ISLAND_AND_IBERIAN_REGION_IDS.has(id));

export const FIRST_PUNIC_CARTHAGINIAN_OVERLAY: DynamicMapOverlay["provinces"] = FIRST_PUNIC_CARTHAGINIAN_PROVINCE_IDS.map((provinceId) => ({
  provinceId,
  controllerPolityId: "carthage",
  controlFirmnessBps: 8_500,
  terrainId: "coastal-plain",
}));

export const FIRST_PUNIC_SICILY_OVERLAY: DynamicMapOverlay["provinces"] = [
  { provinceId: "ita-72843720b81376294924159-sicily-west", controllerPolityId: "carthage", controlFirmnessBps: 8_000, terrainId: "coastal-plain" },
  { provinceId: "ita-72843720b81376294924159-sicily-northwest", controllerPolityId: "carthage", controlFirmnessBps: 7_500, terrainId: "hills" },
  { provinceId: "ita-72843720b81376294924159-sicily-central", controllerPolityId: "carthage", controlFirmnessBps: 7_000, terrainId: "hills" },
  // Hieron II's kingdom at the opening: Syracuse's south-eastern hinterland.
  { provinceId: "ita-72843720b81376294924159-sicily-southeast", controllerPolityId: "syracuse", controlFirmnessBps: 8_500, terrainId: "coastal-plain" },
  { provinceId: "ita-72843720b81376294924159-sicily-northeast", controllerPolityId: "rome", controlFirmnessBps: 7_000, terrainId: "coastal-plain" },
];
