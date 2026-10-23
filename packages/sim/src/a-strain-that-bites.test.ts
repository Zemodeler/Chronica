import { describe, expect, it } from "vitest";
import { coinageOfPolity, modernWordsIn, standardOf, type WorldState } from "@chronica/shared";
import { atDay, applyDecision, input, logged, opening, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { decideFiscal } from "./fiscal-officers";
import { decideMagistrates } from "./magistrates";
import { readTheBooks } from "./fiscal-officers";
import { DEBASE_STRAIN, strainOf } from "./fiscal-strain";

/**
 * "The strain that bites."
 *
 * A coin was struck lighter when the chest was empty and the pay behind, in a war that had gone on long enough to empty it; not in peace, and not in
 * solvent times. Rome reduced the as in 217 under the Hannibalic war; Carthage struck billon by the end of the Mercenary War. Here a reading of the strain
 * on a power (`fiscal-strain.ts`: cover, arrears, the war's length, debt) decides it, a power's own competence says who may: the Senate moves the
 * lighter coin in extremis through the man at the mint (`magistrates.ts`), the elders and suffetes of Carthage and the kings' officers through the fiscal
 * pass. A year between one striking and the next, and a better coin when the war is over and the chest full.
 */

const decisionsFor = (world: WorldState, polityId: string, player = "ptolemaic-egypt") => decideFiscal(input(world, player)).filter((decision) => decision.polityId === polityId);
const debasing = (decision: { deltas: readonly { op: string }[] }): boolean => decision.deltas.some((delta) => delta.op === "coinage_debase");
/** The coin moved: struck by the man's own hand, or laid before the chamber that holds the mint. */
const movesTheCoin = (decision: { deltas: readonly { op: string }[] }): boolean => debasing(decision) || decision.deltas.some((delta) => delta.op === "political_procedure_open" && /struck with less silver/.test((delta as unknown as { label: string }).label));
const stepOf = (decision: { deltas: readonly { op: string }[] }): number => (decision.deltas.find((delta) => delta.op === "coinage_debase") as unknown as { stepBps: number }).stepBps;

/** Carthage at war with Rome, its chest bare, its pay behind and no income: the strain of a lost war. */
function carthageInNeed(): WorldState {
  return withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 1_000, 300_000), "carthage", 0.02);
}

/** The month, from day 120, in which the officers of the power move the coin; each month's other doings (the tax, the loan) are applied and logged before it. */
function whenLighter(world: WorldState, polityId: string, player = "ptolemaic-egypt"): { world: WorldState; day: number; decision: ReturnType<typeof decisionsFor>[number] } | undefined {
  let there = world;
  for (let day = 120; day <= 840; day += 30) {
    there = atDay(there, day);
    const made = decisionsFor(there, polityId, player);
    const found = made.find(movesTheCoin);
    if (found !== undefined) return { world: there, day, decision: found };
    for (const decision of made) there = logged(applyDecision(there, decision).world, decision);
  }
  return undefined;
}

/** Syracuse at war with Carthage, its chest bare and its pay behind: a king's realm, where the man at the books has the mint. */
function syracuseInNeed(): WorldState {
  return withIncome(withChest(withWar(opening(), "syracuse", "carthage"), "syracuse", 1_000, 100_000), "syracuse", 0.02);
}

describe("the strain that bites", () => {
  it("reads strain from the chest, the pay behind, the war's length and the debt", () => {
    const quiet = opening();
    const books = readTheBooks(quiet).get("carthage")!;
    expect(strainOf(quiet, books, "carthage").score).toBeLessThan(10);
    const need = carthageInNeed();
    const strain = strainOf(atDay(need, 400), readTheBooks(need).get("carthage")!, "carthage");
    expect(strain.atWar).toBe(true);
    expect(strain.score).toBeGreaterThanOrEqual(DEBASE_STRAIN);
  });

  it("strikes no coin lighter in peace, however empty the chest, nor in a war the chest can carry", () => {
    const peaceBare = withIncome(withChest(opening(), "carthage", 0, 300_000), "carthage", 0);
    const warSolvent = withWar(opening(), "carthage", "rome");
    for (let day = 120; day <= 600; day += 30) {
      for (const world of [peaceBare, warSolvent]) {
        for (const polityId of ["carthage", "rome", "syracuse"]) expect(decisionsFor(atDay(world, day), polityId).some(debasing)).toBe(false);
        expect(decideMagistrates(input(atDay(world, day), "ptolemaic-egypt")).some(debasing)).toBe(false);
      }
    }
  });

  it("lays the lighter shekel before the elders of Carthage, who hold the mint, once the tribute has been tried", () => {
    const found = whenLighter(carthageInNeed(), "carthage");
    expect(found).toBeDefined();
    expect(debasing(found!.decision)).toBe(false);
    expect(found!.decision.why).toMatch(/Council of Elders/);
    expect(found!.day).toBeGreaterThan(120);
  });

  it("carries out what the elders decreed: once the motion passes, the next month the shekel is struck lighter", () => {
    const found = whenLighter(carthageInNeed(), "carthage")!;
    const asked = logged(applyDecision(found.world, found.decision).world, found.decision);
    const procedure = asked.material.politicalProcedures.filter((entry) => /less silver/.test(entry.label)).at(-1)!;
    const carried: WorldState = { ...asked, material: { ...asked.material, politicalProcedures: asked.material.politicalProcedures.map((entry) => (entry.id === procedure.id ? { ...entry, stage: "resolved" as const, outcome: "passed" as const, resolvedAtStep: found.day + 10, outcomeReason: "The elders carried it." } : entry)) } };
    let acted: ReturnType<typeof decisionsFor>[number] | undefined;
    let there = carried;
    for (let extra = 30; extra <= 150 && acted === undefined; extra += 30) {
      there = atDay(carried, found.day + extra);
      acted = decisionsFor(there, "carthage").find(debasing);
    }
    expect(acted, "the officer carries out the decree within a few months").toBeDefined();
    const done = applyDecision(there, acted!);
    expect(done.rejected).toEqual([]);
    expect(coinageOfPolity(done.world, "carthage").silverBps).toBeLessThan(coinageOfPolity(there, "carthage").silverBps);
  });

  it("strikes a king's coin lighter by his own hand, by a tenth to a sixth, and not again for a year", () => {
    const found = whenLighter(syracuseInNeed(), "syracuse");
    expect(found).toBeDefined();
    expect(debasing(found!.decision)).toBe(true);
    expect(stepOf(found!.decision)).toBeLessThanOrEqual(-1_000);
    expect(stepOf(found!.decision)).toBeGreaterThanOrEqual(-1_700);
    const struck = applyDecision(found!.world, found!.decision);
    expect(struck.rejected).toEqual([]);
    const coin = coinageOfPolity(struck.world, "syracuse");
    expect(coin.silverBps).toBeLessThan(standardOf(coin));
    expect(coin.silverBps).toBeGreaterThan(standardOf(coin) * 0.8);
    // He logs it; for the year after he strikes no lighter coin.
    let after = logged(struck.world, found!.decision);
    for (let day = found!.day + 30; day < found!.day + 360; day += 30) {
      after = atDay(after, day);
      expect(decisionsFor(after, "syracuse").some(debasing)).toBe(false);
    }
  });

  it("has the Senate's man at the mint move Rome's coin in extremis, and in no other case", () => {
    const poor = withIncome(withChest(withWar(opening(), "rome", "carthage"), "rome", 1_000, 400_000), "rome", 0.02);
    // The tribute is already at its ceiling: the Senate has been asked for the rate, and the coin is what is left.
    const need: WorldState = { ...poor, economy: { ...poor.economy!, taxPolicies: poor.economy!.taxPolicies.map((policy) => (policy.polityId === "rome" ? { ...policy, rateBps: 2_200 } : policy)) } };
    const rich = withWar(opening(), "rome", "carthage");
    let moved = false;
    for (let day = 120; day <= 900; day += 30) {
      const mint = decideMagistrates(input(atDay(need, day), "ptolemaic-egypt")).filter((decision) => decision.polityId === "rome");
      if (mint.some(movesTheCoin)) moved = true;
      expect(decideMagistrates(input(atDay(rich, day), "ptolemaic-egypt")).some(debasing)).toBe(false);
    }
    expect(moved).toBe(true);
  });

  it("re-strikes the coin better when the war is over and the chest is full", () => {
    const base = opening();
    const eco = base.economy!;
    const worn: WorldState = { ...base, economy: { ...eco, coinages: eco.coinages.map((coin) => (coin.issuerPolityId === "syracuse" ? { ...coin, standardBps: 9_500, silverBps: 7_600, debasedSinceStep: 0, history: [{ atStep: 0, fromSilverBps: 9_500, toSilverBps: 7_600 }] } : coin)) } };
    const rich = withChest(worn, "syracuse", 90_000_000);
    const found = [480, 510, 540, 570, 600, 900].map((day) => decisionsFor(atDay(rich, day), "syracuse").find((decision) => decision.deltas.some((delta) => delta.op === "coinage_debase" && (delta as unknown as { stepBps: number }).stepBps > 0))).find((decision) => decision !== undefined);
    expect(found).toBeDefined();
  });

  it("speaks in the words of the age", () => {
    const found = whenLighter(syracuseInNeed(), "syracuse")!;
    const decision = found.decision;
    const lines = [decision.why, ...decision.facts.map((fact) => fact.summary)];
    expect(lines.flatMap((line) => modernWordsIn(line))).toEqual([]);
  });
});
