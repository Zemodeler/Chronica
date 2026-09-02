import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "./punic-wars-scenario";

describe("Punic Wars built-in scenario", () => {
  it("opens in 270 BCE as a tense peace with the Messana crisis", () => {
    expect(punicWarsScenario.definition.clock.epoch).toMatchObject({ year: 270, month: 3, day: 1, era: "BCE" });
    expect(punicWarsScenario.initialWorld.conflicts.wars).toEqual([]);
    expect(punicWarsScenario.initialWorld.storylines?.map((storyline) => storyline.id)).toContain("mamertine-syracusan-crisis");
    expect(punicWarsScenario.initialWorld.map.politicalRelations).toEqual([]);
  });

  it("keeps the four key actors and their historical capitals in authoritative state", () => {
    expect(punicWarsScenario.initialWorld.map.polities.filter((polity) => ["rome", "carthage", "syracuse", "mamertines"].includes(polity.id))).toHaveLength(4);
    expect(punicWarsScenario.initialWorld.material.forces).toHaveLength(4);
  });

  it("uses direct Roman control for its Italian client territories", () => {
    const controller = new Map(punicWarsScenario.initialWorld.map.provinces.map((province) => [province.id, province.controllerPolityId]));
    expect(controller.get("punic-italy-samnium")).toBe("rome");
    expect(controller.get("punic-italy-lucanians")).toBe("rome");
  });

  it("includes denser local territories in northern Italy", () => {
    const ids = punicWarsScenario.initialWorld.map.provinces.map((province) => province.id);
    expect(ids).toEqual(expect.arrayContaining(["punic-italy-liguria-genua", "punic-italy-insubria-mediolanum", "punic-italy-boii-felsina", "punic-italy-cenomani-brixia", "punic-italy-veneti-patavium"]));
  });
});
