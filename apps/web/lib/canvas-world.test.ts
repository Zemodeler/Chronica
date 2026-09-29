import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { WorldStateSchema } from "@chronica/shared";
import { NUMIDIAN_DECISION_MAP_ASSET_ID, PUNIC_WARS_MAP_ASSET_ID, builtInScenarioMap } from "./built-in-scenario-maps";
import { canvasRegions, materializeCanvasProvince } from "./canvas-world";

/** The province the map puts Massalia in, whatever the province is called. */
function massaliaProvinceId(): string {
  const town = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID)!.features.find((feature) => feature.properties.kind === "settlement" && feature.properties.name === "Massalia");
  if (town === undefined || town.properties.kind !== "settlement") throw new Error("The map has no Massalia");
  return town.properties.provinceId;
}

describe("canvas-backed world materialization", () => {
  it("offers every province of the Punic Wars map as a starting region, under the name the world gives it", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    const regions = canvasRegions(PUNIC_WARS_MAP_ASSET_ID, world);
    const massalia = massaliaProvinceId();
    expect(regions).toHaveLength(world.map.provinces.length);
    expect(regions.find((region) => region.id === massalia)).toMatchObject({ name: world.map.provinces.find((province) => province.id === massalia)!.name });
    expect(regions.find((region) => region.id === massalia)!.aliases).toContain("Massalia");
  });

  it("finds Massalia's province already in the world, held by Massalia, so there is nothing to materialize", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    const massalia = massaliaProvinceId();
    const province = world.map.provinces.find((candidate) => candidate.id === massalia);
    expect(province?.controllerPolityId).toBe("massalia");
    expect(province?.settlements.map((settlement) => settlement.id)).toContain("settlement-massalia");
    expect(materializeCanvasProvince(world, PUNIC_WARS_MAP_ASSET_ID, massalia)).toBe(world);
  });

  it("brings a canvas province a sparse world lacks into it as ground nobody holds", () => {
    const world = structuredClone(firstPunicWarScenario.initialWorld);
    const held = new Set(world.map.provinces.map((province) => province.id));
    const canvas = builtInScenarioMap(NUMIDIAN_DECISION_MAP_ASSET_ID)!;
    const missing = canvas.features.find((feature) => feature.properties.kind === "province" && !held.has(feature.id))!;

    const materialized = materializeCanvasProvince(world, NUMIDIAN_DECISION_MAP_ASSET_ID, missing.id);
    expect(materialized.map.provinces.find((province) => province.id === missing.id)).toMatchObject({ controllerPolityId: null, controlFirmnessBps: 0 });
    expect(WorldStateSchema.safeParse(materialized).success).toBe(true);
  });

  it("leaves an unknown canvas ID untouched", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    expect(materializeCanvasProvince(world, PUNIC_WARS_MAP_ASSET_ID, "not-on-the-canvas")).toBe(world);
  });
});
