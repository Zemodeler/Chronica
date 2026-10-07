import { describe, expect, it } from "vitest";
import { competenceOf, gradeAt, mayAct, monthlyTakings } from "@chronica/shared";
import { act, chestOf, customsOf, government, holdersOf, opening, rateOf, taxSet } from "./competence-test-kit";

/**
 * "The quaestor keeps the Treasury of Saturn; he does not lay the tribute as he pleases."
 *
 * Whether a man may set the rate of the tribute was a question of what his office was called: any office the engine took
 * for a treasurer's could do it, as high as it liked, and the consul who commanded the armies could not. Now the answer is
 * read from the constitution (`competenceOf`): a quaestor of Rome sets the rate within custom, as one of four of equal power; the
 * rate past custom is the Senate's to decree; the coin, the tariff and every loan are the Senate's too (H1: the censors, who let the harbour
 * dues, keep the tariff within a tenth), and the consul, who may set the rate within custom beside his colleague, may not strike the coin
 * with other silver.
 */

const QUAESTOR = (world = opening()) => holdersOf(world, "roman-quaestor")[0]!;
const CONSUL = (world = opening()) => holdersOf(world, "roman-consul")[0]!;

describe("a treasurer decides", () => {
  it("reads a quaestor's charge from the constitution: the rate within custom, and nothing of the tariff or the coin", () => {
    const world = opening();
    const quaestor = competenceOf(world, "roman-quaestor", government.offices)!;
    expect(quaestor.acts.tax_rate.grade).toBe("with_colleague");
    expect(quaestor.acts.tax_rate.within).toBe(1_200);
    expect(quaestor.acts.tax_rate.beyond).toBe("by_the_body");
    expect(quaestor.acts.tax_rate.body?.name).toBe("Senate");
    expect(quaestor.acts.customs.grade).toBe("by_the_body");
    expect(quaestor.acts.coinage.grade).toBe("forbidden");
    expect(quaestor.acts.war.grade).toBe("forbidden");
    // Past custom, the same office reads as the Senate's.
    expect(gradeAt(quaestor.acts.tax_rate, 1_800)).toBe("by_the_body");
    expect(gradeAt(quaestor.acts.tax_rate, 1_000)).toBe("with_colleague");
    // And what he may draw from the chest is the Senate's to vote: the Treasury of Saturn paid out nothing it had not voted.
    expect(quaestor.acts.spending.grade).toBe("by_the_body");
    expect(mayAct(world, QUAESTOR(world), "tax_rate", { offices: government.offices })?.grade).toBe("with_colleague");
  });

  it("lets the quaestor lay the rate of the tribute within custom, and nobody thinks it a breach", () => {
    const world = opening();
    const done = act(world, QUAESTOR(world), taxSet("rome", 1_100));
    expect(done.rejected).toEqual([]);
    expect(rateOf(done.world, "rome")).toBe(1_100);
    expect(done.breaches).toEqual([]);
    expect(done.applied[0]?.authority.reason).toMatch(/quaestor may lay the rate of the tribute/i);
    // The tariff is the censors' (they let the harbour dues), within a tenth, and the quaestor may not lay it.
    const refused = act(world, QUAESTOR(world), taxSet("rome", 600, "customs"));
    expect(refused.applied).toHaveLength(0);
    expect(refused.rejected[0]!.reason).toMatch(/Senate/);
    const censor = holdersOf(world, "roman-censor")[0]!;
    const customs = act(world, censor, taxSet("rome", 600, "customs"));
    expect(customs.rejected).toEqual([]);
    expect(customsOf(customs.world, "rome")).toBe(600);
    expect(act(world, censor, taxSet("rome", 1_400, "customs")).rejected[0]!.reason).toMatch(/Senate/);
  });

  it("will not let him lay it past custom: that is the Senate's, and he is told so", () => {
    const world = opening();
    const done = act(world, QUAESTOR(world), taxSet("rome", 1_800));
    expect(done.applied).toHaveLength(0);
    expect(done.rejected[0]!.reason).toMatch(/Senate/);
    expect(rateOf(done.world, "rome")).toBe(rateOf(world, "rome"));
  });

  it("will not let him change the silver of the coin, which no charge of his holds", () => {
    const world = opening();
    const done = act(world, QUAESTOR(world), { op: "coinage_debase", coinageId: "roman_aes_and_silver", targetSilverBps: null, stepBps: -500, reason: "The treasury is short." });
    expect(done.applied).toHaveLength(0);
    expect(done.rejected[0]!.kind).toBe("ignored");
  });

  it("does not let the consul strike the coin either: he moves it in the Senate, where it waits on the vote", () => {
    const world = opening();
    const consul = CONSUL(world);
    const raw = { op: "coinage_debase", coinageId: "roman_aes_and_silver", targetSilverBps: null, stepBps: -500, reason: "The war must be paid for." };
    const unlaid = act(world, consul, raw);
    expect(unlaid.rejected[0]!.reason).toMatch(/Senate/);
    expect(unlaid.world.material.politicalProcedures.length).toBe(world.material.politicalProcedures.length);
    const laid = act(world, consul, raw, { order: true });
    expect(laid.rejected[0]!.reason).toMatch(/moved it in the chamber instead, and it waits on the vote/);
    const motion = laid.world.material.politicalProcedures.at(-1)!;
    expect(motion.label).toMatch(/Motion of .*: that Roman aes and silver be struck with less silver/i);
    expect(motion.concerns).toContain("coinage");
    expect(chestOf(laid.world, "rome").balance).toBe(chestOf(world, "rome").balance);
  });

  it("lays every loan before the Senate, the quaestor's and the consul's alike: no magistrate borrows in the state's name alone", () => {
    const world = opening();
    const takings = monthlyTakings(world, "rome");
    const loan = (principal: number) => ({
      op: "loan_open", localId: "the_loan", lenderKind: "foreign", lenderRef: null, borrowerAccountRef: "rome-treasury", principal, interestBps: 200,
      cadenceDays: 30, terms: "Silver of the bankers abroad.", reason: "The chest is short.",
    });
    for (const man of [QUAESTOR(world), CONSUL(world)]) {
      const small = act(world, man, loan(Math.floor(takings * 0.5)));
      expect(small.applied).toHaveLength(0);
      expect(small.rejected[0]!.reason).toMatch(/may not borrow in the state's name himself: it is laid before the Senate/);
    }
    // Laid by the order, it is moved in the Senate and done the day the vote carries it.
    const laid = act(world, CONSUL(world), loan(Math.floor(takings * 2.5)), { order: true });
    expect(laid.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "roman-senate" });
  });

  it("lets an aedile give out a month's takings in bread to the people, and sends the rest to the Senate", () => {
    const world = opening();
    const takings = monthlyTakings(world, "rome");
    const aedile = holdersOf(world, "roman-aedile")[0]!;
    const dole = (amount: number) => ({ op: "public_benefaction", payerAccountRef: "rome-treasury", amount, kind: "dole", provinceId: null, reason: "Bread for the city." });
    const within = act(world, aedile, dole(Math.floor(takings * 0.4)));
    expect(within.rejected).toEqual([]);
    const past = act(world, aedile, dole(Math.floor(takings * 1.4)));
    expect(past.applied).toHaveLength(0);
    expect(past.rejected[0]!.reason).toMatch(/may buy bread and give it out, to 1 month of what the power takes in in a year, and no further/);
  });

  it("is the same for the Carthaginian officers of the accounts, who keep its books beside the suffetes", () => {
    const world = opening();
    const accountant = holdersOf(world, "carthaginian-accountant")[0]!;
    const done = act(world, accountant, taxSet("carthage", 1_100));
    expect(done.rejected).toEqual([]);
    expect(rateOf(done.world, "carthage")).toBe(1_100);
  });
});
