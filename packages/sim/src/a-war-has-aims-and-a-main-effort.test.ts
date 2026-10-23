import { describe, expect, it } from "vitest";
import { WarPlanSchema, CampaignPlanSchema, WorldStateSchema, warPlanOf } from "@chronica/shared";
import { aMonth, atWar, forceOf, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A war has aims and a main effort.
 *
 * Armies at war chose from a list every month, and the head of the state, who knows what the war is for, was heard by nobody. The
 * month a war is opened, each power at it lays a plan: what it means to hold and to take, where the weight of it falls, how it
 * means to fight, and which army goes to which part of it.
 */
describe("a war has aims and a main effort", () => {
  const first = aMonth(romeAndCarthageAlone(atWar(120)));
  const plan = warPlanOf(first.world, "rome", "carthage")!;

  it("is laid down by each power at war, and is a record the world keeps", () => {
    expect(plan).toBeDefined();
    expect(WarPlanSchema.safeParse(plan).success).toBe(true);
    expect(warPlanOf(first.world, "carthage", "rome")).toBeDefined();
    expect(WorldStateSchema.safeParse(first.world).success).toBe(true);
    expect(first.decisions.filter((decision) => decision.act === "war_plan" && decision.polityId === "rome").length).toBeGreaterThan(0);
  });

  it("names things to take or to hold in the war's own country, and one main effort", () => {
    expect(plan.aims.length).toBeGreaterThan(0);
    expect(plan.aims.length).toBeLessThanOrEqual(5);
    const provinces = new Set(first.world.map.provinces.map((province) => province.id));
    for (const aim of plan.aims) if (aim.provinceId !== undefined) expect(provinces.has(aim.provinceId)).toBe(true);
    expect(plan.theatres.filter((theatre) => theatre.mainEffort)).toHaveLength(1);
    // The same aim is not written twice.
    const keys = plan.aims.map((aim) => `${aim.kind}:${aim.provinceId ?? ""}:${aim.polityId ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sends the strongest army to the main effort, and gives it its orders", () => {
    const main = plan.theatres.find((theatre) => theatre.mainEffort)!;
    expect(main.forceIds).toContain("roman-field-army");
    expect(main.commanderId).toBe(forceOf(first.world, "roman-field-army").commanderCharacterId);
    const orders = first.world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;
    expect(CampaignPlanSchema.safeParse(orders).success).toBe(true);
    expect(orders.theatreId).toBe(main.id);
    expect(orders.warId).toBe(plan.warId);
    expect(orders.expiresStep).toBeGreaterThan(orders.issuedStep);
  });

  it("is told as a fact in the power's own words", () => {
    const told = first.decisions.find((decision) => decision.act === "war_plan" && decision.polityId === "rome" && decision.deltas.some((delta) => delta.op === "campaign_plan_set"));
    expect(told).toBeDefined();
    expect(told!.why.length).toBeGreaterThan(10);
  });
});
