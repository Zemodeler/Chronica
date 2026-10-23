import { describe, expect, it } from "vitest";
import type { CampaignPlan } from "@chronica/shared";
import { campaignStillGood, issueCampaign } from "./campaign-orders";
import { aMonth, atWar, forceOf, romeAndCarthageAlone, strategyCtx } from "./war-plan-kit";

/**
 * An order the army cannot carry out is cancelled, with the reason, and a feasible one given.
 *
 * An army ordered to besiege a town over the water with no ships sat in Latium for years under "siege orders it could not carry out", and the
 * orders were told as news ("sends the army to besiege") though nothing could start.
 */
describe("an impossible order is replaced", () => {
  const world = romeAndCarthageAlone(atWar(120));
  const army = forceOf(world, "roman-field-army");
  // Carthage's own harbour town: over the sea, and Rome has no hulls of its own in the opening's war.
  const overWater = world.map.provinces.find((province) => province.controllerPolityId === "carthage" && province.settlements.length > 0)!;
  const order: CampaignPlan = { forceId: army.id, polityId: "rome", warId: "x", theatreId: null, objective: { kind: "province", provinceId: overWater.id }, baseProvinceId: null, fallbackProvinceId: null, mode: "siege", issuedByCharacterId: "gaius-genucius", issuedStep: 100, expiresStep: 300, byRule: true, forCommanderId: army.commanderCharacterId };
  const plan = { warId: "x", polityId: "rome", enemyPolityId: "carthage", aims: [{ kind: "hold_province" as const, provinceId: army.locationId }], theatres: [], posture: "defend" as const, reviewedAtStep: 100, aimsSetAtStep: 100, aimsChangedAtStep: 100, issuedByCharacterId: "gaius-genucius" };

  it("is no longer good when there is no road and no ship to its object", () => {
    const bare = { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => !(force.polityId === "rome" && force.id !== army.id)) } };
    const ctx = strategyCtx(bare, "rome", ["carthage"]);
    const reach = new Map<string, number>([[army.locationId, 0]]);
    expect(campaignStillGood(ctx, army, order, plan as never, undefined, new Set(), reach)).toBe(false);
  });

  it("is replaced by orders that can be carried out, saying why", () => {
    const bare = { ...world, material: { ...world.material, forces: world.material.forces.filter((force) => !(force.polityId === "rome" && force.id !== army.id)) } };
    const ctx = strategyCtx(bare, "rome", ["carthage"]);
    const issued = issueCampaign(ctx, army, plan, undefined, "gaius-genucius", order);
    expect(issued).not.toBeNull();
    expect(issued!.campaign.byRule).toBe(true);
    expect(JSON.stringify(issued!.campaign.objective)).not.toBe(JSON.stringify(order.objective));
    expect(issued!.why).toMatch(/could not be carried out/);
    expect(issued!.changed).toBe(true);
  });

  it("holds in a month's statecraft: the orders in force are never ones the army cannot start", () => {
    const month = aMonth({ ...world, campaigns: [order] });
    const now = month.world.campaigns.find((entry) => entry.forceId === army.id);
    if (now !== undefined && JSON.stringify(now.objective) === JSON.stringify(order.objective)) expect(now.issuedStep).toBe(100);
  });
});
