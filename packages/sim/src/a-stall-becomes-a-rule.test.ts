import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstInput } from "./burst";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * "I take an allowance from a patron" is kept as an arrangement the engine
 * cannot read (plan §2). Offered to the writer, it becomes a rule the engine
 * runs by itself: the allowance arrives each month with no model involved,
 * the second man with the same kind of arrangement gets the same rule at no
 * call, and a rule nobody can afford or read leaves the plain arrangement.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LEPTINES = { kind: "character" as const, id: "leptines-syracuse" };
/** The opening, with Leptines rich enough to pay for a kept venture and the rule behind it. */
const opening = (): WorldState => {
  const base = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return { ...base, material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === "leptines-purse" ? { ...account, balance: 30_000 } : account)) } };
};
const balance = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === id)!.balance;

/** The orchestrator's answers in order, the writer's in order; nobody else says anything. */
function scripted(orchestrator: readonly string[], writer: readonly string[] = []): SimModelPort & { calls: SimOperation[] } {
  const queue = [...orchestrator];
  const rules = [...writer];
  const calls: SimOperation[] = [];
  return {
    calls,
    complete(operation: SimOperation) {
      calls.push(operation);
      if (operation === "simulate_orchestrate" || operation === "repair_deltas") {
        const next = queue.shift();
        if (next !== undefined) return Promise.resolve(next);
      }
      if (operation === "write_mechanic") {
        const next = rules.shift();
        if (next !== undefined) return Promise.resolve(next);
        return Promise.reject(new Error("the writer was not to be asked"));
      }
      if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
      return Promise.reject(new Error(`nothing scripted for ${operation}`));
    },
  };
}
const answer = (deltas: readonly unknown[], summary = "Leptines takes an allowance from a patron.") => JSON.stringify({
  intent: { summary, domains: ["trade"] }, narrativeSummary: summary, frictions: [], deltas, facts: [], delegations: [], schedule: [],
  cognitionCandidates: [], outcome: "continue", playerDecision: null,
});
const burst = (port: SimModelPort, orderText: string | null, world: WorldState = opening(), extra: Partial<BurstInput> = {}): BurstInput => ({
  world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  burstId: "stall", gameId: "game-1", actorRef: LEPTINES, actorPolityId: "syracuse", orderText, knownFacts: [], queue: [],
  port, spanDays: 7, narratorSeeds: [], budget: { ...DEFAULT_BUDGET, maxMechanicCalls: 1 }, ...extra,
});

/** An income into a private purse: refused as written, kept as an arrangement of kind "business". */
const ALLOWANCE = { op: "income_source_upsert", incomeSourceRef: null, kind: "pension", label: "A patron's allowance", beneficiaryAccountRef: "leptines-purse", amount: 40, cadenceDays: 30, reason: "A patron keeps him." };
/** The rule the writer answers with: each month a fixed sum leaves Leptines's purse for the patron's household, outside the modelled world. */
const RULE = JSON.stringify({
  mechanic: {
    trigger: { kind: "monthly" }, conditions: [],
    effects: [{ op: "money_transfer", fromAccountId: "leptines-purse", toAccountId: null, amount: { kind: "fixed", amount: 30 } }],
    end: { kind: "owner_death" }, price: { setup: 30, upkeepPerMonth: 2 }, why: "He keeps the patron's household while he lives.",
  },
});

describe("a kept act becomes a rule the engine runs", () => {
  it("writes the rule once, and the arrangement carries it", async () => {
    const port = scripted([answer([ALLOWANCE]), JSON.stringify({ deltas: [ALLOWANCE] })], [RULE]);
    const result = await runSimulationBurst(burst(port, "I take an allowance from a patron."));
    const arrangement = result.world.genericEntities.find((entity) => entity.label === "A patron's allowance")!;
    expect(arrangement).toBeDefined();
    expect(result.audit.filter((entry) => entry.kind === "mechanic_refused").map((entry) => entry.reason)).toEqual([]);
    expect(arrangement.mechanic?.origin).toBe("written");
    expect(arrangement.mechanic?.trigger).toEqual({ kind: "monthly" });
    expect(result.mechanicCalls).toBe(1);
    expect(result.audit.some((entry) => entry.kind === "mechanic_candidate" && entry.attempt === "keep")).toBe(true);
    expect(result.audit.some((entry) => entry.kind === "mechanic" && entry.attempt === "keep")).toBe(true);
    expect(result.newFacts.some((fact) => fact.kind === "mechanic_written")).toBe(true);
  });

  it("runs it thereafter with no model involved: two months later the money has moved twice", async () => {
    const first = await runSimulationBurst(burst(scripted([answer([ALLOWANCE]), JSON.stringify({ deltas: [ALLOWANCE] })], [RULE]), "I take an allowance from a patron."));
    const port = scripted([answer([], "Time passes.")]);
    const later = await runSimulationBurst(burst(port, null, first.world, { spanDays: 90, budget: { ...DEFAULT_BUDGET, maxMechanicCalls: 0 } }));
    expect(port.calls.filter((call) => call === "write_mechanic")).toHaveLength(0);
    const rows = later.world.material.transactions.filter((row) => row.cause.kind === "mechanic");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const arrangement = later.world.genericEntities.find((entity) => entity.label === "A patron's allowance")!;
    expect(arrangement.mechanic?.firedCount).toBeGreaterThanOrEqual(2);
    expect(later.newFacts.filter((fact) => fact.kind === "mechanic_fired").length).toBeGreaterThanOrEqual(2);
  });

  it("leaves the plain arrangement when the writer's rule cannot be read", async () => {
    const bad = JSON.stringify({ mechanic: { trigger: { kind: "monthly" }, conditions: [], effects: [{ op: "money_transfer", fromAccountId: "nobodys-purse", toAccountId: "leptines-purse", amount: { kind: "fixed", amount: 30 } }], end: { kind: "never" }, price: { setup: 1, upkeepPerMonth: 1 }, why: "x" } });
    const port = scripted([answer([ALLOWANCE]), JSON.stringify({ deltas: [ALLOWANCE] })], [bad, bad]);
    const result = await runSimulationBurst(burst(port, "I take an allowance from a patron."));
    const arrangement = result.world.genericEntities.find((entity) => entity.label === "A patron's allowance")!;
    expect(arrangement.mechanic).toBeUndefined();
    expect(result.audit.some((entry) => entry.kind === "mechanic_refused")).toBe(true);
  });

  it("only counts candidates when the budget is zero", async () => {
    const port = scripted([answer([ALLOWANCE]), JSON.stringify({ deltas: [ALLOWANCE] })]);
    const result = await runSimulationBurst(burst(port, "I take an allowance from a patron.", opening(), { budget: { ...DEFAULT_BUDGET, maxMechanicCalls: 0 } }));
    expect(port.calls.filter((call) => call === "write_mechanic")).toHaveLength(0);
    expect(result.audit.filter((entry) => entry.kind === "mechanic_candidate")).toHaveLength(1);
    expect(result.mechanicCalls).toBe(0);
    expect(balance(result.world, "leptines-purse")).toBeLessThanOrEqual(balance(opening(), "leptines-purse"));
  });
});
