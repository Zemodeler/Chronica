import { describe, expect, it } from "vitest";
import { aMonth, atWar, forceOf, ledBy, neighboursOf, placed, romeAndCarthageAlone, withMen } from "./war-plan-kit";

/**
 * A bold general seeks the battle.
 *
 * The same two armies, and a bold man at the head of the stronger: he is sent against the enemy's army, and goes, and his army is
 * not put on hold. Set beside `a-cautious-general-holds-his-towns` this is the whole of what a man's nature does to a war.
 */
describe("a bold general seeks the battle", () => {
  const start = ledBy(romeAndCarthageAlone(atWar(120)), "roman-field-army", { boldness: 90, caution: 15 });
  const near = neighboursOf(start, forceOf(start, "roman-field-army").locationId)[0]!;
  const { world, decisions } = aMonth(withMen(placed(start, "carthaginian-garrison", near), "carthaginian-garrison", 7_000));
  const orders = world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;

  it("is sent against the enemy's army", () => {
    expect(orders.mode).toBe("seek_battle");
    expect(orders.objective).toEqual({ kind: "army", forceId: "carthaginian-garrison" });
  });

  it("marches on it, and the war's plan is to have it out", () => {
    expect(decisions.some((decision) => decision.polityId === "rome" && decision.act === "march" && decision.actorCharacterId === "gaius-genucius")).toBe(true);
    expect(world.warPlans.find((plan) => plan.polityId === "rome" && plan.enemyPolityId === "carthage")!.posture).toBe("decisive");
  });

  it("is not put on hold", () => {
    expect(forceOf(world, "roman-field-army").hold).not.toBe(true);
  });
});
