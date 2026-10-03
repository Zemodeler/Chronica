import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, ventureTerms, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { DEFAULT_BUDGET, runSimulationBurst, type BurstInput } from "./burst";
import { withMiddlingManagers } from "./middling-managers";
import { createIdFactory, type SimModelPort, type SimOperation } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * Play-test E19 and L9: a merchant's first venture took his whole purse, and
 * his cargo was charged twice.
 *
 * The model wrote the cargo as a venture and the money it brings as an income
 * besides. The income into a private purse was refused with words that sent
 * the repair to an arrangement, and the arrangement was priced again: the
 * merchant paid twice for one ship. Short of the price, the whole purse went
 * down as the deposit. And the ship never came in: it paid a trickle a month.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const SYRACUSE = PUNIC_IDS.syracuse;
const MESSANA = PUNIC_IDS.messana;
const LEPTINES = { kind: "character" as const, id: "leptines-syracuse" };
const withPurse = (amount: number): WorldState => {
  const base = withMiddlingManagers(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
  return { ...base, material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === "leptines-purse" ? { ...account, balance: amount } : account)) } };
};
const balance = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === id)!.balance;

function scripted(answers: readonly string[]): SimModelPort & { calls: SimOperation[] } {
  const queue = [...answers];
  const calls: SimOperation[] = [];
  return {
    calls,
    complete(operation: SimOperation) {
      calls.push(operation);
      if (operation === "simulate_orchestrate" || operation === "repair_deltas") {
        const next = queue.shift();
        if (next !== undefined) return Promise.resolve(next);
      }
      if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
      return Promise.reject(new Error(`nothing scripted for ${operation}`));
    },
  };
}
const answer = (deltas: readonly unknown[]) => JSON.stringify({
  intent: { summary: "Leptines ships a cargo of oil to Messana.", domains: ["trade"] }, narrativeSummary: "Leptines ships a cargo of oil to Messana.", frictions: [], deltas, facts: [],
  delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
});
const burst = (port: SimModelPort, world: WorldState, spanDays = 1): BurstInput => ({
  world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  burstId: "cargo", gameId: "game-1", actorRef: LEPTINES, actorPolityId: "syracuse", orderText: "I buy a cargo of oil and ship it to Messana.", knownFacts: [], queue: [],
  port, spanDays, narratorSeeds: [], budget: { ...DEFAULT_BUDGET, maxMechanicCalls: 0 },
});

const CARGO = {
  op: "trade_venture_open", localId: "oil", title: "Oil to Messana", ownerCharacterRef: "leptines-syracuse", fromProvinceId: SYRACUSE, toProvinceId: MESSANA,
  band: "great", paidFromAccountRef: "leptines-purse", reason: "A cargo of oil.",
};
/** The same cargo written a second time, as an income: refused, and the repair makes it an arrangement that pays. */
const ITS_INCOME = { op: "income_source_upsert", incomeSourceRef: null, kind: "trade", label: "Profit of the oil cargo", beneficiaryAccountRef: "leptines-purse", amount: 120, cadenceDays: 30, reason: "The cargo pays." };
const REPAIRED = {
  op: "generic_entity_create", localId: "oil_trade", kind: "trade", label: "The oil trade to Messana", ownerRef: LEPTINES, attributes: {}, provinceId: SYRACUSE,
  effects: [{ quantity: "income", direction: "raise", band: "marked", scope: "here" }], upkeep: null, reason: "The cargo pays.",
};

describe("a merchant with two thousand drachmae ships one cargo", () => {
  it("is charged once, keeps something back, and is paid when the ship comes in", async () => {
    const start = withPurse(2_000);
    const price = ventureTerms(start, SYRACUSE, MESSANA, "great")!.price;
    const result = await runSimulationBurst(burst(scripted([answer([CARGO, ITS_INCOME]), JSON.stringify({ deltas: [REPAIRED] })]), start));
    // One venture, and no second business priced beside it.
    expect(result.world.material.ventures).toHaveLength(1);
    expect(result.world.genericEntities.some((entity) => entity.label === "The oil trade to Messana")).toBe(false);
    expect(result.world.genericEntities.filter((entity) => entity.ownerRef?.id === LEPTINES.id && (entity.effects ?? []).some((effect) => effect.quantity === "income"))).toHaveLength(0);
    // Charged once: what he paid down and what he owes come to the venture's price, and no more.
    const paid = result.world.material.transactions.filter((row) => row.sourceAccountId === "leptines-purse" && row.kind === "purchase").reduce((sum, row) => sum + row.amount, 0);
    const owed = result.world.material.loans.filter((loan) => loan.borrowerAccountId === "leptines-purse").reduce((sum, loan) => sum + loan.principal, 0);
    expect(paid + owed).toBe(price);
    // Never the whole purse: a tenth of it is kept back.
    expect(balance(result.world, "leptines-purse")).toBeGreaterThanOrEqual(200);

    const venture = result.world.material.ventures[0]!;
    const landed = runDeterministicTick({ world: result.world, toDay: venture.cargo!.arrivesAtStep, ids: createIdFactory("landed"), warfare: definition.warfare });
    const sale = landed.world.material.transactions.find((row) => row.destinationAccountId === "leptines-purse" && row.kind === "income" && row.cause.id === venture.incomeSourceId)!;
    expect(sale.amount).toBeGreaterThan(price);
    expect(landed.factProposals.some((fact) => fact.kind === "cargo_sold")).toBe(true);
  });

  it("puts down all but a tenth when the price is more than he would part with", () => {
    const start = withPurse(1);
    const price = ventureTerms(start, SYRACUSE, MESSANA, "great")!.price;
    const purse = price + 20;
    const world = withPurse(purse);
    const bought = applyDeltas(world, [WorldDeltaSchema.parse(CARGO)], {
      now: { day: 0, minute: 540 }, actorRef: LEPTINES, offices: definition.government.offices, warfare: definition.warfare, ids: createIdFactory("buy"), gameId: "game-1",
    });
    expect(bought.rejected).toEqual([]);
    expect(balance(bought.world, "leptines-purse")).toBe(Math.ceil(purse * 0.1));
    const credit = bought.factProposals.find((fact) => fact.kind === "bought_on_credit")!;
    expect(credit.summary).toContain("kept back");
  });
});
