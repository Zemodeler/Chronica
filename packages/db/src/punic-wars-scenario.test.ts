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
    expect(controller.get("punic-italy-etrurian-uplands")).toBe("rome");
    expect(controller.get("punic-italy-samnium")).toBe("rome");
    expect(controller.get("punic-italy-lucanian-uplands")).toBe("rome");
  });

  it("keeps every rendered settlement in a playable province available to the simulation", () => {
    const settlements = new Map(
      punicWarsScenario.initialWorld.map.provinces.flatMap((province) =>
        province.settlements.map((settlement) => [settlement.id, settlement] as const),
      ),
    );
    expect(settlements.get("settlement-bononia")).toMatchObject({
      name: "Felsina",
      provinceId: "punic-italy-middle-padus",
      controllerPolityId: "boii",
    });
    expect(settlements.get("settlement-volsinii")).toMatchObject({
      provinceId: "punic-italy-etrurian-uplands",
      controllerPolityId: "rome",
    });
    expect(settlements.get("settlement-lilybaeum")?.provinceId).toBe("ita-72843720b81376294924159-sicily-west");
    expect(settlements.get("settlement-panormus")?.provinceId).toBe("ita-72843720b81376294924159-sicily-northwest");
  });

  // Italy's gameplay provinces match the rendered map's own partition
  // (apps/web/lib/punic-wars-geojson.ts's ITALY_GROUNDED_TERRITORIES) exactly
  // -- a gameplay province id with no matching map polygon has nowhere to
  // render (see the army-vanishing and mismatched-label bugs this replaced).
  it("matches the rendered map's Italy partition exactly", () => {
    const ids = punicWarsScenario.initialWorld.map.provinces.map((province) => province.id);
    expect(ids).toEqual(expect.arrayContaining([
      "punic-italy-ligurian-coast", "punic-italy-insubrian-plain", "punic-italy-middle-padus",
      "punic-italy-venetian-lagoon", "punic-italy-etrurian-uplands", "punic-italy-bruttian-highlands",
    ]));
  });
});
