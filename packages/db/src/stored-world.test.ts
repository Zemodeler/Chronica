import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "./built-in-scenarios";
import { SaveNeedsRepairError, ScenarioDefinitionUnreadableError, readScenarioDefinition, readStoredWorld } from "./queries/world";

describe("a save read back from the database", () => {
  it("opens through the upgrade chain", () => {
    const world = readStoredWorld("game-1", structuredClone(firstPunicWarScenario.initialWorld));
    expect(world.pins.scenarioId).toBe(firstPunicWarScenario.initialWorld.pins.scenarioId);
  });

  it("that will not open says it needs repair, and where", () => {
    const broken = { ...structuredClone(firstPunicWarScenario.initialWorld), elapsedStep: -3 };
    let caught: unknown;
    try {
      readStoredWorld("game-1", broken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SaveNeedsRepairError);
    expect((caught as SaveNeedsRepairError).issues.some((issue) => issue.startsWith("elapsedStep"))).toBe(true);
    expect((caught as Error).message).toContain("game-1");
  });
});

describe("the rules a game is pinned to", () => {
  it("parse, or throw with the path -- never 'this scenario declares no clock'", () => {
    expect(readScenarioDefinition("s", 7, firstPunicWarScenario.definition).clock).toBeDefined();
    const { clock: _dropped, ...noClock } = structuredClone(firstPunicWarScenario.definition);
    expect(() => readScenarioDefinition("s", 7, noClock)).toThrow(ScenarioDefinitionUnreadableError);
    expect(() => readScenarioDefinition("s", 7, noClock)).toThrow(/clock/);
  });
});
