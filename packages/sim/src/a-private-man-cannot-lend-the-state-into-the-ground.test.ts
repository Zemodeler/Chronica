import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { termPeriodsOf } from "./lending";

/**
 * A merchant lent the treasury 4,500 at "100% a month" and was paid about 49,000 back: the loan needed nobody's consent, no rate was too high and the term he
 * wrote ("12 instalments") was ignored. A loan to a state is a negotiated act now: a rate within what its credit bears, a sum within its takings, a term kept,
 * and a treasury that has no need does not borrow.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const context = (actor: string): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory("lend"), gameId: "game-lend", playerCharacterId: actor,
});
const opening = (): WorldState => {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: 1_000 } : account.id === "curius-purse" ? { ...account, balance: 60_000 } : account)) } };
};
const lend = (world: WorldState, principal: number, interestBps: number, terms: string) => applyDeltas(world, [WorldDeltaSchema.parse({
  op: "loan_open", localId: "to_the_state", lenderKind: "character", lenderRef: "manius-curius", borrowerAccountRef: "rome-treasury", principal, interestBps, cadenceDays: 30, terms,
  collateralHoldingRef: null, reason: "He lends the treasury money.",
})], context("manius-curius"));

describe("a private man lends the state", () => {
  it("is refused at a rate the state's credit does not bear, with the reason", () => {
    const result = lend(opening(), 4_500, 10_000, "A loan to the treasury at 100% a month");
    expect(result.world.material.loans).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/will not borrow at 100 in the hundred/);
  });

  it("is refused a sum beyond what its takings carry", () => {
    const big = lend(opening(), 50_000_000, 100, "A great loan");
    expect(big.rejected[0]!.reason).toMatch(/too much|takes no more/);
  });

  it("is taken at the going rate, and the term he wrote is the term it runs", () => {
    const result = lend(opening(), 4_500, 100, "A loan to the treasury at 1% a month, repaid in 12 instalments");
    expect(result.rejected).toEqual([]);
    const loan = result.world.material.loans[0]!;
    expect(loan.interestBps).toBeLessThanOrEqual(100);
    expect(result.world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)!.remainingPeriods).toBe(12);
  });

  it("reads a term from his words, and a rate no man asks of another is refused in private too", () => {
    expect(termPeriodsOf("paid back over 18 months", 24)).toBe(18);
    expect(termPeriodsOf("in 12 instalments", 24)).toBe(12);
    expect(termPeriodsOf("someday", 24)).toBe(24);
    const private50 = applyDeltas(opening(), [WorldDeltaSchema.parse({
      op: "loan_open", localId: "usury", lenderKind: "character", lenderRef: "manius-curius", borrowerAccountRef: "gaius-purse", principal: 300, interestBps: 5_000, cadenceDays: 30, terms: "300 at 50% a month",
      collateralHoldingRef: null, reason: "He lends at usury.",
    })], context("manius-curius"));
    expect(private50.rejected[0]!.reason).toMatch(/Nobody lends or borrows/);
  });
});
