import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "./punic-wars-scenario";

describe("Punic Wars built-in scenario", () => {
  it("opens in 270 BCE as a tense peace with the Messana crisis", () => {
    expect(punicWarsScenario.definition.clock.epoch).toMatchObject({ year: 270, month: 3, day: 1, era: "BCE" });
    expect(punicWarsScenario.initialWorld.conflicts.wars).toEqual([]);
    expect(punicWarsScenario.initialWorld.storylines?.map((storyline) => storyline.id)).toContain("mamertine-syracusan-crisis");
    expect(punicWarsScenario.initialWorld.map.politicalRelations).toHaveLength(13);
  });

  it("keeps the four key actors and their historical capitals in authoritative state", () => {
    expect(punicWarsScenario.initialWorld.map.polities.filter((polity) => ["rome", "carthage", "syracuse", "mamertines"].includes(polity.id))).toHaveLength(4);
    expect(punicWarsScenario.initialWorld.material.forces).toHaveLength(4);
  });
});
