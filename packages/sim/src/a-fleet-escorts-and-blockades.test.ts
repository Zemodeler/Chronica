import { describe, expect, it } from "vitest";
import { fitStrengthOf } from "@chronica/shared";
import { fleetOrder, navalPlanFor } from "./naval-orders";
import { aMonth, atWar, dayInSeason, forceOf, placed, romeAndCarthageAlone, strategyCtx, withMen } from "./war-plan-kit";

/**
 * A fleet escorts, blockades and seeks the enemy's fleet.
 *
 * Fleets were skipped by the rules altogether: the First Punic War was a sea war and no power's ships ever moved but by an order.
 * Now a fleet that is the stronger goes to seek the enemy's, one that has nothing to meet goes to shut up an enemy harbour,
 * one that is the weaker draws off to a harbour of its own, and in the winter the sea is shut and the ships are beached.
 */
describe("a fleet escorts, blockades and seeks", () => {
  const summer = dayInSeason("summer");
  const world = romeAndCarthageAlone(atWar(summer));
  const carthage = (over = world) => strategyCtx(over, "carthage", ["rome", "rhegium-campanians"]);
  const rome = (over = world) => strategyCtx(over, "rome", ["carthage"]);
  const noSets = { marching: new Set<string>(), fighting: new Set<string>(), besieging: new Set<string>() };
  const planned = aMonth(world).world;
  const planOf = (polity: string) => planned.warPlans.find((plan) => plan.polityId === polity && plan.enemyPolityId === (polity === "rome" ? "carthage" : "rome"))!;

  it("seeks the enemy's fleet when it is the stronger, and says why", () => {
    const plan = { ...planOf("carthage"), navalPlan: navalPlanFor(carthage(planned), planOf("carthage"), []) };
    expect(plan.navalPlan?.kind).toBe("seek_fleet");
    const order = fleetOrder(carthage(planned), forceOf(planned, "carthaginian-fleet"), plan, noSets);
    expect(order?.act).toBe("march");
    const move = order!.deltas.find((delta) => delta.op === "force_modify");
    expect(move && "locationId" in move ? move.locationId : undefined).toBe(forceOf(planned, "allied-greek-hulls").locationId);
  });

  it("gives battle to the enemy's ships on the same water when it is the stronger, and draws off when it is not", () => {
    const together = placed(planned, "carthaginian-fleet", forceOf(planned, "allied-greek-hulls").locationId);
    const strong = fleetOrder(carthage(together), forceOf(together, "carthaginian-fleet"), planOf("carthage"), noSets);
    expect(strong?.act).toBe("attack");
    expect(strong!.deltas.some((delta) => delta.op === "force_engage")).toBe(true);
    const weak = fleetOrder(rome(together), forceOf(together, "allied-greek-hulls"), planOf("rome"), noSets);
    expect(weak === null || weak.act === "fall_back").toBe(true);
    expect(weak?.act).not.toBe("attack");
  });

  it("goes to shut up an enemy harbour when there is no fleet to meet", () => {
    const without = withMen(planned, "allied-greek-hulls", 1);
    const plan = navalPlanFor(carthage(without), planOf("carthage"), []);
    expect(plan === undefined || plan.kind === "blockade" || plan.kind === "seek_fleet").toBe(true);
    const gone = { ...planned, material: { ...planned.material, forces: planned.material.forces.filter((force) => force.id !== "allied-greek-hulls") } };
    const blockading = navalPlanFor(strategyCtx(gone, "carthage", ["rome", "rhegium-campanians"]), planOf("carthage"), []);
    expect(blockading?.kind).toBe("blockade");
    expect(blockading!.seaProvinceIds.length).toBeGreaterThan(0);
  });

  it("stands ready to carry an army over when the land is not to be reached on foot", () => {
    const plan = navalPlanFor(rome(planned), planOf("rome"), ["sic-doquc"]);
    expect(plan?.kind).toBe("escort");
    expect(fitStrengthOf(forceOf(planned, "allied-greek-hulls"))).toBeGreaterThan(0);
  });

  it("is beached for the winter: no fleet is sent to sea when the sea is shut", () => {
    const winter = romeAndCarthageAlone(atWar(dayInSeason("winter")));
    const order = fleetOrder(strategyCtx(winter, "carthage", ["rome", "rhegium-campanians"]), forceOf(winter, "carthaginian-fleet"), { ...planOf("carthage"), navalPlan: { kind: "seek_fleet", seaProvinceIds: ["it-5sjyb"] } }, noSets);
    expect(order === null || order.act === "fall_back").toBe(true);
  });
});
