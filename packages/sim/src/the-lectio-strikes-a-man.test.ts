import { describe, expect, it } from "vitest";
import { GenericEntitySchema, lastCensus, type WorldState } from "@chronica/shared";
import { censorsOf, keepTheRoll, MOST_STRUCK, unworthinessOf } from "./the-lectio";
import { enrolFormerMagistrates } from "./elections";
import { isNoted } from "./nota";
import { atDay, government, holdersOfOffice, opening } from "./government-test-kit";

/**
 * The lectio strikes a man.
 *
 * Once the censors have taken the census they read the roll of the Senate: a man whose hand was found in the chest, who was sent into exile, whose debts are past
 * bearing or whose name is gone is struck off by the censors' mark and not enrolled again with the men who held a magistracy; the next censors read the mark again,
 * five years on, and let back the man who has mended. It is by rule, once for each census, and only where the power has censors.
 */
const census = (world: WorldState, at: number, id = "census-rome-test"): WorldState => ({
  ...world, genericEntities: [...world.genericEntities, GenericEntitySchema.parse({ id, kind: "census", label: "The census of Rome", ownerRef: { kind: "polity", id: "rome" }, attributes: { atStep: at, counted: 1_100_000, by: "manius-curius" }, createdAtStep: at })],
});
const senators = (world: WorldState) => holdersOfOffice(world, "roman-senator");
const robbed = (world: WorldState, id: string, foundAt: number): WorldState => ({
  ...world, diversions: [...world.diversions, { id: `d-${id}`, byCharacterId: id, scope: { kind: "polity", id: "rome" }, departmentId: null, amount: 5_000, toAccountId: world.material.accounts.find((a) => a.owner.id === "rome")!.id, firstAtStep: 20, lastAtStep: 100, foundAtStep: foundAt }],
});
const input = (world: WorldState, day: number) => ({ world: { ...atDay(world, day), society: { ...world.society, lastReviewStep: day - 30 } }, offices: government.offices, toDay: day });
/** The rolls of the opening hold nobody the censors would strike but the man we make one of. */
const clean = (world: WorldState): WorldState => ({ ...world, characters: world.characters.map((c) => (c.polityId === "rome" ? { ...c, prestigeBps: Math.max(c.prestigeBps, 3_000) } : c)) });

describe("the lectio strikes a man", () => {
  const base = clean(atDay(opening(), 200));
  const thief = senators(base).find((id) => !holdersOfOffice(base, "roman-censor").includes(id) && id !== "gaius-genucius")!;
  const world = census(robbed(base, thief, 150), 190);

  it("is the censors' alone: Rome has them, Carthage has none", () => {
    expect(censorsOf(world, "rome")!.length).toBeGreaterThan(0);
    expect(censorsOf(world, "carthage")).toBeNull();
  });

  it("strikes a senator whose hand was found in the chest, and lays the mark on him", () => {
    expect(unworthinessOf(world, world.characters.find((c) => c.id === thief)!, 200)).toMatchObject({ grave: true });
    const done = keepTheRoll(input(world, 200));
    expect(holdersOfOffice(done.world, "roman-senator")).not.toContain(thief);
    expect(isNoted(done.world, thief)).toBe(true);
    expect(done.world.characters.find((c) => c.id === thief)!.prestigeBps).toBeLessThan(world.characters.find((c) => c.id === thief)!.prestigeBps);
    expect(done.facts.map((f) => f.kind)).toEqual(["lectio"]);
    expect(done.facts[0]!.summary).toMatch(/struck from it/);
    expect(done.world.statecraft.log.at(-1)?.why).toMatch(/^lectio: the roll read, 1 struck/);
    // And the honest are left.
    const after = holdersOfOffice(done.world, "roman-senator");
    expect(senators(world).filter((id) => id !== thief).every((id) => after.includes(id))).toBe(true);
    // The men who held a magistracy and were not on the roll are enrolled by the same reading.
    expect(after.length).toBeGreaterThanOrEqual(senators(world).length - 1);
  });

  it("does not enrol him again with the other men who held a magistracy, while the mark stands", () => {
    const done = keepTheRoll(input(world, 200));
    const former = { ...done.world, characters: done.world.characters.map((c) => (c.id === thief ? { ...c, officesHeld: [{ officeId: "roman-quaestor", startedAtStep: 0, endedAtStep: 100 }] } : c)) } as WorldState;
    const again = enrolFormerMagistrates(former, government.offices, 210, [], () => "x");
    expect(holdersOfOffice(again, "roman-senator")).not.toContain(thief);
  });

  it("reads the roll once for each census, and not before one is taken", () => {
    const once = keepTheRoll(input(world, 200));
    expect(keepTheRoll(input(once.world, 230)).facts).toEqual([]);
    expect(keepTheRoll(input(robbed(base, thief, 150), 200)).facts).toEqual([]);
    expect(lastCensus(world, "rome")).toBe(190);
  });

  it("lifts the mark at the next lustrum and lets back a man who has mended", () => {
    const first = keepTheRoll(input(world, 200)).world;
    // Five years on: his theft is long past, his name is whole.
    const later = census(first, 2_100, "census-rome-test-2");
    const second = keepTheRoll(input({ ...later, diversions: [] }, 2_110));
    expect(isNoted(second.world, thief)).toBe(false);
    expect(second.facts[0]!.kind).toBe("lectio");
  });

  it("strikes a dutiful censor's men for debts and a lost name, an easy one's only for theft", () => {
    const poor = (w: WorldState, id: string): WorldState => ({ ...w, material: { ...w.material, accounts: w.material.accounts.map((a) => (a.owner.kind === "character" && a.owner.id === id ? { ...a, balance: -4_000 } : a)) } });
    const man = senators(base).find((id) => id !== thief && !holdersOfOffice(base, "roman-censor").includes(id) && id !== "gaius-genucius")!;
    const censors = censorsOf(world, "rome")!.map((c) => c.id);
    const withDuty = (w: WorldState, duty: number): WorldState => ({ ...w, characters: w.characters.map((c) => (censors.includes(c.id) ? { ...c, mind: { ...c.mind, drives: { ...c.mind.drives, duty } } } : c)) });
    const indebted = census(poor(base, man), 190);
    expect(isNoted(keepTheRoll(input(withDuty(indebted, 90), 200)).world, man)).toBe(true);
    expect(isNoted(keepTheRoll(input(withDuty(indebted, 10), 200)).world, man)).toBe(false);
  });

  it("never strikes the player's man for a low name or an empty purse, only for the graver reasons", () => {
    const man = senators(base).find((id) => id !== thief && !holdersOfOffice(base, "roman-censor").includes(id) && id !== "gaius-genucius")!;
    const lowly = { ...census(base, 190), characters: base.characters.map((c) => (c.id === man ? { ...c, prestigeBps: 100 } : c)) };
    const censors = censorsOf(lowly, "rome")!.map((c) => c.id);
    const strict = { ...lowly, characters: lowly.characters.map((c) => (censors.includes(c.id) ? { ...c, mind: { ...c.mind, drives: { ...c.mind.drives, duty: 95 } } } : c)) };
    const poor = { ...strict, material: { ...strict.material, accounts: strict.material.accounts.map((a) => (a.owner.kind === "character" && a.owner.id === man ? { ...a, balance: -9_000 } : a)) } };
    expect(isNoted(keepTheRoll(input(poor, 200)).world, man)).toBe(true);
    expect(isNoted(keepTheRoll({ ...input(poor, 200), playerCharacterId: man }).world, man)).toBe(false);
    expect(isNoted(keepTheRoll({ ...input(robbed(poor, man, 150), 200), playerCharacterId: man }).world, man)).toBe(true);
  });

  it("strikes no more than the most, and is the same on every run", () => {
    expect(MOST_STRUCK).toBeLessThanOrEqual(10);
    const a = keepTheRoll(input(world, 200));
    const b = keepTheRoll(input(structuredClone(world), 200));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
