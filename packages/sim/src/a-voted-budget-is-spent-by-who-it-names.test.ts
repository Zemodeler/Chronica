import { describe, expect, it } from "vitest";
import { grantForBudget } from "./voted-budgets";
import { act, chestOf, holdersOf, opening } from "./competence-test-kit";

/**
 * A carried vote of money is the authority to spend it.
 *
 * An Officer of the Accounts (a quaestor, in Rome) may not draw on the chest himself: his every payment is laid before the chamber. But
 * once the chamber has carried a budget naming him, a playtest order to spend it was laid before the chamber again ("He moved it in the
 * chamber instead, and it waits on the vote"), so a vote of money never got spent without a second one.
 */

const [QUAESTOR] = holdersOf(opening(), "roman-quaestor") as [string];
const draw = (amount: number) => ({ op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: null, amount, reason: "Bread for the garrison." });

function withVote(amount: number) {
  const world = opening();
  const chest = chestOf(world, "rome");
  const grant = grantForBudget(world, { procedureId: "procedure-test", polityId: "rome", budget: { accountId: chest.id, amount, purpose: "Bread for the garrison", holderCharacterId: QUAESTOR } }, QUAESTOR, world.elapsedStep)!;
  return { world: { ...world, authorityGrants: [...world.authorityGrants, grant] }, chest };
}

describe("a carried budget is spent by the man it names", () => {
  it("lets the quaestor spend within the vote without moving it in the chamber again", () => {
    const { world, chest } = withVote(15_000);
    const done = act(world, QUAESTOR, draw(10_000), { order: true });
    expect(done.rejected).toEqual([]);
    expect(done.applied).toHaveLength(1);
    expect(chestOf(done.world, "rome").balance).toBe(chest.balance - 10_000);
    expect(done.world.material.politicalProcedures.length).toBe(world.material.politicalProcedures.length);
  });

  it("says what the vote left when more is asked, rather than moving the same money again", () => {
    const { world } = withVote(15_000);
    const done = act(world, QUAESTOR, draw(20_000), { order: true });
    expect(done.applied).toHaveLength(0);
    expect(done.rejected[0]!.reason).toMatch(/The vote .* gave 15000/);
    expect(done.world.material.politicalProcedures.length).toBe(world.material.politicalProcedures.length);
  });
});
