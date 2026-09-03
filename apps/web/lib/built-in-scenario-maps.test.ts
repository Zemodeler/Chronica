import { describe, expect, it } from "vitest";
import { NUMIDIAN_DECISION_MAP_ASSET_ID, PUNIC_WARS_MAP_ASSET_ID, builtInScenarioMap } from "./built-in-scenario-maps";

describe("built-in scenario maps", () => {
  it("gives the Numidian Decision its own copy of the opening map", () => {
    const first = builtInScenarioMap(NUMIDIAN_DECISION_MAP_ASSET_ID);
    const second = builtInScenarioMap(NUMIDIAN_DECISION_MAP_ASSET_ID);

    expect(first).toBeDefined();
    expect(first).not.toBe(second);
    expect(first?.features.length).toBeGreaterThan(0);
  });

  it("gives Punic Wars an independent historical map", () => {
    const first = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID);
    const second = builtInScenarioMap(PUNIC_WARS_MAP_ASSET_ID);

    expect(first).toBeDefined();
    expect(first).not.toBe(second);
    expect(first?.features.length).toBeGreaterThan(0);
    expect(first?.features.some((feature) => feature.id === "punic-italy-latium")).toBe(true);
  });
});
