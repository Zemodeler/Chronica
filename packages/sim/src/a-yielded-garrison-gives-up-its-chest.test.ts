import { describe, expect, it } from "vitest";
import { disbandForces } from "@chronica/shared";
import { handChestsToTheTakers } from "./sieges";
import { auditMoney } from "./money-audit";
import { opening } from "./fiscal-test-kit";

/**
 * A garrison that yields gives up its chest with its arms (found by the money audit in the fifth year of a quiet world: a squadron's fifteen thousand
 * left the books when the chest was struck off). The chest goes to the treasury of the power that took the place, as a transfer between two accounts.
 */
describe("a yielded garrison gives up its chest", () => {
  it("moves what the chest held to the taker's treasury before the chest is struck off, and the audit finds nothing missing", () => {
    const world = opening(100);
    const force = world.material.forces.find((candidate) => candidate.id === "syracusan-squadron")!;
    const chest = world.material.accounts.find((account) => account.owner.kind === "force" && account.owner.id === force.id)!;
    expect(chest.balance).toBeGreaterThan(0);
    const handed = handChestsToTheTakers(world, new Map([[force.id, "carthage"]]), 100);
    const after = disbandForces(handed, new Set([force.id]), null);
    expect(after.material.accounts.some((account) => account.id === chest.id)).toBe(false);
    const treasury = (state: typeof world) => state.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "carthage")!.balance;
    expect(treasury(after)).toBe(treasury(world) + chest.balance);
    expect(auditMoney(world, after).unexplained).toEqual([]);
    // Without it the chest's money would have gone from the books.
    expect(auditMoney(world, disbandForces(world, new Set([force.id]), null)).unexplained.length).toBe(1);
  });
});
