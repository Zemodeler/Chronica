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
      provinceId: "ita-local-23120603B86473916475875",
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

  it("splits Sicilia into five playable provinces", () => {
    const sicily = europeNorthAfricaGeoJson.features.filter((feature) => feature.id.startsWith("ita-72843720b81376294924159-sicily-"));
    const remainingIslands = europeNorthAfricaGeoJson.features.find((feature) => feature.id === "ita-72843720b81376294924159");
    expect(sicily).toHaveLength(5);
    expect(sicily.map((feature) => feature.id).sort()).toEqual([
      "ita-72843720b81376294924159-sicily-central",
      "ita-72843720b81376294924159-sicily-northeast",
      "ita-72843720b81376294924159-sicily-northwest",
      "ita-72843720b81376294924159-sicily-southeast",
      "ita-72843720b81376294924159-sicily-west",
    ]);
    expect(sicily.map((feature) => feature.properties.name).sort()).toEqual([
      "Agrigentum and the south-west",
      "Lilybaeum and western Sicily",
      "Messana and the strait",
      "Panormus and the north-west",
      "Syracuse and the south-east",
    ]);
    expect(remainingIslands?.properties).toMatchObject({ kind: "province", name: "Sardegna e isole" });
  });

  it("uses compact German government districts instead of the 16 large state provinces", () => {
    const germanProvinces = europeNorthAfricaGeoJson.features.filter((feature) => feature.id.startsWith("deu-"));
    expect(germanProvinces).toHaveLength(38);
    expect(germanProvinces.map((feature) => feature.properties.name)).toEqual(expect.arrayContaining([
      "Oberbayern",
      "Oberpfalz",
      "Düsseldorf",
      "Köln",
      "Dresden",
      "Leipzig",
      "Stuttgart",
      "Freiburg",
    ]));
    expect(germanProvinces.map((feature) => feature.properties.name)).not.toContain("Bayern");
    expect(germanProvinces.map((feature) => feature.properties.name)).not.toContain("Nordrhein-Westfalen");
  });

  it("uses detailed local source boundaries for France and mainland Italy", () => {
    expect(europeNorthAfricaGeoJson.features.filter((feature) => feature.id.startsWith("fra-local-") && feature.properties.kind === "province")).toHaveLength(96);
    expect(europeNorthAfricaGeoJson.features.filter((feature) => feature.id.startsWith("ita-local-") && feature.properties.kind === "province")).toHaveLength(18);
  });

  it("condenses Athens' municipality-scale regions into metro-sized territories", () => {
    const athensMetro = europeNorthAfricaGeoJson.features.filter((feature) => feature.properties.kind === "province" && [
      "grc-local-53547021B2738722376900",
      "grc-local-53547021B60272535960699",
      "grc-local-53547021B73781600558558",
      "grc-local-53547021B42397561694605",
      "grc-local-53547021B46293618367520",
    ].includes(feature.id));
    expect(athensMetro.map((feature) => feature.properties.name).sort()).toEqual([
      "Athens",
      "Eastern Athens",
      "Northern Athens",
      "Piraeus and Western Athens",
      "Southern Athens",
    ]);
    expect(athensMetro.filter((feature) => feature.geometry.type === "Polygon")).toHaveLength(3);
    expect(europeNorthAfricaGeoJson.features.some((feature) => feature.id === "grc-local-53547021B24220934156468")).toBe(false);
    expect(europeNorthAfricaGeoJson.features.some((feature) => feature.id === "grc-local-53547021B46856554305408")).toBe(true);
    expect(europeNorthAfricaGeoJson.features.some((feature) => feature.id === "grc-local-53547021B9274256728427")).toBe(true);
  });

  it("condenses the Acarnanian islands, keeping the rest of the southern/central mainland at municipality scale", () => {
    const greekProvinceNames = europeNorthAfricaGeoJson.features
      .filter((feature) => feature.id.startsWith("grc-local-") && feature.properties.kind === "province")
      .map((feature) => feature.properties.name);

    expect(greekProvinceNames).toEqual(expect.arrayContaining([
      "Acarnanian Islands",
      "Pineios",
    ]));
    expect(europeNorthAfricaGeoJson.features.some((feature) => feature.id === "grc-local-53547021B5259778029298")).toBe(false);
  });

  it("condenses Macedon, Thessaly, Epirus, and Aegean Thrace into one broad province apiece", () => {
    const greekProvinces = europeNorthAfricaGeoJson.features
      .filter((feature) => feature.id.startsWith("grc-local-") && feature.properties.kind === "province");
    const greekProvinceNames = greekProvinces.map((feature) => feature.properties.name);

    expect(greekProvinceNames).toEqual(expect.arrayContaining(["Macedon", "Thessaly", "Epirus", "Aegean Thrace"]));
    // The individual modern municipalities that used to stand for these kingdoms/leagues are gone.
    expect(greekProvinceNames).not.toEqual(expect.arrayContaining(["Thessaloniki", "Samothrakis", "Arta", "Trikala", "Ioannina"]));
    // The merge produced a single contiguous Macedon (its geometry may still
    // be a MultiPolygon because Chalkidiki's fingers and offshore islets
    // aren't edge-adjacent to the mainland ring).
    const macedon = greekProvinces.find((feature) => feature.properties.name === "Macedon");
    expect(macedon?.geometry.type === "Polygon" || macedon?.geometry.type === "MultiPolygon").toBe(true);
    expect(europeNorthAfricaGeoJson.features.some((feature) => feature.id === "grc-local-53547021B66289561682340")).toBe(false);
  });
});
