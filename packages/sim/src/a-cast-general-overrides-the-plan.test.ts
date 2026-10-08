import { describe, expect, it } from "vitest";
import { WorldDeltaSchema, readDepartments } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { rulerOptions } from "./statecraft";
import { aMonth, atWar, context, forceOf, inputFor, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A general the model plays overrides the plan.
 *
 * The rules lead every army that nobody plays. A man the model plays reads his plan and his orders in one line, may write them
 * anew (`war_plan_set`, `campaign_plan_set`, bounded as the rules' own are), the rules stand back from the armies he commands, and
 * the armies he sends keep to the orders he gave them.
 */
describe("a general the model plays overrides the plan", () => {
  const rome = romeAndCarthageAlone(atWar(120));
  const heads = new Set(readDepartments(rome).rulers("rome").map((ruler) => ruler.id));
  const lieutenant = rome.characters.find((character) => character.polityId === "rome" && character.alive && !heads.has(character.id) && !rome.material.forces.some((force) => force.commanderCharacterId === character.id))!;
  const second = { ...forceOf(rome, "roman-field-army"), id: "second-legion", name: "The second legion", commanderCharacterId: lieutenant.id, controllerCharacterId: lieutenant.id };
  const world = { ...rome, material: { ...rome.material, forces: [...rome.material.forces, second] } };
  const played = new Set(["gaius-genucius"]);
  const target = world.map.provinces.find((province) => province.controllerPolityId === "carthage" && province.settlements.length > 0)!;

  const given = WorldDeltaSchema.parse({
    op: "campaign_plan_set", forceRef: "second-legion", mode: "siege", objectiveProvinceId: target.id, baseProvinceId: null, fallbackProvinceId: null, days: 120, reason: "Gaius sends the second legion against Carthage's town.",
  });
  const written = applyDeltas(world, [given], context(world, "gaius-genucius") as never);

  it("is written by the same act and held to the same bounds", () => {
    const plan = written.world.campaigns.find((entry) => entry.forceId === "second-legion")!;
    expect(plan).toMatchObject({ mode: "siege", objective: { kind: "province", provinceId: target.id }, issuedByCharacterId: "gaius-genucius" });
    expect(plan.expiresStep).toBe(world.elapsedStep + 120);
    // No longer than a campaign, and only on ground that is there.
    expect(WorldDeltaSchema.safeParse({ ...given, days: 400 }).success).toBe(false);
    const nowhere = applyDeltas(world, [WorldDeltaSchema.parse({ ...given, objectiveProvinceId: "no-such-place" })], context(world, "gaius-genucius") as never);
    expect(nowhere.rejected.length).toBe(1);
    expect(nowhere.world.campaigns.some((entry) => entry.forceId === "second-legion")).toBe(false);
  });

  it("is let alone by the rules where he has taken his army in hand, and the rules keep to what he ordered his followers", () => {
    // He has written his own orders for his own army: the rules lead nothing he commands then (playtest fix batch 2: the rules' own orders in his name are carried out for him, `a-consular-army-marches-within-a-month`).
    const own = { forceId: "roman-field-army", polityId: "rome", warId: written.world.campaigns[0]?.warId ?? "x", theatreId: null, objective: { kind: "province" as const, provinceId: target.id }, baseProvinceId: null, fallbackProvinceId: null, mode: "siege" as const, issuedByCharacterId: "gaius-genucius", issuedStep: world.elapsedStep, expiresStep: world.elapsedStep + 120 };
    const month = aMonth({ ...written.world, campaigns: [...written.world.campaigns.filter((entry) => entry.forceId !== "roman-field-army"), own] }, { playedByModel: played });
    expect(month.decisions.some((decision) => decision.polityId === "rome" && decision.actorCharacterId === "gaius-genucius" && ["march", "attack", "besiege", "fall_back", "hold"].includes(decision.act))).toBe(false);
    const kept = month.world.campaigns.find((entry) => entry.forceId === "second-legion")!;
    expect(kept.issuedByCharacterId).toBe("gaius-genucius");
    expect(kept.objective).toEqual({ kind: "province", provinceId: target.id });
    expect(kept.mode).toBe("siege");
  });

  it("is shown his plan and his orders in one line, and a general who is not the ruler his own", () => {
    const options = rulerOptions(inputFor(month().world, { playedByModel: played }), "gaius-genucius");
    expect(options.some((line) => line.startsWith("War plan against Carthage"))).toBe(true);
    expect(options.every((line) => line.length <= 300)).toBe(true);
    const his = rulerOptions(inputFor(month().world, { playedByModel: new Set([lieutenant.id]) }), lieutenant.id);
    expect(his).toHaveLength(1);
    expect(his[0]).toContain("Orders:");
    expect(his[0]!.length).toBeLessThanOrEqual(300);
  });

  function month() {
    return aMonth(written.world, { playedByModel: played });
  }
});
