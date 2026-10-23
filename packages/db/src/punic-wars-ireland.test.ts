import { describe, expect, it } from "vitest";
import { WorldStateSchema } from "@chronica/shared";
import { punicWarsScenario } from "./punic-wars-scenario";
import { carryPunicWarsIreland } from "./punic-wars-ireland";
import extension from "../../../scripts/map-gen/ireland-extension.json";
import specification from "../../../scripts/map-gen/ireland-polities.json";

describe("Ireland in a campaign", () => {
  it("adds the missing land, polities and city seats to older saves without resetting conquest", () => {
    const addedIds = new Set(extension.provinceIds);
    const newPolities = new Set(specification.polities.filter((polity) => !polity.existing).map((polity) => polity.polityId));
    const old = structuredClone(punicWarsScenario.initialWorld);
    old.map.provinces = old.map.provinces.filter((province) => !addedIds.has(province.id));
    old.map.polities = old.map.polities.filter((polity) => !newPolities.has(polity.id));
    old.map.edges = old.map.edges.filter((edge) => !addedIds.has(edge.from) && !addedIds.has(edge.to));
    const captured = old.map.provinces.find((province) => province.id.startsWith("hib-"))!;
    captured.controllerPolityId = "rome";
    captured.name = "Player's Irish province";
    const result = carryPunicWarsIreland(old);
    expect(result.map.provinces).toHaveLength(punicWarsScenario.initialWorld.map.provinces.length);
    expect(result.map.provinces.find((province) => province.id === captured.id)).toBe(captured);
    expect(new Set(result.map.edges.map((edge) => `${edge.from}|${edge.to}`)).size).toBe(result.map.edges.length);
    expect(WorldStateSchema.safeParse(result).success).toBe(true);
    expect(carryPunicWarsIreland(result)).toBe(result);
    expect(old.map.provinces).toHaveLength(result.map.provinces.length - addedIds.size);
    for (const polityId of newPolities) {
      const polity = result.map.polities.find((candidate) => candidate.id === polityId)!;
      const city = result.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === polity.capitalSettlementId);
      expect(city?.controllerPolityId).toBe(polityId);
    }
  });

  it("preserves ownership and names in a campaign that already has Ireland", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    const province = world.map.provinces.find((province) => province.id === extension.provinceIds[0])!;
    province.controllerPolityId = "carthage";
    province.name = "Captured Irish district";
    expect(carryPunicWarsIreland(world)).toBe(world);
  });

  it("does not change another scenario", () => {
    const world = { ...punicWarsScenario.initialWorld, pins: { ...punicWarsScenario.initialWorld.pins, scenarioId: "another-scenario" } };
    expect(carryPunicWarsIreland(world)).toBe(world);
  });
});
