import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { ensureConstitutions } from "./constitutions";
import type { SimModelPort, SimOperation } from "./ports";

/** A turn with no order is time passing: it costs no orchestrator call (the harness showed one on every no-order turn, carrying far story seeds). */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

async function aTurn(orderText: string | null): Promise<SimOperation[]> {
  const calls: SimOperation[] = [];
  const port: SimModelPort = {
    complete(operation) {
      calls.push(operation);
      if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
      if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "x", domains: [] }, narrativeSummary: "x", deltas: [], facts: [], outcome: "continue" }));
      return Promise.resolve("{}");
    },
  };
  await runSimulationBurst({
    world: ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 }),
    clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: "a-wait", gameId: "a-wait-needs-no-orchestrator", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText, spanDays: 30, knownFacts: [], queue: [], port, budget: DEFAULT_BUDGET,
  });
  return calls;
}

describe("a wait needs no orchestrator", { timeout: 120_000 }, () => {
  it("makes no orchestrate call when no order is given, or a blank one", async () => {
    expect(await aTurn(null)).not.toContain("simulate_orchestrate");
    expect(await aTurn("   ")).not.toContain("simulate_orchestrate");
  });

  it("still reads an order that was given", async () => {
    expect(await aTurn("Send a letter to Hieron of Syracuse.")).toContain("simulate_orchestrate");
  });
});
