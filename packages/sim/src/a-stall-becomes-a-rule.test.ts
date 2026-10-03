import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstInput } from "./burst";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * "I set up a toll on the coast road" is an arrangement the engine has no act
 * for (plan §2). Offered to the writer, it becomes a rule the engine runs by
 * itself: the toll's keeping is paid each month with no model involved, and a
 * rule nobody can afford or read leaves the plain arrangement.
 *
 * These tests were written on "I take an allowance from a patron", an income
 * kept as an arrangement. That is no longer offered a rule (play-test E19,
 * E20: an income kept from an act the engine prices pays by its own effect,
 * and a patron's allowance is the patron's stipend now, `money.ts`), so the
 * fixture is the model's own arrangement.
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
const answer = (deltas: readonly unknown[], summary = "Leptines sets up a toll on the coast road.") => JSON.stringify({
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
/** The model's own arrangement, its keep named from a purse nobody has: the engine takes his own (`fill-gaps`). */
const TOLL = { op: "generic_entity_create", localId: "toll", kind: "toll", label: "A toll on the coast road", ownerRef: LEPTINES, attributes: {}, provinceId: null, effects: [], upkeep: { fromAccountRef: "nobody-keeps-this-purse", band: "slight" }, reason: "He sets up a toll." };
/** The rule the writer answers with: each month a fixed sum leaves Leptines's purse for the toll-keepers' wages, outside the modelled world. */
const RULE = JSON.stringify({
  mechanic: {
    trigger: { kind: "monthly" }, conditions: [],
    effects: [{ op: "money_transfer", fromAccountId: "leptines-purse", toAccountId: null, amount: { kind: "fixed", amount: 30 } }],
    end: { kind: "owner_death" }, price: { setup: 30, upkeepPerMonth: 2 }, why: "He keeps the toll-keepers while he lives.",
  },
});

describe("a kept act becomes a rule the engine runs", () => {
  it("writes the rule once, and the arrangement carries it", async () => {
    const port = scripted([answer([TOLL]), JSON.stringify({ deltas: [TOLL] })], [RULE]);
    const result = await runSimulationBurst(burst(port, "I set up a toll on the coast road."));
    const arrangement = result.world.genericEntities.find((entity) => entity.label === "A toll on the coast road")!;
    expect(arrangement).toBeDefined();
    expect(result.audit.filter((entry) => entry.kind === "mechanic_refused").map((entry) => entry.reason)).toEqual([]);
    expect(arrangement.mechanic?.origin).toBe("written");
    expect(arrangement.mechanic?.trigger).toEqual({ kind: "monthly" });
    expect(result.mechanicCalls).toBe(1);
    expect(result.audit.some((entry) => entry.kind === "mechanic_candidate")).toBe(true);
    expect(result.audit.some((entry) => entry.kind === "mechanic")).toBe(true);
    expect(result.newFacts.some((fact) => fact.kind === "mechanic_written")).toBe(true);
  });

  it("runs it thereafter with no model involved: two months later the money has moved twice", async () => {
    const first = await runSimulationBurst(burst(scripted([answer([TOLL]), JSON.stringify({ deltas: [TOLL] })], [RULE]), "I set up a toll on the coast road."));
    const port = scripted([answer([], "Time passes.")]);
    const later = await runSimulationBurst(burst(port, null, first.world, { spanDays: 90, budget: { ...DEFAULT_BUDGET, maxMechanicCalls: 0 } }));
    expect(port.calls.filter((call) => call === "write_mechanic")).toHaveLength(0);
    const rows = later.world.material.transactions.filter((row) => row.cause.kind === "mechanic");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const arrangement = later.world.genericEntities.find((entity) => entity.label === "A toll on the coast road")!;
    expect(arrangement.mechanic?.firedCount).toBeGreaterThanOrEqual(2);
    expect(later.newFacts.filter((fact) => fact.kind === "mechanic_fired").length).toBeGreaterThanOrEqual(2);
  });

  it("leaves the plain arrangement when the writer's rule cannot be read", async () => {
    const bad = JSON.stringify({ mechanic: { trigger: { kind: "monthly" }, conditions: [], effects: [{ op: "money_transfer", fromAccountId: "nobodys-purse", toAccountId: "leptines-purse", amount: { kind: "fixed", amount: 30 } }], end: { kind: "never" }, price: { setup: 1, upkeepPerMonth: 1 }, why: "x" } });
    const port = scripted([answer([TOLL]), JSON.stringify({ deltas: [TOLL] })], [bad, bad]);
    const result = await runSimulationBurst(burst(port, "I set up a toll on the coast road."));
    const arrangement = result.world.genericEntities.find((entity) => entity.label === "A toll on the coast road")!;
    expect(arrangement.mechanic).toBeUndefined();
    expect(result.audit.some((entry) => entry.kind === "mechanic_refused")).toBe(true);
  });

  it("only counts candidates when the budget is zero", async () => {
    const port = scripted([answer([TOLL]), JSON.stringify({ deltas: [TOLL] })]);
    const result = await runSimulationBurst(burst(port, "I set up a toll on the coast road.", opening(), { budget: { ...DEFAULT_BUDGET, maxMechanicCalls: 0 } }));
    expect(port.calls.filter((call) => call === "write_mechanic")).toHaveLength(0);
    expect(result.audit.filter((entry) => entry.kind === "mechanic_candidate")).toHaveLength(1);
    expect(result.mechanicCalls).toBe(0);
    expect(balance(result.world, "leptines-purse")).toBeLessThanOrEqual(balance(opening(), "leptines-purse"));
  });
});

/**
 * Play-test E20: a letter of respect became a paid rule that took a private
 * man's last coins. Pursuits and letters were offered to the writer like any
 * toll-house, the setup had a floor, and nothing asked whether he could pay.
 */
describe("what is never made a rule", () => {
  /** A writer that must not be asked: any call fails the burst's mechanic stage, and the audit says so. */
  const noWriter = (orchestrator: readonly string[]) => scripted(orchestrator, []);

  it("never offers a pursuit: an order that left nothing is what he is doing, not a business", async () => {
    const port = noWriter([answer([], "Leptines pays his respects to the king.")]);
    const result = await runSimulationBurst(burst(port, "I pay my respects to Hieron, and keep him in my regard."));
    expect(result.world.genericEntities.some((entity) => entity.kind === "pursuit")).toBe(true);
    expect(port.calls.filter((call) => call === "write_mechanic")).toHaveLength(0);
    expect(result.audit.filter((entry) => entry.kind === "mechanic_candidate")).toHaveLength(0);
  });

  it("never offers an arrangement that is a letter or a courtesy, nor one written beside a letter that does nothing", async () => {
    const respect = { ...TOLL, localId: "respect", kind: "respect", label: "Respects paid to Hieron", provinceId: null };
    const record = { ...TOLL, localId: "record", kind: "record", label: "What was written to the king", provinceId: null };
    const letter = {
      op: "diplomatic_message_send", localId: "the_letter", kind: "letter", fromPolityId: "syracuse", toPolityId: "syracuse", fromCharacterRef: "leptines-syracuse",
      toCharacterRef: "hieron-ii", subject: "My respects", terms: "Leptines sends his respects to the king.", replyWithinDays: null, inReplyToRef: null, visibility: "private", reason: "Courtesy.",
    };
    const port = noWriter([answer([letter, respect, record])]);
    const result = await runSimulationBurst(burst(port, "I write to Hieron with my respects."));
    expect(result.world.genericEntities.some((entity) => entity.label === "Respects paid to Hieron")).toBe(true);
    expect(port.calls.filter((call) => call === "write_mechanic")).toHaveLength(0);
    expect(result.audit.filter((entry) => entry.kind === "mechanic_candidate")).toHaveLength(0);
  });

  it("never offers an income kept from an act the engine prices: it pays by its own effect", async () => {
    const port = noWriter([answer([ALLOWANCE]), JSON.stringify({ deltas: [ALLOWANCE] })]);
    const result = await runSimulationBurst(burst(port, "I take an allowance from a patron."));
    expect(port.calls.filter((call) => call === "write_mechanic")).toHaveLength(0);
    expect(result.audit.filter((entry) => entry.kind === "mechanic_candidate")).toHaveLength(0);
  });

  it("refuses a rule a man cannot afford, unless his order said to pay for it", async () => {
    const poor = (): WorldState => {
      const base = opening();
      return { ...base, material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === "leptines-purse" ? { ...account, balance: 60 } : account)) } };
    };
    const dear = JSON.stringify({ mechanic: { ...(JSON.parse(RULE) as { mechanic: Record<string, unknown> }).mechanic, price: { setup: 10_000, upkeepPerMonth: 0 } } });
    const refused = await runSimulationBurst(burst(scripted([answer([TOLL]), JSON.stringify({ deltas: [TOLL] })], [dear]), "I set up a toll on the coast road.", poor()));
    const plain = refused.world.genericEntities.find((entity) => entity.label === "A toll on the coast road")!;
    expect(plain.mechanic).toBeUndefined();
    expect(refused.audit.some((entry) => entry.kind === "mechanic_refused" && /half of|on credit/.test(entry.reason))).toBe(true);
    expect(balance(refused.world, "leptines-purse")).toBe(60);
  });
});
