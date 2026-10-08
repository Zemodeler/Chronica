import { describe, expect, it } from "vitest";
import { DepartmentSchema, economyOf, taxBurdens, type Character, type WorldState } from "@chronica/shared";
import {
  applyDecision,
  atDay,
  input,
  logged,
  opening,
  rateOf,
  withChest,
  withIncome,
  withWar,
} from "./fiscal-test-kit";
import { EXTREMIS_TAX_CEILING_BPS, PROJECTED_BURDEN_CEILING, TAX_COOLDOWN_DAYS, TAX_FLOOR_BPS, WAR_TAX_CEILING_BPS, decideFiscal, fiscalSliceLine } from "./fiscal-officers";
import { keepDepartments } from "./departments";

/**
 * "The soldiers' pay is three months behind and the chest is bare. Raise the levy, but not past what the
 * provinces can bear; when the war is won and the chest is full, take it down again."
 *
 * A power nobody plays had no one to keep its books: its rate of tax stood where the scenario left it
 * for a hundred years, a war could empty its chest without anybody borrowing, and a tariff was never
 * touched. Each such power now has a man at the books -- the head of the department that holds the tax roll,
 * else its ruler -- who reads them once a month and does the few things such a man did. Here are the
 * things the tests hold him to: that he raises a poor power's tax in war, within the bounds, and lets a
 * rich one off; that he is slower and coarser the less skilled he is; that what passes through a greedy
 * man's hands is skimmed and an audit finds it; and that nobody the player or the model plays is touched.
 */

const decisionFor = (world: WorldState, polityId: string, playerPolity = "rome") => decideFiscal(input(world, playerPolity)).find((decision) => decision.polityId === polityId && decision.act === "fiscal");
const taxDelta = (deltas: readonly { op: string }[]) => deltas.find((delta) => delta.op === "tax_policy_set" && (delta as { scope?: string }).scope === "polity") as { rateBps: number; regime: string } | undefined;

describe("a quaestor keeps the books", () => {
  it("raises a poor power's tax in a war, within what its provinces can bear and the ceiling of a war", () => {
    // Carthage at war with Rome, its pay behind and its chest empty, taking in nothing.
    const poor = withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 2_000, 90_000), "carthage", 0.1);
    // Find a month in which the man is not late (a good officer acts most months).
    const acted = [120, 150, 180, 210, 240, 270].map((day) => decisionFor(atDay(poor, day), "carthage")).find((decision) => decision !== undefined && taxDelta(decision.deltas) !== undefined)!;
    expect(acted, "the officer of the Accounts does something about an empty chest within half a year").toBeDefined();
    const raised = taxDelta(acted.deltas)!;
    const before = rateOf(poor, "carthage") ?? 1_000;
    expect(raised.rateBps).toBeGreaterThan(before);
    expect(raised.rateBps).toBeLessThanOrEqual(WAR_TAX_CEILING_BPS);
    // Never past what the land can bear: the share of its capacity the new rate asks stays under the ceiling.
    const burden = taxBurdens(poor).get("carthage")!;
    expect((burden.asked / burden.bearable) * (raised.rateBps / before)).toBeLessThanOrEqual(PROJECTED_BURDEN_CEILING);
    // And it is the officer who does it, named in the news.
    expect(acted.facts[0]!.summary).toContain("who keeps the books of Carthage");
    expect(acted.facts[0]!.summary).toMatch(/raised the rate of tax/);
    // The act is applied as any other: nothing refused, the rate in the economy's memory.
    const done = applyDecision(poor, acted);
    expect(done.rejected).toEqual([]);
    expect(rateOf(done.world, "carthage")).toBe(raised.rateBps);
  });

  it("does not raise it again until the cooldown is out, and then again by a step", () => {
    const poor = withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 2_000, 90_000), "carthage", 0.1);
    let world = poor;
    let first: ReturnType<typeof decisionFor>;
    let day = 120;
    for (; day < 400 && first === undefined; day += 30) {
      world = atDay(world, day);
      first = decisionFor(world, "carthage");
      if (first !== undefined && taxDelta(first.deltas) === undefined) first = undefined;
    }
    expect(first).toBeDefined();
    world = logged(applyDecision(world, first!).world, first!);
    // The very next month, and the one after: the same distress, and no further change of rate.
    for (const wait of [30, 60]) {
      const again = decisionFor(atDay(world, day - 30 + wait), "carthage");
      expect(again === undefined || taxDelta(again.deltas) === undefined).toBe(true);
    }
    // Past the cooldown, in some month in the next half-year, he moves again: a step more where it is within custom (his own), and where it is past it
    // (12 in a hundred) he lays it before the Council of Elders, which holds the taxes, and does not raise it himself (H1: through competence).
    const moved = (decision: ReturnType<typeof decisionFor>) => decision !== undefined && (taxDelta(decision.deltas) !== undefined || decision.deltas.some((delta) => delta.op === "political_procedure_open"));
    const later = [0, 30, 60, 90, 120, 150].map((extra) => decisionFor(atDay(world, day - 30 + TAX_COOLDOWN_DAYS + extra), "carthage")).find(moved);
    expect(later).toBeDefined();
    const rate = taxDelta(later!.deltas);
    if (rate !== undefined) {
      expect(rate.rateBps).toBeGreaterThan(rateOf(world, "carthage")!);
      expect(rate.rateBps).toBeLessThanOrEqual(1_200);
    } else {
      const motion = later!.deltas.find((delta) => delta.op === "political_procedure_open") as { label: string; institutionRef: string } | undefined;
      expect(motion!.institutionRef).toBe("carthaginian-council");
      expect(motion!.label).toMatch(/^Motion of .*: that the tribute of Carthage be laid at [0-9]+([.][0-9])? in a hundred$/);
      expect(Number(/at ([0-9.]+) in a hundred/.exec(motion!.label)![1]) * 100).toBeLessThanOrEqual(EXTREMIS_TAX_CEILING_BPS);
    }
  });

  it("eases a rich power's tax at peace back to the ordinary rate and no lower, and leaves a middling one alone", () => {
    // Syracuse took a war's rate and has been at peace with a full chest since.
    const taxed = (rateBps: number): WorldState => {
      const world = opening();
      return { ...world, economy: { ...economyOf(world), taxPolicies: [...economyOf(world).taxPolicies.filter((policy) => policy.polityId !== "syracuse"), { polityId: "syracuse", regime: "land_levy", rateBps }] } };
    };
    const rich = taxed(1_400);
    const day = [120, 150, 180, 210, 240, 270].find((at) => decisionFor(atDay(rich, at), "syracuse") !== undefined)!;
    const eased = decisionFor(atDay(rich, day), "syracuse")!;
    expect(eased).toBeDefined();
    const lowered = taxDelta(eased.deltas)!;
    expect(lowered.rateBps).toBeLessThan(1_400);
    expect(lowered.rateBps).toBeGreaterThanOrEqual(1_000);
    // At the ordinary rate already, a rich power leaves it be: it does not undo what the scenario wrote.
    expect([120, 150, 180, 210, 240, 270].every((at) => { const found = decisionFor(atDay(taxed(1_000), at), "syracuse"); return found === undefined || taxDelta(found.deltas) === undefined; })).toBe(true);
    expect(eased.facts[0]!.summary).toMatch(/eased the rate of tax/);
    // Not at war: a rich power that is at war keeps its rate.
    const warring = withWar(rich, "syracuse", "carthage");
    expect([120, 150, 180, 210].every((at) => { const found = decisionFor(atDay(warring, at), "syracuse"); return found === undefined || taxDelta(found.deltas) === undefined; })).toBe(true);
    // A chest holding five months of its pay, neither poor nor rich, is left alone: the gap between the two is the hysteresis.
    const owed = 43_500;
    const middling = withChest(opening(), "syracuse", Math.round(owed * 5));
    const quiet = decisionFor(withIncome(middling, "syracuse", 0.2), "syracuse");
    expect(quiet === undefined || taxDelta(quiet.deltas) === undefined).toBe(true);
  });

  it("is slower and coarser the less skilled the man, and quicker and cleaner the better", () => {
    // Syracuse has no department: the king keeps his own books. Make him skilled in one world, unskilled in the other.
    const base = withIncome(withChest(withWar(opening(), "syracuse", "carthage"), "syracuse", 1_000, 60_000), "syracuse", 0.1);
    const as = (taxation: number, discipline: number): WorldState => ({
      ...base,
      characters: base.characters.map((character): Character => (character.id === "hieron-ii"
        ? { ...character, skills: { ...character.skills, stewardship: taxation, subSkills: { ...character.skills.subSkills, taxation, logistics: taxation } }, mind: { ...character.mind, temperament: { ...character.mind.temperament, discipline } } }
        : character)),
    });
    const skilled = as(95, 90);
    const dull = as(10, 10);
    const days = Array.from({ length: 24 }, (_, index) => 120 + index * 30);
    const acts = (world: WorldState) => days.map((day) => decisionFor(atDay(world, day), "syracuse")).filter((decision) => decision !== undefined && taxDelta(decision.deltas) !== undefined);
    const good = acts(skilled);
    const poor = acts(dull);
    // He acts in most of the months a good man does (every cooldown is the same, so it is lateness alone that differs).
    expect(good.length).toBeGreaterThan(poor.length);
    expect(good.length).toBeGreaterThanOrEqual(20);
    // The skilled man's steps are the clean step; the unskilled man's are coarse, and wander off the mark.
    const steps = (list: typeof good) => new Set(list.map((decision) => taxDelta(decision!.deltas)!.rateBps - (rateOf(base, "syracuse") ?? 1_000)));
    expect([...steps(good)]).toEqual([200]);
    expect([...steps(poor)].some((step) => step !== 200)).toBe(true);
  });

  it("names a greedy man, whose hands skim what passes through them, and an audit that looks finds it", () => {
    // Syracuse's tax roll is held by a treasurer with no scruples and a short purse; the king has none.
    const opened = withIncome(withChest(withWar(opening(), "syracuse", "carthage"), "syracuse", 1_000, 60_000), "syracuse", 0.1);
    const hieron = opened.characters.find((character) => character.id === "hieron-ii")!;
    const dion: Character = {
      ...hieron, id: "dion-treasurer", name: "Dion", officeId: null, personalAccountId: "dion-purse", relations: [], traits: [],
      skills: { ...hieron.skills, subSkills: { ...hieron.skills.subSkills, taxation: 90 } },
      mind: { ...hieron.mind, temperament: { ...hieron.mind.temperament, honesty: 10 }, drives: { ...hieron.mind.drives, wealth: 95, duty: 10 } },
    };
    const treasury = opened.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "syracuse")!;
    const world: WorldState = {
      ...opened,
      characters: [...opened.characters, dion],
      departments: [DepartmentSchema.parse({ id: "syr-treasury", scope: { kind: "polity", id: "syracuse" }, name: "The Royal Treasury", levers: ["tax_roll"], officeIds: ["syr-treasurer"], foundedAtStep: 0, formsAtStep: 0, origin: "order", countedAtStep: 0 })],
      material: {
        ...opened.material,
        accounts: [...opened.material.accounts, { ...treasury, id: "dion-purse", owner: { kind: "character" as const, id: "dion-treasurer" }, balance: 0 }],
        officeSeats: [...opened.material.officeSeats, { ...opened.material.officeSeats[0]!, id: "syr-treasurer-seat", officeId: "syr-treasurer", holderCharacterId: "dion-treasurer", status: "held" as const }],
      },
    };
    const decision = [120, 150, 180, 210, 240, 270, 300].map((day) => decisionFor(atDay(world, day), "syracuse")).find((found) => found !== undefined && taxDelta(found.deltas) !== undefined)!;
    expect(decision, "the greedy treasurer, not the king, keeps the books").toBeDefined();
    expect(decision.actorCharacterId).toBe("dion-treasurer");
    expect(decision.facts[0]!.summary).toContain("Dion, who keeps the books of");
    expect(decision.facts[0]!.summary).toContain("Men do not trust his hands");
    // The tax the higher rate raises passes through his hands, and he keeps a share (`departments.ts`).
    const taxed: WorldState = {
      ...world,
      material: { ...world.material, transactions: [...world.material.transactions, { id: "tax-1", atStep: 150, kind: "tax" as const, amount: 30_000, destinationAccountId: treasury.id, cause: { kind: "scheduled_income" as const, id: "syracuse-tax", explanation: "Tax" }, visibility: "polity" as const }] },
    };
    const skimmed = keepDepartments(taxed, 150, world);
    expect(skimmed.world.material.accounts.find((account) => account.id === "dion-purse")!.balance).toBeGreaterThan(0);
    expect(skimmed.world.diversions).toMatchObject([{ byCharacterId: "dion-treasurer", foundAtStep: null }]);
  });

  it("leaves alone a power the player rules, and a rate the model has just set itself", () => {
    const poor = withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 2_000, 90_000), "carthage", 0.1);
    for (const day of [120, 150, 180, 210]) {
      const world = atDay(poor, day);
      // The player is Carthage: the rules keep no books for it.
      expect(decideFiscal({ ...input(world, "carthage") }).some((decision) => decision.polityId === "carthage")).toBe(false);
      // The model is playing the officer of the Accounts: the rules go on keeping his books (`a-played-ruler-keeps-his-books.test.ts`) unless he has himself set the rate lately.
      const officer = decideFiscal(input(world)).find((decision) => decision.polityId === "carthage")?.actorCharacterId;
      if (officer !== undefined) {
        const set = { ...world, actMarks: [...world.actMarks, { polityId: "carthage", act: "tax_rate" as const, officeId: null, byCharacterId: officer, byOfficeId: null, atStep: day - 10, sinceStep: day - 10, total: 0 }] };
        expect(decideFiscal({ ...input(set), playedByModel: new Set([officer]) }).some((decision) => decision.polityId === "carthage")).toBe(false);
      }
    }
    // And before the opening weeks are over nobody acts at all.
    expect(decideFiscal(input(atDay(poor, 20)))).toEqual([]);
  });

  it("does the same thing on every replay of the same month", () => {
    const poor = withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 2_000, 90_000), "carthage", 0.1);
    const month = (world: WorldState) => JSON.stringify(decideFiscal(input(atDay(world, 180))));
    expect(month(poor)).toBe(month(structuredClone(poor)));
    expect(month(poor)).not.toBe("[]");
  });

  it("reads as one line in the slice for a month after, and not after a season", () => {
    const poor = withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 2_000, 90_000), "carthage", 0.1);
    const day = [120, 150, 180, 210, 240, 270].find((at) => { const found = decisionFor(atDay(poor, at), "carthage"); return found !== undefined && taxDelta(found.deltas) !== undefined; })!;
    const decision = decisionFor(atDay(poor, day), "carthage")!;
    const world = logged(atDay(poor, day), decision);
    const line = fiscalSliceLine(world, "carthage");
    expect(line).toMatch(/^Its accounts: raised the rate/);
    expect(line!.length).toBeLessThan(260);
    expect(fiscalSliceLine(atDay(world, day + 100), "carthage")).toBeNull();
    expect(fiscalSliceLine(world, "syracuse")).toBeNull();
    expect(economyOf(world).taxPolicies).toBeDefined();
  });
});
