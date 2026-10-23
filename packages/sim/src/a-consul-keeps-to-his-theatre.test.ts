import { describe, expect, it } from "vitest";
import { warPlanOf } from "@chronica/shared";
import { aMonth, atWar, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A consul keeps to his theatre.
 *
 * His army went one way in March and the other in April, because every month it chose again from a list and whatever scored best
 * that day won. Now he is sent against a province or an army, and stays on it until it is taken, or runs out, or something happens
 * that a sensible man would answer; the plan of the war is not changed with the weather.
 */
describe("a consul keeps to his theatre", { timeout: 300_000 }, () => {
  const memo: { seen?: ReturnType<typeof sixMonthsRun> } = {};
  const sixMonths = () => (memo.seen ??= sixMonthsRun());
  function sixMonthsRun() {
    let world = romeAndCarthageAlone(atWar(120));
    const seen: { objective: string; mode: string; aims: string; marches: number }[] = [];
    for (let month = 0; month < 6; month += 1) {
      const passed = aMonth(world);
      const orders = passed.world.campaigns.find((entry) => entry.forceId === "roman-field-army");
      const plan = warPlanOf(passed.world, "rome", "carthage");
      seen.push({
        objective: JSON.stringify(orders?.objective), mode: orders?.mode ?? "none",
        aims: JSON.stringify((plan?.aims ?? []).map((aim) => `${aim.kind}:${aim.provinceId ?? ""}`).sort()),
        marches: passed.decisions.filter((decision) => decision.polityId === "rome" && decision.act === "march" && decision.actorCharacterId === "gaius-genucius").length,
      });
      world = { ...passed.world, instant: { ...passed.world.instant, day: passed.world.instant.day + 30 }, elapsedStep: passed.world.elapsedStep + 30 };
    }
    return seen;
  }

  it("is sent against one object and is not turned from it month by month", () => {
    const seen = sixMonths();
    expect(seen[0]!.mode).not.toBe("none");
    expect(new Set(seen.map((month) => month.objective)).size).toBe(1);
    expect(new Set(seen.map((month) => month.mode)).size).toBe(1);
  });

  it("does not order the same march again while it is on the road", () => {
    expect(sixMonths().reduce((sum, month) => sum + month.marches, 0)).toBeLessThanOrEqual(1);
  });

  it("holds to the aims of the war for the season", () => {
    expect(new Set(sixMonths().map((month) => month.aims)).size).toBe(1);
  });
});
