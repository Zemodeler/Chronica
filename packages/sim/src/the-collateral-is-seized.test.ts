import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { LOAN_TERM_PERIODS, loanInstalment } from "./debts";

/**
 * A debt that ends, one way or the other.
 *
 * A loan was served with its interest for ever: the principal was never paid
 * back and had no term, and a loan in default left the land pledged for it
 * exactly where it was. Now a loan is paid back in instalments over its term,
 * and a loan in default forfeits its pledge to the man who lent the money.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices,
  warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory("debt"), gameId: "game-1", actsForTheWorld: true,
});
const balance = (world: WorldState, id: string) => world.material.accounts.find((account) => account.id === id)!.balance;
const setBalance = (world: WorldState, id: string, value: number): WorldState => ({
  ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === id ? { ...account, balance: value } : account)) },
});

/** Genucius borrows from Blasio against his estates. */
const BORROW: WorldDelta = {
  op: "loan_open", localId: "estate_loan", lenderKind: "character", lenderRef: "gnaeus-cornelius", borrowerAccountRef: "gaius-purse",
  principal: 1_200, interestBps: 100, cadenceDays: 30, terms: "A loan against the Genucian estates", collateralHoldingRef: "genucian-estates",
  reason: "He needs ready money for the games.",
};

function borrowed(): WorldState {
  const result = applyDeltas(opening(), [BORROW], context());
  expect(result.rejected).toEqual([]);
  return result.world;
}

function months(world: WorldState, count: number) {
  let current = world;
  const kinds: string[] = [];
  for (let month = 1; month <= count; month += 1) {
    const ticked = runDeterministicTick({ world: current, toDay: month * 30, ids: createIdFactory(`debt-${month}`), warfare: definition.warfare });
    expect(WorldStateSchema.safeParse(ticked.world).success).toBe(true);
    current = ticked.world;
    kinds.push(...ticked.factProposals.map((fact) => String(fact.kind)));
  }
  return { world: current, kinds };
}

describe("the collateral is seized", { timeout: 30_000 }, () => {
  it("is paid back in instalments: the interest on what is owed, and a share of it", () => {
    const world = borrowed();
    const loan = world.material.loans[0]!;
    const servicing = world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)!;
    expect(servicing.remainingPeriods).toBe(LOAN_TERM_PERIODS);
    expect(servicing.amount).toBe(loanInstalment(1_200, 100, LOAN_TERM_PERIODS));
    // A few months on, less is owed, and each instalment is smaller for it.
    const later = months(setBalance(world, "gaius-purse", 100_000), 6).world;
    const owed = later.material.loans[0]!.outstanding;
    expect(owed).toBeLessThan(1_200);
    expect(owed).toBeGreaterThan(0);
    const smaller = runDeterministicTick({ world: later, toDay: 181, ids: createIdFactory("look"), warfare: definition.warfare }).world;
    expect(smaller.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)!.amount).toBeLessThan(servicing.amount);
  });

  it("is done after its last instalment, and the lender has his money back", () => {
    const world = setBalance(borrowed(), "gaius-purse", 100_000);
    const lenderBefore = balance(world, "blasio-purse");
    const term = months(world, LOAN_TERM_PERIODS + 1);
    const loan = term.world.material.loans[0]!;
    expect(loan.status).toBe("repaid");
    expect(loan.outstanding).toBe(0);
    expect(term.kinds).toContain("loan_repaid");
    expect(term.world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)!.active).toBe(false);
    // The principal came home, and the interest with it.
    expect(balance(term.world, "blasio-purse")).toBeGreaterThanOrEqual(lenderBefore + 1_200);
  });

  it("forfeits the estates to the lender when it goes unpaid, and their rents follow", () => {
    // Genucius spends the money and his estates stop paying: nothing to serve the debt with.
    const broke = setBalance(borrowed(), "gaius-purse", 0);
    const starved: WorldState = {
      ...broke,
      material: { ...broke.material, incomeSources: broke.material.incomeSources.map((source) => (source.id === "genucian-estates-yield" ? { ...source, amount: 1 } : source)) },
    };
    const defaulted = months(starved, 5);
    const loan = defaulted.world.material.loans[0]!;
    expect(loan.status).toBe("defaulted");
    expect(defaulted.kinds).toContain("loan_defaulted");
    expect(defaulted.kinds).toContain("collateral_seized");
    const estates = defaulted.world.material.holdings.find((holding) => holding.id === "genucian-estates")!;
    expect(estates.legalHolderCharacterId).toBe("gnaeus-cornelius");
    expect(defaulted.world.material.incomeSources.find((source) => source.id === "genucian-estates-yield")!.beneficiaryAccountId).toBe("blasio-purse");
    // Once.
    expect(months(defaulted.world, 1).kinds.filter((kind) => kind === "collateral_seized")).toHaveLength(0);
  });

  it("gives a loan written before loans had terms a term from today", () => {
    const world = borrowed();
    const loan = world.material.loans[0]!;
    // As the old engine wrote it: interest only, running for ever.
    const legacy: WorldState = {
      ...world,
      material: { ...world.material, obligations: world.material.obligations.map((obligation) => (obligation.id === loan.serviceObligationId ? { ...obligation, amount: 12, remainingPeriods: undefined } : obligation)) },
    };
    const ticked = runDeterministicTick({ world: legacy, toDay: 1, ids: createIdFactory("legacy"), warfare: definition.warfare }).world;
    const servicing = ticked.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)!;
    expect(servicing.remainingPeriods).toBe(LOAN_TERM_PERIODS);
    expect(servicing.amount).toBe(loanInstalment(1_200, 100, LOAN_TERM_PERIODS));
  });
});
