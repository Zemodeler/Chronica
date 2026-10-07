import { describe, expect, it } from "vitest";
import { actMarkOf } from "@chronica/shared";
import { act, atDay, holdersOf, opening, rateOf, taxSet, thinksIll } from "./competence-test-kit";

/**
 * Two consuls of equal power, and one tribute.
 *
 * Either consul may lay the rate of the tribute within custom, and the other may stop him (*par potestas*); but the state may
 * not have two rates in a week. When one has settled it, the other may not settle it again until the season is out, unless
 * his office is higher; and a colleague who thinks ill of him stops it before it is done.
 */

const [FIRST, SECOND] = holdersOf(opening(), "roman-consul") as [string, string];

describe("two consuls do not both tax", () => {
  it("lets the first lay the rate, and writes down who decided it", () => {
    const world = opening();
    const done = act(world, FIRST, taxSet("rome", 1_100));
    expect(done.rejected).toEqual([]);
    expect(rateOf(done.world, "rome")).toBe(1_100);
    const mark = actMarkOf(done.world.actMarks, "rome", "tax_rate")!;
    expect(mark.byCharacterId).toBe(FIRST);
    expect(mark.byOfficeId).toBe("roman-consul");
  });

  it("will not let the second settle it again in the same season, and says who has", () => {
    const first = act(opening(), FIRST, taxSet("rome", 1_100)).world;
    const later = atDay(first, 230);
    const second = act(later, SECOND, taxSet("rome", 1_150));
    expect(second.applied).toHaveLength(0);
    expect(second.rejected[0]!.reason).toMatch(/settled this 30 days ago, and it is not decided twice in a season/);
    expect(rateOf(second.world, "rome")).toBe(1_100);
    // The man who decided it may go on deciding it: it is his own act.
    expect(rateOf(act(later, FIRST, taxSet("rome", 1_150)).world, "rome")).toBe(1_150);
  });

  it("lets him once the season is out", () => {
    const first = act(opening(), FIRST, taxSet("rome", 1_100)).world;
    const after = act(atDay(first, 200 + 91), SECOND, taxSet("rome", 1_150));
    expect(after.rejected).toEqual([]);
    expect(rateOf(after.world, "rome")).toBe(1_150);
  });

  it("lets the higher office alter what the lower settled, and not the other way", () => {
    const quaestor = holdersOf(opening(), "roman-quaestor")[0]!;
    const low = act(opening(), quaestor, taxSet("rome", 1_000)).world;
    // A consul outranks the quaestor: he may lay it again at once.
    const high = act(atDay(low, 210), FIRST, taxSet("rome", 1_100));
    expect(high.rejected).toEqual([]);
    expect(rateOf(high.world, "rome")).toBe(1_100);
    // And a quaestor may not undo the consul's within the season.
    const undone = act(atDay(high.world, 220), quaestor, taxSet("rome", 900));
    expect(undone.applied).toHaveLength(0);
    expect(undone.rejected[0]!.reason).toMatch(/not decided twice in a season/);
  });

  it("is stopped by a colleague who thinks ill of him: either may act, and the other may stop it", () => {
    const quarrel = thinksIll(opening(), SECOND, FIRST, -60);
    const stopped = act(quarrel, FIRST, taxSet("rome", 1_100));
    expect(stopped.applied).toHaveLength(0);
    expect(stopped.rejected[0]!.reason).toMatch(/who holds the same office as .* and thinks ill of him, would not let it be/);
    expect(rateOf(stopped.world, "rome")).toBe(rateOf(quarrel, "rome"));
  });

  it("keeps the customs a season of its own: the tribute settled does not stop the tariff", () => {
    const first = act(opening(), FIRST, taxSet("rome", 1_100)).world;
    // The tariff is the censors' within a tenth (the consuls move it in the Senate), and the season of the tribute is not its season.
    const censor = holdersOf(first, "roman-censor")[0]!;
    const tariff = act(atDay(first, 210), censor, taxSet("rome", 600, "customs"));
    expect(tariff.rejected).toEqual([]);
  });
});
