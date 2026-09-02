import { describe, expect, it } from "vitest";
import { GeoJsonMapSchema } from "@chronica/shared";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";
import { PUNIC_WARS_REGION_COUNTS, punicWarsGeoJson } from "./punic-wars-geojson";

function outerArea(feature: (typeof punicWarsGeoJson.features)[number]): number {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [];
  return polygons.reduce((total, polygon) => total + polygon[0]!.slice(1).reduce((area, point, index) => {
    const previous = polygon[0]![index]!;
    return area + previous[0] * point[1] - point[0] * previous[1];
  }, 0) / 2, 0);
}

function sourceArea(ids: ReadonlySet<string>): number {
  return europeNorthAfricaGeoJson.features.filter((feature) => ids.has(feature.id)).reduce((sum, feature) => sum + outerArea(feature), 0);
}

function derivedArea(prefix: string): number {
  return punicWarsGeoJson.features.filter((feature) => feature.id.startsWith(prefix)).reduce((sum, feature) => sum + outerArea(feature), 0);
}

describe("Punic Wars historical GeoJSON", () => {
  it("is schema-valid and preserves the base map outside deliberate replacements", () => {
    expect(GeoJsonMapSchema.safeParse(punicWarsGeoJson).success).toBe(true);
    expect(punicWarsGeoJson.features.some((feature) => feature.id === "ita-local-23120603B86473916475875")).toBe(false);
    expect(punicWarsGeoJson.features.some((feature) => feature.id === "gbr-14339913b95766344400054")).toBe(false);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-gaul-") && feature.properties.kind === "province")).toHaveLength(96);
  });

  it("creates the agreed historical region counts with no lost outer area", () => {
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-italy-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.italy);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-gaul-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.gaul);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-iberia-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.iberia);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-illyria-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.illyria);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-thrace-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.thrace);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-belgica-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.belgica);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-low-countries-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.lowCountries);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-germania-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.germania);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-hungary-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.hungary);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-czechoslovakia-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.czechoslovakia);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-luxembourg-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.luxembourg);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-austria-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.austria);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-britain-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.britain);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-greece-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.greece);

    const italianSource = new Set(europeNorthAfricaGeoJson.features.filter((feature) => feature.id.startsWith("ita-local-")).map((feature) => feature.id));
    expect(Math.abs(derivedArea("punic-italy-") - sourceArea(italianSource))).toBeLessThan(0.000001);
  });

  it("keeps the surveyed local outlines for Gaul and Germania instead of re-partitioning whole countries", () => {
    const sourceById = new Map(europeNorthAfricaGeoJson.features.map((feature) => [feature.id, feature]));
    const checks = [
      ["fra-local-29444166B68738187753831", "punic-gaul-ain"],
      ["fra-local-29444166B62247732126362", "punic-gaul-aisne"],
      ["deu-9070358b94432643063062", "punic-germania-cherusci"],
      ["deu-9070358b46069870964378", "punic-germania-cimbri"],
    ] as const;
    for (const [sourceId, territoryId] of checks) {
      expect(punicWarsGeoJson.features.find((feature) => feature.id === territoryId)?.geometry).toEqual(sourceById.get(sourceId)?.geometry);
    }
    const frenchSource = new Set(europeNorthAfricaGeoJson.features.filter((feature) => feature.id.startsWith("fra-local-")).map((feature) => feature.id));
    expect(Math.abs(derivedArea("punic-gaul-") - sourceArea(frenchSource))).toBeLessThan(0.000001);
  });

  it("keeps surveyed local outlines for the new Adriatic, Austrian, British, and Greek territories", () => {
    const sourceById = new Map(europeNorthAfricaGeoJson.features.map((feature) => [feature.id, feature]));
    const checks = [
      ["aut-97560089b12055607938436", "punic-austria-aut-97560089b12055607938436"],
      ["hun-22733592b30896182433416", "punic-hungary-hun-22733592b30896182433416"],
      ["xkx-2360587b5118871504069", "punic-illyria-xkx-2360587b5118871504069"],
      ["gbr-local-9080712B78235082436645", "punic-britain-gbr-local-9080712b78235082436645"],
      ["grc-local-53547021B64058474759409", "punic-greece-grc-local-53547021b64058474759409"],
    ] as const;
    for (const [sourceId, territoryId] of checks) {
      expect(punicWarsGeoJson.features.find((feature) => feature.id === territoryId)?.geometry).toEqual(sourceById.get(sourceId)?.geometry);
    }
  });

  it("attaches capitals, cities, and forts to valid derived provinces", () => {
    const settlements = punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "settlement");
    expect(settlements.filter((feature) => feature.properties.kind === "settlement" && feature.properties.type === "capital").map((feature) => feature.properties.name)).toEqual(expect.arrayContaining(["Rome", "Carthage", "Syracuse", "Messana", "Pella", "Athens"]));
    expect(settlements.filter((feature) => feature.properties.kind === "settlement" && feature.properties.type === "fort").length).toBeGreaterThanOrEqual(6);
    expect(settlements.some((feature) => feature.id === "settlement-rhegium" || feature.properties.name === "Rhegium")).toBe(false);
  });
});
