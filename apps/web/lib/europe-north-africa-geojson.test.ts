import { describe, expect, it } from "vitest";
import { GeoJsonMapSchema } from "@chronica/shared";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";

describe("Europe and North Africa map calibration features", () => {
  it("contains a schema-valid Rome settlement anchored to Centro", () => {
    expect(GeoJsonMapSchema.safeParse(europeNorthAfricaGeoJson).success).toBe(true);
    const rome = europeNorthAfricaGeoJson.features.find((feature) => feature.id === "settlement-rome");
    expect(rome).toBeDefined();
    if (!rome || rome.geometry.type !== "Point" || rome.properties.kind !== "settlement") {
      throw new Error("Rome calibration settlement is malformed.");
    }
    expect(rome.geometry.coordinates).toEqual([12.4964, 41.9028]);
    expect(rome.properties).toMatchObject({
      name: "Rome",
      provinceId: "ita-72843720b863019116732",
      type: "city",
    });
  });

  it("splits Sicilia from the former combined Italian islands feature", () => {
    const sicilia = europeNorthAfricaGeoJson.features.find((feature) => feature.id === "ita-72843720b81376294924159-sicily");
    const remainingIslands = europeNorthAfricaGeoJson.features.find((feature) => feature.id === "ita-72843720b81376294924159");
    expect(sicilia?.properties).toMatchObject({ kind: "province", name: "Sicilia" });
    expect(remainingIslands?.properties).toMatchObject({ kind: "province", name: "Sardegna e isole" });
  });
});
