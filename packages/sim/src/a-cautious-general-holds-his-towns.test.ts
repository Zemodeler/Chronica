import { describe, expect, it } from "vitest";
import { aMonth, atWar, forceOf, ledBy, neighboursOf, placed, romeAndCarthageAlone, withMen } from "./war-plan-kit";

/**
 * A cautious general holds his towns.
 *
 * Every army chose by the same list, so a careful man and a rash one did the same thing on the same day. Now the same two armies
 * facing one another, with a careful man at the head of one, and the war is not fought as it is when a bold man leads it: he is
 * sent to hold a town of his own and refuse the battle, and the enemy is not marched on.
 */
describe("a cautious general holds his towns", () => {
  function facingAnArmy() {
    let world = ledBy(romeAndCarthageAlone(atWar(120)), "roman-field-army", { boldness: 15, caution: 90 });
    const near = neighboursOf(world, forceOf(world, "roman-field-army").locationId)[0]!;
    world = withMen(placed(world, "carthaginian-garrison", near), "carthaginian-garrison", 7_000);
    return { ...aMonth(world), near };
  }
  const { world, decisions, near } = facingAnArmy();
  const orders = world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;

  it("is sent to keep a town of his own, not to seek the enemy", () => {
    expect(["garrison", "refuse"]).toContain(orders.mode);
    expect(orders.objective.kind).toBe("province");
    const objective = orders.objective.kind === "province" ? orders.objective.provinceId : "";
    expect(world.map.provinces.find((province) => province.id === objective)?.controllerPolityId).toBe("rome");
  });

  it("does not march on the army before him", () => {
    expect(decisions.some((decision) => decision.polityId === "rome" && decision.act === "march" && decision.actorCharacterId === "gaius-genucius")).toBe(false);
    expect(near).not.toBe(forceOf(world, "roman-field-army").locationId);
  });

  it("keeps within the walls: his army is on hold, and will not come out to give battle", () => {
    expect(forceOf(world, "roman-field-army").hold).toBe(true);
  });
});
