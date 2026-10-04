import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

describe("parallel requests do not spend later decisions' allowance", () => {
  it("finishes the same span and world with a small work budget while recording every real request", async () => {
    const run = async (cognitionShards?: number) => {
      let calls = 0;
      const port: SimModelPort = {
        complete(operation, _system, user) {
          calls += 1;
          if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({
            intent: { summary: "Wait for events", domains: ["military"] }, narrativeSummary: "Time passes.",
            deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "chronicle", playerDecision: null,
          }));
          if (operation === "simulate_cognition") {
            const ids = [...user.matchAll(/^## .+ \[([^\]]+)\]$/gm)].map((match) => match[1]!);
            return Promise.resolve(JSON.stringify({ actors: ids.map((id) => ({ actorRef: { kind: "character", id },
              proposal: { narrativeSummary: "They wait.", deltas: [], facts: [], delegations: [], schedule: [] } })) }));
          }
          throw new Error(`Unexpected ${operation}`);
        },
      };
      const result = await runSimulationBurst({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
        clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
        burstId: "parallel-budget", gameId: "parallel-budget", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
        orderText: "Wait for events.", spanDays: 14, knownFacts: [], queue: [], port, narratorSeeds: [],
        budget: { ...DEFAULT_BUDGET, maxModelCalls: 2, baseModelCalls: 2, maxAmbientActors: 6,
          ...(cognitionShards === undefined ? {} : { cognitionShards }) },
      });
      return { result, calls };
    };
    // The normal work allocation is up to two calls for a large cast. An
    // explicitly forced single call is not that allocation; compare two
    // versus the default parallel transport, with equal decision allowance.
    const serial = await run(2);
    const parallel = await run();
    expect(parallel.calls).toBeGreaterThan(serial.calls);
    expect(parallel.result.modelCalls).toBe(parallel.calls);
    expect(parallel.result.modelWorkCalls).toBe(serial.result.modelWorkCalls);
    expect(parallel.result.world).toEqual(serial.result.world);
    expect(parallel.result.stopReason).toBe(serial.result.stopReason);
    expect(parallel.result.skipped.filter((entry) => /budget/.test(entry.reason))).toEqual(serial.result.skipped.filter((entry) => /budget/.test(entry.reason)));
  });
});
