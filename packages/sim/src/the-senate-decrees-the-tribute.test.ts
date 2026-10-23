import { describe, expect, it } from "vitest";
import { actMarkOf, bodyFor, competenceOf, mayAct } from "@chronica/shared";
import { holdVotes } from "./senate";
import { createIdFactory } from "./ports";
import { act, actCarried, atDay, government, holdersOf, opening, rateOf, taxSet } from "./competence-test-kit";

/**
 * The Senate decrees the tribute.
 *
 * A consul may lay the rate within custom, with his colleague. Past custom the rate is the Senate's: his order is not done,
 * it is moved in the Senate, where it waits on the vote, and done the day it carries (`sanctionedDeltas`). A magistrate does
 * not change in the season what the Senate has decreed.
 */

const [CONSUL, COLLEAGUE] = holdersOf(opening(), "roman-consul") as [string, string];

describe("the Senate decrees the tribute", () => {
  it("is the chamber that holds the taxes, by what the constitution says of it", () => {
    const world = opening();
    expect(bodyFor(world, "rome", "tax_rate", world.constitutions.find((record) => record.polityId === "rome"))).toMatchObject({ id: "roman-senate" });
    // The same body holds the mint and the purse by the old bundle of taxes, as it always did.
    expect(bodyFor(world, "rome", "coinage")?.id).toBe("roman-senate");
    expect(bodyFor(world, "rome", "spending")?.id).toBe("roman-senate");
    expect(competenceOf(world, "roman-consul", government.offices)!.acts.tax_rate.beyond).toBe("by_the_body");
    expect(mayAct(world, CONSUL, "tax_rate", { offices: government.offices, magnitude: 1_800 })).toMatchObject({ grade: "by_the_body", body: { id: "roman-senate" } });
  });

  it("is not told a rate past custom is done: the order is moved in the Senate and waits on the vote", () => {
    const world = opening();
    const laid = act(world, CONSUL, taxSet("rome", 1_800), { order: true });
    expect(laid.applied.filter((entry) => entry.delta.op === "tax_policy_set")).toHaveLength(0);
    expect(laid.rejected[0]!.reason).toMatch(/may lay the rate of the tribute, to a rate of 12 in a hundred, and no further: more than that is laid before the Senate, and he may move it there\. He moved it in the chamber instead, and it waits on the vote\./);
    expect(rateOf(laid.world, "rome")).toBe(rateOf(world, "rome"));
    const motion = laid.world.material.politicalProcedures.at(-1)!;
    expect(motion).toMatchObject({ institutionId: "roman-senate", sponsorCharacterId: CONSUL, type: "council_deliberation" });
    expect(motion.label).toMatch(/^Motion of .*: that the tribute of Roman Republic be laid at 18 in a hundred$/);
    expect(motion.concerns).toContain("taxes");
    // The Senate counts it as its own business, and the blocs lean by what each wants of a tax.
    const counted = holdVotes({ world: laid.world, offices: government.offices, successionRules: government.successionRules, toDay: laid.world.elapsedStep + 10, ids: createIdFactory("senate-count") });
    const settled = counted.world.material.politicalProcedures.find((procedure) => procedure.id === motion.id)!;
    expect(["passed", "failed"]).toContain(settled.outcome);
    expect(counted.world.material.voteRecords.length).toBeGreaterThan(world.material.voteRecords.length);
  });

  it("is told so, and nothing is laid, where it is not the order's: a man's own word is not moved for him", () => {
    const world = opening();
    const unlaid = act(world, CONSUL, taxSet("rome", 1_800));
    expect(unlaid.applied).toHaveLength(0);
    expect(unlaid.rejected[0]!.reason).toMatch(/laid before the Senate/);
    expect(unlaid.world.material.politicalProcedures.length).toBe(world.material.politicalProcedures.length);
  });

  it("is done the day it carries, and the Senate's decree stands against any magistrate for the season", () => {
    const world = opening();
    const waiting = act(world, CONSUL, taxSet("rome", 1_800), { order: true }).rejected[0]!.written!;
    const carried = actCarried(atDay(world, 210), CONSUL, waiting);
    expect(carried.rejected).toEqual([]);
    expect(rateOf(carried.world, "rome")).toBe(1_800);
    // Decreed by the chamber, it is no consul's: the other consul may not change it in the season...
    const mark = actMarkOf(carried.world.actMarks, "rome", "tax_rate")!;
    expect(mark.byCharacterId).toBeNull();
    const meddled = act(atDay(carried.world, 240), COLLEAGUE, taxSet("rome", 1_000));
    expect(meddled.applied).toHaveLength(0);
    expect(meddled.rejected[0]!.reason).toMatch(/the chamber settled this 30 days ago by decree/);
    // ...and when the season is out, within custom, either may.
    expect(act(atDay(carried.world, 300), COLLEAGUE, taxSet("rome", 1_000)).applied).toHaveLength(1);
  });

  it("lays a pact before the Senate, as a war always was, and lets a king make his own", () => {
    const world = opening();
    const pact = { op: "agreement_open", localId: "pact", kind: "trade_pact", polityId: "rome", otherPolityId: "syracuse", terms: "No customs above five in a hundred.", forDays: null, reason: "Trade." };
    const laid = act(world, CONSUL, pact, { order: true });
    expect(laid.applied.filter((entry) => entry.delta.op === "agreement_open")).toHaveLength(0);
    expect(laid.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "roman-senate", type: "treaty_ratification" });
    expect(laid.rejected[0]!.reason).toMatch(/may not make a pact or an alliance himself: it is laid before the Senate/);
    const king = holdersOf(world, "syracusan-king")[0]!;
    const struck = act(world, king, { ...pact, polityId: "syracuse", otherPolityId: "rome" });
    expect(struck.rejected).toEqual([]);
    expect(struck.world.polityAgreements.some((agreement) => agreement.kind === "trade_pact" && [agreement.polityId, agreement.otherPolityId].includes("syracuse"))).toBe(true);
    // The other side's name written first changes nothing: the actor's own power is the one that is asked.
    const reversed = act(world, king, { ...pact, polityId: "rome", otherPolityId: "syracuse" });
    expect(reversed.rejected).toEqual([]);
  });

  it("is a king's own where no chamber that binds holds the taxes: Hiero sets it alone", () => {
    const world = opening();
    const king = holdersOf(world, "syracusan-king")[0]!;
    const competence = competenceOf(world, "syracusan-king", government.offices)!;
    expect(competence.acts.tax_rate.grade).toBe("alone");
    expect(competence.acts.coinage.grade).toBe("alone");
    const done = act(world, king, taxSet("syracuse", 1_900));
    expect(done.rejected).toEqual([]);
    expect(rateOf(done.world, "syracuse")).toBe(1_900);
  });
});
