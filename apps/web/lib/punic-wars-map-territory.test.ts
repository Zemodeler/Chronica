import { describe, expect, it } from "vitest";
import { DynamicMapOverlaySchema } from "@chronica/shared";
import { PUNIC_WARS_CONTROL_MANIFEST, PUNIC_WARS_ROMAN_ALLIANCES, punicWarsOpeningOverlay } from "./punic-wars-map-territory";
import { punicWarsGeoJson } from "./punic-wars-geojson";

describe("Punic Wars opening political map", () => {
  it("has one checked controller for every in-scope province without tactical ties", () => {
    const ids = PUNIC_WARS_CONTROL_MANIFEST.map((record) => record.provinceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUNIC_WARS_CONTROL_MANIFEST.length).toBeGreaterThan(250);
    expect(PUNIC_WARS_CONTROL_MANIFEST.every((record) => punicWarsGeoJson.features.some((feature) => feature.id === record.provinceId))).toBe(true);
    expect(PUNIC_WARS_ROMAN_ALLIANCES).toEqual([]);
    expect(DynamicMapOverlaySchema.safeParse(punicWarsOpeningOverlay(0)).success).toBe(true);
  });

  it("makes Roman client regions direct territory of the Roman Republic", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    for (const provinceId of ["punic-italy-samnium", "punic-italy-lucanian-uplands", "punic-italy-bruttian-highlands", "punic-italy-apulian-coast"]) {
      expect(controller.get(provinceId)).toBe("rome");
    }
  });

  it("uses the added northern Italian local territories without changing their polity", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-italy-ligurian-coast")).toBe("ligurians");
    expect(controller.get("punic-italy-insubrian-plain")).toBe("insubres");
    expect(controller.get("punic-italy-middle-padus")).toBe("boii");
    expect(controller.get("punic-italy-venetian-lagoon")).toBe("veneti");
  });

  it("keeps Gaul's local river-basin territories owned independently of their geometry", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-gaul-paris")).toBe("gaul-paris");
    expect(controller.get("punic-gaul-moselle")).toBe("gaul-moselle");
    expect(controller.get("punic-gaul-puy-de-dome")).toBe("gaul-puy-de-dome");
  });

  it("gives the newly partitioned northern and Balkan territories distinct community owners", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    expect(controller.get("punic-illyria-dardani")).toBe("illyria-dardani");
    expect(controller.get("punic-thrace-odrysians")).toBe("thrace-odrysians");
    expect(controller.get("punic-belgica-menapii")).toBe("belgica-menapii");
    expect(controller.get("punic-low-countries-batavi")).toBe("low-countries-batavi");
    expect(controller.get("punic-germania-cherusci")).toBe("germania-cherusci");
    expect(controller.get("punic-hungary-pannonii")).toBe("hungary-pannonii");
    expect(controller.get("punic-czechoslovakia-cotini")).toBe("czechoslovakia-cotini");
    expect(controller.get("punic-luxembourg-treveri")).toBe("germania-treveri");
    expect(overlay.polities.map((polity) => polity.name)).toEqual(expect.arrayContaining(["Dardani", "Odrysians", "Menapii", "Batavi", "Cheruscan Leine", "Pannonii", "Cotini", "Treveri"]));
  });

  it("gives the African and Alpine map actors explicit owners and settlement markers", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    expect(controller.get("dza-43142294b54486011126442")).toBe("numidian-kingdoms");
    expect(controller.get("lby-10800210b23470577588067")).toBe("ptolemaic-cyrenaica");
    expect(controller.get("che-70761945b78940680080703")).toBe("helvetian-peoples");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-utica")?.controllerPolityId).toBe("carthage");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-cirta")?.capitalPolityId).toBe("numidian-kingdoms");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-cyrene")?.capitalPolityId).toBe("ptolemaic-cyrenaica");
  });

  it("uses the supplied Carthaginian opening extent for its island, African, and southern Iberian holdings", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("ita-72843720b81376294924159")).toBe("carthage");
    expect(controller.get("punic-gaul-corse-du-sud")).toBe("carthage");
    expect(controller.get("punic-iberia-andalucia")).toBe("carthage");
    expect(controller.get("punic-iberia-region-de-murcia")).toBe("carthage");
    expect(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-britain-")).every((record) => record.confidence === "cautious")).toBe(true);
  });

  it("assigns terrain by local geography and omits the Rhegium city marker", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const terrain = new Map(overlay.provinces.map((province) => [province.provinceId, province.terrainId]));
    expect(terrain.get("lby-10800210b2800497533490")).toBe("desert-steppe");
    expect(terrain.get("punic-gaul-puy-de-dome")).toBe("hills-uplands");
    expect(terrain.get("punic-germania-erzgebirge")).toBe("mountain-pass");
    expect(terrain.get("punic-germania-cimbri")).toBe("coastal-plain");
    expect(overlay.settlements.some((settlement) => settlement.settlementId === "settlement-rhegium" || settlement.name === "Rhegium")).toBe(false);
  });

  it("gives every reformed French, Iberian, Italian, and Romanian territory one opening controller", () => {
    const controller = new Set(PUNIC_WARS_CONTROL_MANIFEST.map((record) => record.provinceId));
    const reformed = punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "province" && [
      "punic-gaul-", "punic-iberia-", "punic-italy-", "punic-thrace-",
    ].some((prefix) => feature.id.startsWith(prefix)));
    expect(reformed.length).toBeGreaterThan(150);
    expect(reformed.every((feature) => controller.has(feature.id))).toBe(true);
  });
});
