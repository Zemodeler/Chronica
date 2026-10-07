import { describe, expect, it } from "vitest";
import { economyOf, mayAct, modernWordsIn, type WorldState } from "@chronica/shared";
import { applyDecision, atDay, government, input, logged, opening, rateOf, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { decideFiscal, MOTION_REST_DAYS } from "./fiscal-officers";

/**
 * "The quaestor asks the Senate."
 *
 * The man at a power's books used to do what he saw fit, whatever his office was: raise the tribute past what a magistrate may, borrow, strike the coin lighter. Now
 * he acts through his competence (docs/plans/government.md, "H1 as built"): the rate within custom is his, with his colleagues; past custom, a new tax, a loan and the
 * coin are the chamber's, and he lays them before it, a consul puts the motion (the quaestor does not convene the Senate), and he carries out what carries, as far as it
 * goes. A king's officer, in a realm no chamber holds the purse of, does as he always did. The same pass is the player's rule: what the player's own quaestor may not do alone, the AI's
 * may not either.
 */

const decisionsFor = (world: WorldState, polityId: string, player = "carthage") => decideFiscal(input(world, player)).filter((decision) => decision.polityId === polityId && decision.act === "fiscal");

/** Rome at war with Carthage, its pay behind and its chest bare, its tribute already at the customary rate. */
function romeInNeed(): WorldState {
  const world = withIncome(withChest(withWar(opening(), "rome", "carthage"), "rome", 2_000, 90_000), "rome", 0.1);
  return { ...world, economy: { ...economyOf(world), taxPolicies: economyOf(world).taxPolicies.map((policy) => (policy.polityId === "rome" ? { ...policy, rateBps: 1_200 } : policy)) } };
}

/** The first month, from day 120, in which the man at the books of the power does something that the test asks of him. */
function firstMonth(world: WorldState, polityId: string, wanted: (deltas: readonly { op: string }[]) => boolean) {
  for (let day = 120; day <= 480; day += 30) {
    const there = atDay(world, day);
    const found = decisionsFor(there, polityId).find((decision) => wanted(decision.deltas));
    if (found !== undefined) return { world: there, decision: found, day };
  }
  return undefined;
}

const motionOf = (deltas: readonly { op: string }[]) => deltas.find((delta) => delta.op === "political_procedure_open") as { institutionRef: string; sponsorCharacterRef: string; label: string; concerns: string[] } | undefined;
const tributeMotion = (deltas: readonly { op: string }[]): boolean => /tribute/.test(motionOf(deltas)?.label ?? "");
const rateDelta = (deltas: readonly { op: string }[]) => deltas.find((delta) => delta.op === "tax_policy_set" && (delta as { scope?: string }).scope === "polity") as { rateBps: number } | undefined;

describe("the quaestor asks the Senate", () => {
  it("lays a rate past custom before the Senate, and does not raise it himself; a consul puts the motion", () => {
    const found = firstMonth(romeInNeed(), "rome", tributeMotion);
    expect(found, "the man at the books of Rome does something about an empty chest within a year and a half").toBeDefined();
    const { decision } = found!;
    expect(rateDelta(decision.deltas)).toBeUndefined();
    const motion = motionOf(decision.deltas)!;
    expect(motion.institutionRef).toBe("roman-senate");
    expect(motion.concerns).toContain("taxes");
    expect(motion.label).toMatch(/^Motion of .*: that the tribute of Roman Republic be laid at (1[3-9]|2[0-2])(\.5)? in a hundred$/);
    // The quaestor does not convene the Senate: one of the magistrates who may does, and the account says so.
    const quaestors = found!.world.material.officeSeats.filter((seat) => seat.officeId === "roman-quaestor").map((seat) => seat.holderCharacterId);
    const conveners = found!.world.material.officeSeats.filter((seat) => ["roman-consul", "roman-praetor", "roman-dictator", "roman-tribune"].includes(seat.officeId)).map((seat) => seat.holderCharacterId);
    expect(quaestors).toContain(decision.actorCharacterId);
    expect(conveners).toContain(motion.sponsorCharacterRef);
    expect(decision.why).toMatch(/^asked the Senate that the tribute of Roman Republic be laid at/);
    // Applied as the burst applies it, it opens a question before the Senate and nothing of the tribute moves.
    const done = applyDecision(found!.world, decision);
    expect(done.rejected).toEqual([]);
    expect(rateOf(done.world, "rome")).toBe(1_200);
    expect(done.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "roman-senate", type: "council_deliberation", outcome: null });
  });

  it("does not ask again while the question waits on the vote, nor for a season after it failed", () => {
    const found = firstMonth(romeInNeed(), "rome", tributeMotion)!;
    const asked = logged(applyDecision(found.world, found.decision).world, found.decision);
    const procedure = asked.material.politicalProcedures.filter((entry) => /tribute/.test(entry.label)).at(-1)!;
    const later = (world: WorldState, extra: number) => [0, 30, 60, 90].map((step) => atDay(world, found.day + extra + step)).flatMap((there) => decisionsFor(there, "rome"));
    // Waiting on the vote: no second motion about the tribute.
    expect(later(asked, 30).filter((decision) => motionOf(decision.deltas) !== undefined && /tribute/.test(motionOf(decision.deltas)!.label))).toEqual([]);
    // Failed: not put again within the season.
    const failed: WorldState = { ...asked, material: { ...asked.material, politicalProcedures: asked.material.politicalProcedures.map((entry) => (entry.id === procedure.id
      ? { ...entry, stage: "resolved" as const, outcome: "failed" as const, resolvedAtStep: found.day + 10, outcomeReason: "The Senate rejected it." }
      : entry)) } };
    const within = [30, 60, 90].map((extra) => atDay(failed, found.day + 10 + Math.min(extra, MOTION_REST_DAYS - 10))).flatMap((there) => decisionsFor(there, "rome"));
    expect(within.filter((decision) => motionOf(decision.deltas) !== undefined && /tribute/.test(motionOf(decision.deltas)!.label))).toEqual([]);
  });

  it("carries out what the Senate decreed, as far as it goes and no further", () => {
    const found = firstMonth(romeInNeed(), "rome", tributeMotion)!;
    const asked = logged(applyDecision(found.world, found.decision).world, found.decision);
    const procedure = asked.material.politicalProcedures.filter((entry) => /tribute/.test(entry.label)).at(-1)!;
    const decreedRate = Math.round(Number(/at ([0-9.]+) in a hundred$/.exec(procedure.label)![1]) * 100);
    const carried: WorldState = { ...asked, material: { ...asked.material, politicalProcedures: asked.material.politicalProcedures.map((entry) => (entry.id === procedure.id
      ? { ...entry, stage: "resolved" as const, outcome: "passed" as const, resolvedAtStep: found.day + 10, outcomeReason: "The Senate carried it." }
      : entry)) } };
    let acted: ReturnType<typeof firstMonth>;
    for (let extra = 30; extra <= 150 && acted === undefined; extra += 30) {
      acted = firstMonth(atDay(carried, found.day + extra), "rome", (deltas) => rateDelta(deltas) !== undefined);
    }
    expect(acted, "the quaestor carries out the Senate's decree within a few months").toBeDefined();
    const delta = rateDelta(acted!.decision.deltas)!;
    expect(delta.rateBps).toBeGreaterThan(1_200);
    expect(delta.rateBps).toBeLessThanOrEqual(decreedRate + 10);
    const done = applyDecision(acted!.world, acted!.decision);
    expect(done.rejected).toEqual([]);
    expect(rateOf(done.world, "rome")).toBe(delta.rateBps);
  });

  it("leaves a king's officers as they were: in a realm no chamber holds the purse of, the man at the books raises the rate himself", () => {
    const poor = withIncome(withChest(withWar(opening(), "syracuse", "carthage"), "syracuse", 2_000, 90_000), "syracuse", 0.1);
    const found = firstMonth(poor, "syracuse", (deltas) => rateDelta(deltas) !== undefined);
    expect(found).toBeDefined();
    expect(motionOf(found!.decision.deltas)).toBeUndefined();
    expect(decisionsFor(found!.world, "syracuse").every((decision) => decision.deltas.every((delta) => delta.op !== "political_procedure_open"))).toBe(true);
  });

  it("never strikes the coin lighter for Rome: no quaestor holds the mint, and the Senate's motion is a consul's to put", () => {
    expect(mayAct(opening(), opening().material.officeSeats.find((seat) => seat.officeId === "roman-quaestor")!.holderCharacterId!, "coinage", { offices: government.offices })?.grade).toBe("forbidden");
    // In a war that has emptied the chest and with the tribute at its ceiling, over two years of months.
    let world = withIncome(withChest(withWar(opening(), "rome", "carthage"), "rome", 0, 400_000), "rome", 0.02);
    world = { ...world, economy: { ...economyOf(world), taxPolicies: economyOf(world).taxPolicies.map((policy) => (policy.polityId === "rome" ? { ...policy, rateBps: 2_200 } : policy)) } };
    for (let day = 120; day <= 840; day += 30) {
      for (const decision of decisionsFor(atDay(world, day), "rome")) expect(decision.deltas.some((delta) => delta.op === "coinage_debase")).toBe(false);
    }
  });

  it("is told in the words of the age", () => {
    const found = firstMonth(romeInNeed(), "rome", tributeMotion)!;
    const lines = [found.decision.why, ...found.decision.facts.map((fact) => fact.summary), motionOf(found.decision.deltas)!.label];
    expect(lines.flatMap((line) => modernWordsIn(line))).toEqual([]);
  });
});
