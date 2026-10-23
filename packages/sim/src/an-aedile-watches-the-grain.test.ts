import { describe, expect, it } from "vitest";
import { economyOf, modernWordsIn, type WorldState } from "@chronica/shared";
import { atDay, carryOut, decideTheMonth, famine, firstMonth, opening, withChest, withIncome } from "./government-test-kit";
import { skimTheHand } from "./departments";

/**
 * An aedile watches the grain.
 *
 * Where grain stands at a famine price in a quarter of a power's markets, the man who keeps the grain (an aedile, in Rome) gives bread out of the chest: what he may give
 * alone (a month of what the power takes in), and the rest the Senate's. He is not the player's and not the model's. A greedy hand keeps a share, an audit can find it, and
 * a poor man is late. In the festival month the aediles give the games of the year; the ambitious give their own.
 */

const hungry = (all = false): WorldState => withChest(withIncome(famine(opening(), "rome", 16_000, all ? Number.POSITIVE_INFINITY : 1), "rome", 1), "rome", 4_000_000);
const bread = (day: number, world = hungry()) => decideTheMonth(atDay(world, day), day).filter((decision) => decision.polityId === "rome" && /^(grain|asked the Senate that bread)/.test(decision.why));

describe("an aedile watches the grain", () => {
  it("gives bread in a dear season, and the man is an aedile of Rome", () => {
    const found = firstMonth(hungry(), "rome", /^grain/, 120, 480);
    expect(found, "within a year and a half some month of famine finds the aediles at the bread").toBeDefined();
    const { decision, world } = found!;
    const man = world.material.officeSeats.filter((seat) => /aedile/.test(seat.officeId)).map((seat) => seat.holderCharacterId);
    expect(man).toContain(decision.actorCharacterId);
    expect(decision.act).toBe("magistrate");
    expect(decision.deltas[0]).toMatchObject({ op: "public_benefaction", kind: "dole" });
  });

  it("does what is his alone, and lays the rest before the Senate", () => {
    const found = firstMonth(hungry(), "rome", /^grain/, 120, 480)!;
    const done = carryOut(found.world, found.decision);
    const before = found.world.material.accounts.find((a) => a.owner.id === "rome")!.balance;
    const after = done.world.material.accounts.find((a) => a.owner.id === "rome")!.balance;
    if (found.decision.deltas.some((d) => d.op === "public_benefaction")) {
      expect(done.rejected).toEqual([]);
      expect(after).toBeLessThan(before);
    }
    // A famine that wants more than a month's takings is the Senate's to vote.
    const asked = [120, 150, 180, 210, 240, 270, 300, 330].flatMap((day) => bread(day, hungry(true))).filter((decision) => decision.deltas.some((d) => d.op === "political_procedure_open"));
    expect(asked.length).toBeGreaterThan(0);
    for (const decision of asked) expect(decision.why).toMatch(/^asked the Senate that bread be given to the people of/);
  });

  it("waits out its rest after giving, and gives nothing where bread is cheap", () => {
    const found = firstMonth(hungry(), "rome", /^grain/, 120, 480)!;
    if (found.decision.deltas.some((d) => d.op === "public_benefaction")) {
      const logged = carryOut(found.world, found.decision).world;
      expect(bread(found.day + 30, atDay(logged, found.day + 30))).toEqual([]);
    }
    const plenty = withChest(withIncome(opening(), "rome", 1), "rome", 4_000_000);
    expect(economyOf(plenty).markets.length).toBeGreaterThanOrEqual(0);
    expect([120, 150, 180, 210].flatMap((day) => bread(day, plenty))).toEqual([]);
  });

  it("is not done for a power the player rules, nor by a man the player is", () => {
    const world = hungry();
    const ruled = [120, 150, 180, 240, 300, 360].flatMap((day) => decideTheMonth(atDay(world, day), day, { player: "rome" })).filter((d) => d.polityId === "rome");
    expect(ruled).toEqual([]);
  });

  it("is deterministic", () => {
    const a = [120, 180, 240].map((day) => JSON.stringify(decideTheMonth(atDay(hungry(), day), day)));
    const b = [120, 180, 240].map((day) => JSON.stringify(decideTheMonth(atDay(hungry(), day), day)));
    expect(a).toEqual(b);
  });

  it("a greedy hand keeps a share of what it hands out, and an audit can find it", () => {
    const world = withChest(opening(300), "rome", 1_000_000);
    const man = world.material.officeSeats.find((seat) => /aedile/.test(seat.officeId))!.holderCharacterId!;
    const greedy: WorldState = { ...world, characters: world.characters.map((c) => (c.id === man ? { ...c, mind: { ...c.mind, drives: { ...c.mind.drives, wealth: 100, duty: 0 }, temperament: { ...c.mind.temperament, honesty: 0 } } } : c)) };
    const taken = skimTheHand(greedy, { manId: man, polityId: "rome", handled: 100_000, cause: "the bread of Rome", departmentId: null });
    expect(taken.amount).toBeGreaterThan(0);
    expect(taken.amount).toBeLessThanOrEqual(12_000);
    expect(taken.world.diversions.some((row) => row.byCharacterId === man && row.foundAtStep === null)).toBe(true);
    const honest: WorldState = { ...world, characters: world.characters.map((c) => (c.id === man ? { ...c, mind: { ...c.mind, drives: { ...c.mind.drives, wealth: 0, duty: 100 }, temperament: { ...c.mind.temperament, honesty: 100 } } } : c)) };
    expect(skimTheHand(honest, { manId: man, polityId: "rome", handled: 100_000, cause: "x", departmentId: null }).amount).toBe(0);
  });

  it("speaks in the words of the age", () => {
    const lines = [120, 150, 180, 240, 300, 360, 420].flatMap((day) => decideTheMonth(atDay(hungry(), day), day)).flatMap((d) => [d.why, ...d.facts.map((f) => f.summary)]);
    expect(lines.flatMap((line) => modernWordsIn(line))).toEqual([]);
  });
});
