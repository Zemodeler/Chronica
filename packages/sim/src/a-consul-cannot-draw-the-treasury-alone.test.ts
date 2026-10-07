import { describe, expect, it } from "vitest";
import { competenceOf, monthlyTakings, spendingAllowance } from "@chronica/shared";
import { act, atDay, chestOf, government, holdersOf, opening } from "./competence-test-kit";

/**
 * A consul cannot draw the treasury alone.
 *
 * The consuls drew funds by decree of the Senate, and the quaestors paid out nothing it had not voted. A consul's own word is
 * good for a measure of the chest in a year -- his allowance, in months of what the state takes in -- and past it the Senate must
 * decree. The quaestor, whose Treasury of Saturn is kept by the Senate's gate, has no allowance at all: his every payment is
 * laid before it.
 */

const [CONSUL, COLLEAGUE] = holdersOf(opening(), "roman-consul") as [string, string];
const draw = (amount: number) => ({ op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: null, amount, reason: "Silver for the war." });

describe("a consul cannot draw the treasury alone", () => {
  it("has an allowance of two months of what Rome takes in, and a quaestor none", () => {
    const world = opening();
    const takings = monthlyTakings(world, "rome");
    expect(takings).toBeGreaterThan(300_000);
    const consul = spendingAllowance(world, "roman-consul", government.offices)!;
    expect(consul).toMatchObject({ amount: 2 * takings, spent: 0, left: 2 * takings, grade: "with_colleague" });
    expect(consul.body?.id).toBe("roman-senate");
    expect(spendingAllowance(world, "roman-quaestor", government.offices)).toMatchObject({ amount: 0, left: 0, grade: "by_the_body", body: { id: "roman-senate" } });
    expect(competenceOf(world, "roman-quaestor", government.offices)!.acts.spending.why).toMatch(/may not draw upon the treasury himself: it is laid before the Senate/);
  });

  it("may draw within it, and is charged for it", () => {
    const world = opening();
    const allowance = spendingAllowance(world, "roman-consul", government.offices)!.amount!;
    const done = act(world, CONSUL, draw(Math.floor(allowance * 0.6)));
    expect(done.rejected).toEqual([]);
    expect(chestOf(done.world, "rome").balance).toBe(chestOf(world, "rome").balance - Math.floor(allowance * 0.6));
    const left = spendingAllowance(done.world, "roman-consul", government.offices)!;
    expect(left.spent).toBe(Math.floor(allowance * 0.6));
    // The allowance is the office's, and either consul draws on it.
    expect(left.left).toBe(allowance - Math.floor(allowance * 0.6));
  });

  it("is told that more is the Senate's, and what he moves in the Senate waits on its vote", () => {
    const world = opening();
    const allowance = spendingAllowance(world, "roman-consul", government.offices)!.amount!;
    const first = act(world, CONSUL, draw(Math.floor(allowance * 0.6))).world;
    const unlaid = act(first, COLLEAGUE, draw(Math.floor(allowance * 0.6)));
    expect(unlaid.applied).toHaveLength(0);
    expect(unlaid.rejected[0]!.reason).toMatch(/may draw upon the treasury, to 2 months of what the power takes in in a year, and no further: more than that is laid before the Senate/);
    expect(chestOf(unlaid.world, "rome").balance).toBe(chestOf(first, "rome").balance);
    // As the player's order, it is put to the Senate, which is where the money is decreed.
    const laid = act(first, COLLEAGUE, draw(Math.floor(allowance * 0.6)), { order: true });
    expect(laid.rejected[0]!.reason).toMatch(/He moved it in the chamber instead, and it waits on the vote/);
    expect(laid.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "roman-senate", sponsorCharacterId: COLLEAGUE });
    expect(chestOf(laid.world, "rome").balance).toBe(chestOf(first, "rome").balance);
  });

  it("begins the year again after a year", () => {
    const world = opening();
    const allowance = spendingAllowance(world, "roman-consul", government.offices)!.amount!;
    const first = act(world, CONSUL, draw(Math.floor(allowance * 0.9))).world;
    expect(act(first, CONSUL, draw(Math.floor(allowance * 0.3))).applied).toHaveLength(0);
    const later = atDay(first, 200 + 361);
    expect(spendingAllowance(later, "roman-consul", government.offices)!.spent).toBe(0);
    expect(act(later, CONSUL, draw(Math.floor(allowance * 0.3))).applied).toHaveLength(1);
  });

  it("keeps a quaestor from drawing anything of his own: the Senate keeps the Treasury of Saturn", () => {
    const world = opening();
    const quaestor = holdersOf(world, "roman-quaestor")[0]!;
    const done = act(world, quaestor, draw(1_000));
    expect(done.applied).toHaveLength(0);
    expect(chestOf(done.world, "rome").balance).toBe(chestOf(world, "rome").balance);
  });
});
