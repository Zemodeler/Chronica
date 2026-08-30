import { describe, expect, it } from "vitest";
import { GeoJsonMapSchema } from "@chronica/shared";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";

describe("Europe and North Africa demo map features", () => {
  it("contains the schema-valid Rome settlement anchor", () => {
    expect(GeoJsonMapSchema.safeParse(europeNorthAfricaGeoJson).success).toBe(true);
    expect(europeNorthAfricaGeoJson.features.filter((feature) => feature.properties.kind === "settlement")).toHaveLength(5);
    const rome = europeNorthAfricaGeoJson.features.find((feature) => feature.id === "settlement-rome");
    expect(rome).toBeDefined();
    if (!rome || rome.geometry.type !== "Point" || rome.properties.kind !== "settlement") {
      throw new Error("Rome demo settlement is malformed.");
    }
    expect(rome.geometry.coordinates).toEqual([12.4964, 41.9028]);
    expect(rome.properties).toMatchObject({
      name: "Rome",
      provinceId: "ita-72843720b863019116732",
      type: "capital",
    });
  });

  it("adds Naples and Syracuse as city anchors on the active map", () => {
    const cities = europeNorthAfricaGeoJson.features.filter((feature) => feature.properties.kind === "settlement");
    expect(cities.map((feature) => feature.properties.name).sort()).toEqual(["Caralis", "Fort Agrigentum", "Naples", "Rome", "Syracuse"]);
    expect(cities.find((feature) => feature.id === "settlement-rome")?.properties).toMatchObject({ type: "capital" });
    expect(cities.find((feature) => feature.id === "settlement-agrigentum-fort")?.properties).toMatchObject({ type: "fort" });
    expect(cities.find((feature) => feature.id === "settlement-caralis")?.properties).toMatchObject({ provinceId: "ita-72843720b81376294924159", type: "city" });
  });

  it("splits Sicilia into western and eastern provinces", () => {
    const westernSicily = europeNorthAfricaGeoJson.features.find((feature) => feature.id === "ita-72843720b81376294924159-sicily-west");
    const easternSicily = europeNorthAfricaGeoJson.features.find((feature) => feature.id === "ita-72843720b81376294924159-sicily-east");
    const remainingIslands = europeNorthAfricaGeoJson.features.find((feature) => feature.id === "ita-72843720b81376294924159");
    expect(westernSicily?.properties).toMatchObject({ kind: "province", name: "Sicilia occidentale" });
    expect(easternSicily?.properties).toMatchObject({ kind: "province", name: "Sicilia orientale" });
    expect(remainingIslands?.properties).toMatchObject({ kind: "province", name: "Sardegna e isole" });
  });
});
