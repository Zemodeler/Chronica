import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, coinageOfPolity, standardOf, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type SimModelPort } from "./index";
import { applyDecision, atDay, input, logged, opening, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { decideFiscal } from "./fiscal-officers";

/**
 * "What the officers decide, the month carries out."
 *
 * The fiscal officers and the magistrates decide by rule, and the burst applies their acts as the power's own business (`sanctioned`). A guard meant to keep the
 * orchestrator out of other states' books once set aside those acts too: a treasurer's loan, his customs and his coin were decided every month and never struck.
 * The coin is the case that shows it: Carthage's elders carry the motion, the officer decides to strike the shekel lighter, and the world's month must strike it,
 * once, and not again within the year.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete: (operation) => Promise.resolve(operation === "simulate_orchestrate"
    ? JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "Wait.", deltas: [], facts: [], outcome: "continue" })
    : operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}"),
};

describe("what the officers decide, the month carries out", () => {
  it("strikes the shekel lighter once the elders have carried it, a tenth, and not again for a year", async () => {
    let world: WorldState = withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 1_000, 300_000), "carthage", 0.02);
    let day = 120;
    let asked: ReturnType<typeof decideFiscal>[number] | undefined;
    for (; day <= 840 && asked === undefined; day += 30) {
      world = atDay(world, day);
      const made = decideFiscal(input(world, "ptolemaic-egypt")).filter((decision) => decision.polityId === "carthage");
      asked = made.find((decision) => decision.deltas.some((delta) => delta.op === "political_procedure_open" && /less silver/.test((delta as unknown as { label: string }).label)));
      if (asked === undefined) for (const decision of made) world = logged(applyDecision(world, decision).world, decision);
    }
    expect(asked).toBeDefined();
    world = logged(applyDecision(world, asked!).world, asked!);
    const motion = world.material.politicalProcedures.filter((entry) => /less silver/.test(entry.label)).at(-1)!;
    world = { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((entry) => (entry.id === motion.id ? { ...entry, stage: "resolved" as const, outcome: "passed" as const, resolvedAtStep: day, outcomeReason: "The elders carried it." } : entry)) } };
    const before = coinageOfPolity(world, "carthage");
    const silverAfter: number[] = [];
    for (let month = 1; month <= 3; month += 1) {
      world = atDay(world, day + 30 * month);
      const result = await runSimulationBurst({
        world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare, terrains: definition.map.terrains,
        life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures, burstId: `officers-${month}`, gameId: "game-fiscal",
        actorRef: { kind: "character", id: "ptolemaic-egypt-ruler-5mbdla" }, actorPolityId: "ptolemaic-egypt", orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
      });
      world = result.world;
      silverAfter.push(coinageOfPolity(world, "carthage").silverBps);
    }
    const struck = coinageOfPolity(world, "carthage");
    expect(silverAfter[0]).toBeLessThan(before.silverBps);
    expect(struck.silverBps).toBeGreaterThanOrEqual(Math.round(standardOf(struck) * 0.8));
    expect(struck.history).toHaveLength(1);
    expect(silverAfter.at(-1)).toBe(silverAfter[0]);
  }, 300_000);
});
