import { describe, expect, it } from "vitest";
import { DynamicMapOverlaySchema } from "@chronica/shared";
import { PUNIC_WARS_CONTROL_MANIFEST, PUNIC_WARS_ROMAN_ALLIANCES, punicWarsOpeningOverlay } from "./punic-wars-map-territory";
import { punicWarsGeoJson } from "./punic-wars-geojson";

describe("Punic Wars opening political map", () => {
  it("has one checked controller for every in-scope province and exposes all alliances", () => {
    const ids = PUNIC_WARS_CONTROL_MANIFEST.map((record) => record.provinceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUNIC_WARS_CONTROL_MANIFEST.length).toBeGreaterThan(250);
    expect(PUNIC_WARS_CONTROL_MANIFEST.every((record) => punicWarsGeoJson.features.some((feature) => feature.id === record.provinceId))).toBe(true);
    expect(PUNIC_WARS_ROMAN_ALLIANCES).toHaveLength(13);
    expect(DynamicMapOverlaySchema.safeParse(punicWarsOpeningOverlay(0)).success).toBe(true);
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
