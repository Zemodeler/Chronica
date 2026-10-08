import { describe, expect, it } from "vitest";
import { aMonth, atWar, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A war's plans are deterministic.
 *
 * Plans and orders hash the game, the day and the men concerned and nothing else: the same war, replayed from the same day,
 * lays the same plans, sends the same orders and draws the same lots.
 */
describe("a war's plans are deterministic", () => {
  const run = () => {
    let world = romeAndCarthageAlone(atWar(120));
    const told: string[] = [];
    for (let month = 0; month < 4; month += 1) {
      const passed = aMonth(world);
      told.push(JSON.stringify(passed.decisions.filter((decision) => decision.act === "war_plan" || decision.act === "march" || decision.act === "hold" || decision.act === "attack" || decision.act === "besiege").map((decision) => [decision.polityId, decision.act, decision.why, decision.deltas])));
      world = { ...passed.world, instant: { ...passed.world.instant, day: passed.world.instant.day + 30 }, elapsedStep: passed.world.elapsedStep + 30 };
    }
    return { told, plans: JSON.stringify(world.warPlans), orders: JSON.stringify(world.campaigns) };
  };

  it("lays the same plans and sends the same orders on a second run", () => {
    const first = run();
    const second = run();
    expect(second.told).toEqual(first.told);
    expect(second.plans).toBe(first.plans);
    expect(second.orders).toBe(first.orders);
    expect(first.plans.length).toBeGreaterThan(10);
  });
});
