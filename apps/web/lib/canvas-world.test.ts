import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema } from "@chronica/shared";
import { PUNIC_WARS_MAP_ASSET_ID } from "./built-in-scenario-maps";
import { canvasRegions, materializeCanvasProvince } from "./canvas-world";

describe("canvas-backed world materialization", () => {
  it("treats Gaul's canvas IDs as valid starting regions and materializes Gergovia's local state", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    const regions = canvasRegions(PUNIC_WARS_MAP_ASSET_ID, world);
    expect(regions.some((region) => region.id === "punic-gaul-puy-de-dome" && region.name === "Arvernian Cones")).toBe(true);

    const materialized = materializeCanvasProvince(world, PUNIC_WARS_MAP_ASSET_ID, "punic-gaul-puy-de-dome");
    const province = materialized.map.provinces.find((candidate) => candidate.id === "punic-gaul-puy-de-dome");
    expect(province?.controllerPolityId).toBe("gaul-arverni");
    expect(province?.settlements.map((settlement) => settlement.id)).toContain("settlement-gergovia");
    expect(materialized.map.polities.some((polity) => polity.id === "gaul-arverni")).toBe(true);
    expect(WorldStateSchema.safeParse(materialized).success).toBe(true);
  });

  it("leaves an unknown canvas ID untouched", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    expect(materializeCanvasProvince(world, PUNIC_WARS_MAP_ASSET_ID, "not-on-the-canvas")).toBe(world);
  });
});
