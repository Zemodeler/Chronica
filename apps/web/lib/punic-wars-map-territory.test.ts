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
    for (const provinceId of ["punic-italy-samnium", "punic-italy-lucanians", "punic-italy-bruttians", "punic-italy-tarentines"]) {
      expect(controller.get(provinceId)).toBe("rome");
    }
  });

  it("uses the added northern Italian local territories without changing their polity", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-italy-liguria-genua")).toBe("ligurians");
    expect(controller.get("punic-italy-insubria-mediolanum")).toBe("insubres");
    expect(controller.get("punic-italy-cenomani-brixia")).toBe("cenomani");
    expect(controller.get("punic-italy-veneti-patavium")).toBe("veneti");
  });

  it("splits the Aulerci into three owned territories rather than retaining one multipart region", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-gaul-aulerci-eburovices")).toBe("gaul-aulerci-eburovices");
    expect(controller.get("punic-gaul-aulerci-cenomani")).toBe("gaul-aulerci-cenomani");
    expect(controller.get("punic-gaul-aulerci-diablintes")).toBe("gaul-aulerci-diablintes");
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
    expect(overlay.polities.map((polity) => polity.name)).toEqual(expect.arrayContaining(["Dardani", "Odrysians", "Menapii", "Batavi", "Cherusci", "Pannonii", "Cotini", "Treveri"]));
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
    expect(controller.get("fra-19338628b22604203385446")).toBe("carthage");
    expect(controller.get("punic-iberia-turdetani")).toBe("carthage");
    expect(controller.get("punic-iberia-bastetani")).toBe("carthage");
    expect(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-britain-")).every((record) => record.confidence === "cautious")).toBe(true);
  });
});
