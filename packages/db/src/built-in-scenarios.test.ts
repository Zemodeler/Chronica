import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "./built-in-scenarios";

describe("First Punic War built-in scenario", () => {
  it("parses and opens with Rome, Carthage, and Syracuse in place", () => {
    expect(firstPunicWarScenario.initialWorld.map.polities.map((polity) => polity.id)).toEqual(
      expect.arrayContaining(["rome", "carthage", "syracuse"]),
    );
    expect(firstPunicWarScenario.initialWorld.conflicts.wars).toEqual([{ polityAId: "carthage", polityBId: "rome" }]);
  });

  it("gives every settlement a provinceId matching the province it is nested inside", () => {
    for (const province of firstPunicWarScenario.initialWorld.map.provinces) {
      for (const settlement of province.settlements) {
        expect(settlement.provinceId).toBe(province.id);
      }
    }
  });
});
