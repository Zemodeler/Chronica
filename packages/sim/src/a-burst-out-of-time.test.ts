import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstInput } from "./burst";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * A burst that runs out of time, or of calls, keeps what it did and says
 * what it did not do.
 *
 * Before this, work the budget turned away was printed to the server console
 * and nowhere else, and a burst had no way to be told to stop at all: the
 * process running it either finished or was given up for dead with
 * everything it had done thrown away.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

const ORDER = JSON.stringify({
  intent: { summary: "Raise a legion.", domains: ["military"] },
  narrativeSummary: "Recruitment opens across Latium.",
  frictions: [],
  deltas: [],
  facts: [{ localId: "levy", kind: "military_mobilization", summary: "Rome begins raising a new legion.", affectedRefs: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "carthage" }], visibility: "public", discoveryState: "delayed", knowableInDays: 1, significance: 55 }],
  delegations: [],
  schedule: [],
  cognitionCandidates: [],
  outcome: "chronicle",
  playerDecision: null,
});

function port(asked: SimOperation[]): SimModelPort {
  return {
    complete(operation) {
      asked.push(operation);
      if (operation === "simulate_orchestrate") return Promise.resolve(ORDER);
      if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
      return Promise.resolve("{}");
    },
  };
}

const input = (model: SimModelPort, overrides: Partial<BurstInput> = {}): BurstInput => ({
  world: world(),
  clock: definition.clock,
  offices: definition.government.offices,
  warfare: definition.warfare,
  burstId: "late",
  gameId: "game-late",
  actorRef: { kind: "character", id: "marcus-atilius" },
  actorPolityId: "rome",
  orderText: "Raise a legion.",
  spanDays: 90,
  knownFacts: [],
  queue: [],
  port: model,
  ...overrides,
});

describe("a burst told to stop", () => {
  it("stops between hops with the order's own work kept, and says it was the deadline", async () => {
    const asked: SimOperation[] = [];
    // The deadline passes as soon as the first round of reactions has been asked.
    const result = await runSimulationBurst(input(port(asked), { shouldStop: () => asked.includes("simulate_cognition") }));
    expect(result.stopReason).toBe("deadline");
    expect(result.newFacts.some((fact) => fact.summary === "Rome begins raising a new legion.")).toBe(true);
    // Stopped well short of the ninety days it was given.
    expect(result.world.instant.day - world().instant.day).toBeLessThan(90);
  });

  it("runs its whole span when nobody tells it to stop", async () => {
    const result = await runSimulationBurst(input(port([])));
    expect(result.stopReason).not.toBe("deadline");
  });
});

describe("a burst out of calls", () => {
  it("keeps a line for everybody the budget left unasked", async () => {
    const asked: SimOperation[] = [];
    // One call: the order's, and nothing left for the people who hear of it.
    // The order's standing pursuit is no longer offered a rule at all (E20),
    // so there is no skipped rule to keep a line for: none was owed.
    const result = await runSimulationBurst(input(port(asked), { spanDays: undefined, budget: { ...DEFAULT_BUDGET, maxModelCalls: 1, maxMechanicCalls: 0 } }));
    expect(asked).toEqual(["simulate_orchestrate"]);
    expect(result.stopReason).toBe("budget_exhausted");
    expect(result.skipped.some((skip) => skip.stage === "cognition" && /budget is spent/.test(skip.reason))).toBe(true);
    expect(result.skipped.some((skip) => skip.stage === "mechanic")).toBe(false);
  });
});
