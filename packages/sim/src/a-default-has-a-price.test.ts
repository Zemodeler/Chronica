import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, admissionRefusal, allOffices, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * Default was nearly free: a loan went unpaid and the lender's only loss was his money. Now the debtor's goods are sold (Rome after the lex Poetelia of 326
 * does not chain a citizen: his purse goes to the lender, and he is infamous for five years), his standing falls, and no lender deals with him.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gnaeus-cornelius" }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory("def"), gameId: "game-def", actsForTheWorld: true,
});

describe("a default has a price", () => {
  const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const loan = applyDeltas(base, [WorldDeltaSchema.parse({
    op: "loan_open", localId: "debt", lenderKind: "character", lenderRef: "gnaeus-cornelius", borrowerAccountRef: "curius-purse", principal: 800, interestBps: 100, cadenceDays: 30, terms: "800 to Curius",
    collateralHoldingRef: null, reason: "He lends.",
  })], context());
  const loanId = loan.world.material.loans[0]!.id;
  const defaulted: WorldState = { ...loan.world, material: { ...loan.world.material, loans: loan.world.material.loans.map((candidate) => ({ ...candidate, status: "defaulted" as const })) } };

  it("takes the debtor's purse for the lender, costs him his name and his credit, and says so", () => {
    expect(loanId).toBeTruthy();
    const purseBefore = defaulted.material.accounts.find((account) => account.id === "curius-purse")!.balance;
    const lenderBefore = defaulted.material.accounts.find((account) => account.id === "blasio-purse" || account.owner.id === "gnaeus-cornelius")!;
    const standingBefore = defaulted.characters.find((character) => character.id === "manius-curius")!.prestigeBps;
    const ticked = runDeterministicTick({ world: defaulted, toDay: 30, ids: createIdFactory("def-30"), warfare: definition.warfare });
    const fact = ticked.factProposals.find((candidate) => candidate.kind === "default_priced");
    expect(fact?.summary).toMatch(/goods were sold for the debt/);
    expect(fact?.summary).toMatch(/Poetelius/);
    const purseAfter = ticked.world.material.accounts.find((account) => account.id === "curius-purse")!.balance;
    expect(purseAfter).toBeLessThan(purseBefore + 5_000);
    expect(ticked.world.material.transactions.some((row) => row.kind === "confiscation" && row.sourceAccountId === "curius-purse" && row.destinationAccountId === lenderBefore.id)).toBe(true);
    expect(ticked.world.material.accounts.find((account) => account.id === lenderBefore.id)!.balance).toBeGreaterThan(lenderBefore.balance);
    expect(ticked.world.characters.find((character) => character.id === "manius-curius")!.prestigeBps).toBeLessThan(standingBefore);
    // Nobody lends to him again, and no magistracy is open to him: he is infamous.
    const again = applyDeltas(ticked.world, [WorldDeltaSchema.parse({
      op: "loan_open", localId: "again", lenderKind: "character", lenderRef: "gnaeus-cornelius", borrowerAccountRef: "curius-purse", principal: 100, interestBps: 100, cadenceDays: 30, terms: "100 more",
      collateralHoldingRef: null, reason: "He lends again.",
    })], { ...context(), actorRef: { kind: "character", id: "gnaeus-cornelius" }, actsForTheWorld: false });
    expect(again.rejected[0]?.reason).toMatch(/credit is gone/);
    const aedile = allOffices({}, definition.government.offices).find((office) => office.id === "roman-aedile")!;
    const him = ticked.world.characters.find((character) => character.id === "manius-curius")!;
    expect(admissionRefusal(ticked.world, aedile, aedile.eligibilityRequirementIds, him, 40)).toMatch(/infamous/);
  });

  it("is priced once", () => {
    const first = runDeterministicTick({ world: defaulted, toDay: 30, ids: createIdFactory("def-30"), warfare: definition.warfare });
    const second = runDeterministicTick({ world: first.world, toDay: 60, ids: createIdFactory("def-60"), warfare: definition.warfare });
    expect(second.factProposals.filter((candidate) => candidate.kind === "default_priced")).toHaveLength(0);
  });
});
