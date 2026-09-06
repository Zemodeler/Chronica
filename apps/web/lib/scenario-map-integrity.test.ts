import { assertWorldMapGeometryComplete, findWorldMapGeometryGaps } from "@chronica/shared";
import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { punicWarsScenario } from "@chronica/db";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";
import { punicWarsGeoJson } from "./punic-wars-geojson";

describe("scenario map integrity", () => {
  it("gives every simulated built-in province and force location a polygon", () => {
    expect(findWorldMapGeometryGaps(firstPunicWarScenario.initialWorld, europeNorthAfricaGeoJson)).toEqual([]);
    expect(findWorldMapGeometryGaps(punicWarsScenario.initialWorld, punicWarsGeoJson)).toEqual([]);
    expect(() => assertWorldMapGeometryComplete(firstPunicWarScenario.initialWorld, europeNorthAfricaGeoJson)).not.toThrow();
    expect(() => assertWorldMapGeometryComplete(punicWarsScenario.initialWorld, punicWarsGeoJson)).not.toThrow();
  });

  it("identifies every missing location instead of allowing a silent rendering failure", () => {
    const world = { ...punicWarsScenario.initialWorld, map: { ...punicWarsScenario.initialWorld.map, provinces: [{ ...punicWarsScenario.initialWorld.map.provinces[0]!, id: "not-on-the-map" }] } };
    expect(findWorldMapGeometryGaps(world, punicWarsGeoJson)).toEqual(["not-on-the-map"]);
    expect(() => assertWorldMapGeometryComplete(world, punicWarsGeoJson)).toThrow("not-on-the-map");
  });

  it("does not render a siegeable settlement that is absent from its playable world", () => {
    const playableProvinceIds = new Set(punicWarsScenario.initialWorld.map.provinces.map((province) => province.id));
    const renderedSettlementIds = punicWarsGeoJson.features
      .filter((feature) => feature.properties.kind === "settlement" && playableProvinceIds.has(feature.properties.provinceId))
      .map((feature) => feature.id)
      .sort();
    const worldSettlementIds = punicWarsScenario.initialWorld.map.provinces
      .flatMap((province) => province.settlements.map((settlement) => settlement.id))
      .sort();

    expect(worldSettlementIds).toEqual(renderedSettlementIds);
  });
});
