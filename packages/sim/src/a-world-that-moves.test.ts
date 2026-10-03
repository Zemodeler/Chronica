import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstResult } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * A world that moves without the player (docs/plans/a-living-world.md §2).
 *
 * Two hand runs, a year and three years long, found a world in which nothing
 * happened that the player had not started: every war in the soldier's world
 * file was Rome's, and the observer's grain merchant watched a year go by in
 * which no power away from the Messana crisis did anything. Here the model
 * never acts at all -- every person it is asked about answers "nothing" --
 * and the powers still make their own moves, by rule.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

/** A model that waits for the player and lets everybody else do nothing. */
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") {
      return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
    }
    if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
    return Promise.resolve("{}");
  },
};

async function months(count: number): Promise<{ world: WorldState; results: BurstResult[] }> {
  let world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const results: BurstResult[] = [];
  for (let month = 0; month < count; month += 1) {
    const result = await runSimulationBurst({
      world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
      terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
      burstId: `month-${month}`, gameId: "a-world-that-moves", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
    });
    results.push(result);
    world = result.world;
  }
  return { world, results };
}

describe("a world that moves", { timeout: 600_000 }, () => {
  it("makes its own wars, alliances and campaigns away from the player, by rule", async () => {
    const { world } = await months(8);
    const log = world.statecraft.log;
    // Something happened, and it was not Rome's doing: Rome is the player's.
    expect(log.length).toBeGreaterThan(0);
    // A Roman's own plot is his, not the rules moving Rome (`villainy.ts`).
    expect(log.some((entry) => entry.polityId === "rome" && entry.act !== "plot" && entry.act !== "purge")).toBe(false);
    const opened = world.polityAgreements.filter((agreement) => agreement.sinceStep > 0 && agreement.polityId !== "rome" && agreement.otherPolityId !== "rome"
      && (agreement.kind === "war" || agreement.kind === "alliance"));
    expect(opened.length).toBeGreaterThan(0);
    // Every move is written down with its reason.
    for (const entry of log) expect(entry.why.length).toBeGreaterThan(5);
  });
});
