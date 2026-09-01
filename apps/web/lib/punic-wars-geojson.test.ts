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
    expect(punicWarsGeoJson.features.some((feature) => feature.id === "ita-72843720b863019116732")).toBe(false);
    expect(punicWarsGeoJson.features.some((feature) => feature.id === "gbr-14339913b95766344400054")).toBe(false);
    expect(punicWarsGeoJson.features.find((feature) => feature.id === "fra-19338628b22604203385446")?.properties).toMatchObject({ name: "Corse" });
  });

  it("creates the agreed historical region counts with no lost outer area", () => {
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-italy-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.italy);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-gaul-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.gaul);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-iberia-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.iberia);
    expect(punicWarsGeoJson.features.filter((feature) => feature.id.startsWith("punic-britain-") && feature.properties.kind === "province")).toHaveLength(PUNIC_WARS_REGION_COUNTS.england + PUNIC_WARS_REGION_COUNTS.scotland + PUNIC_WARS_REGION_COUNTS.wales);

    const italianSource = new Set(["ita-72843720b99597932318450", "ita-72843720b59566147937015", "ita-72843720b863019116732", "ita-72843720b88210905209841"]);
    expect(Math.abs(derivedArea("punic-italy-") - sourceArea(italianSource))).toBeLessThan(0.0001);
  });

  it("attaches capitals, cities, and forts to valid derived provinces", () => {
    const settlements = punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "settlement");
    expect(settlements.filter((feature) => feature.properties.kind === "settlement" && feature.properties.type === "capital").map((feature) => feature.properties.name)).toEqual(expect.arrayContaining(["Rome", "Carthage", "Syracuse", "Messana", "Pella", "Athens"]));
    expect(settlements.filter((feature) => feature.properties.kind === "settlement" && feature.properties.type === "fort").length).toBeGreaterThanOrEqual(6);
  });
});
