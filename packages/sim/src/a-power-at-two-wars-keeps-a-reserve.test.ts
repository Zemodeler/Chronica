import { warPlanOf, type WorldState } from "@chronica/shared";
import { describe, expect, it } from "vitest";
import { claimOf, shareArmies } from "./two-fronts";
import { aMonth, atWar, forceOf, strategyCtx, withMen } from "./war-plan-kit";

/**
 * A power at two wars keeps a reserve for the second.
 *
 * Rome was at war with Carthage and with the Campanians of Rhegium at once, and the bigger enemy had the first claim on every army: the
 * legions went to Sicily and the war at the gates of Rhegium was planned with none. The armies are now shared by what each war has at stake
 * (the enemy's men in the field, the ground of ours he holds, his armies on our ground), each war with an enemy in the field keeping at
 * least one army where there are as many armies as wars, and the rest going where the claim per army is greatest.
 */
describe("a power at two wars keeps a reserve for the second", () => {
  const twoArmies = (): WorldState => {
    const world = withMen(atWar(120), "roman-field-army", 17_000);
    const first = forceOf(world, "roman-field-army");
    const second = { ...first, id: "roman-second-army", name: "Second Roman army", commanderCharacterId: "manius-curius", controllerCharacterId: "manius-curius" };
    return { ...world, material: { ...world.material, forces: [...world.material.forces, withMenOf(second, 6_000)] } };
  };
  const withMenOf = (force: ReturnType<typeof forceOf>, men: number): ReturnType<typeof forceOf> => ({ ...force, authorizedStrength: men, personnel: force.personnel.map((group, index) => (index === 0 ? { ...group, fit: men } : { ...group, fit: 0 })) });

  const { world } = aMonth(twoArmies());
  const carthage = warPlanOf(world, "rome", "carthage")!;
  const rhegium = warPlanOf(world, "rome", "rhegium-campanians")!;
  const armiesOf = (plan: typeof carthage): string[] => plan.theatres.flatMap((theatre) => theatre.forceIds);

  it("gives each war an army of its own where there are as many armies as wars", () => {
    expect(armiesOf(carthage).length).toBeGreaterThanOrEqual(1);
    expect(armiesOf(rhegium).length).toBeGreaterThanOrEqual(1);
  });

  it("sends no army to both, and none is left without a war", () => {
    const all = [...armiesOf(carthage), ...armiesOf(rhegium)];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(["roman-field-army", "roman-second-army"]);
  });

  it("gives the greater claim the stronger army", () => {
    const stronger = armiesOf(carthage).includes("roman-field-army") ? "carthage" : "rhegium";
    const ctxOf = (enemies: string[]) => strategyCtx(twoArmies(), "rome", enemies);
    const claims = { carthage: claimOf(ctxOf(["carthage"])), rhegium: claimOf(ctxOf(["rhegium-campanians"])) };
    expect(stronger).toBe(claims.carthage >= claims.rhegium ? "carthage" : "rhegium");
  });

  it("gives all the armies to a single war, as before", () => {
    const one = twoArmies();
    const ctx = strategyCtx(one, "rome", ["carthage"]);
    const shared = shareArmies([{ enemy: "carthage", ctx }], one.material.forces.filter((force) => force.polityId === "rome"), new Map());
    expect(shared.get("carthage")!.length).toBe(one.material.forces.filter((force) => force.polityId === "rome").length);
  });

  it("keeps an army in the war it is at work in while the share allows", () => {
    const base = twoArmies();
    const ctxs = [{ enemy: "carthage", ctx: strategyCtx(base, "rome", ["carthage"]) }, { enemy: "rhegium-campanians", ctx: strategyCtx(base, "rome", ["rhegium-campanians"]) }];
    const mine = base.material.forces.filter((force) => force.polityId === "rome");
    const swapped = shareArmies(ctxs, mine, new Map([["roman-second-army", "carthage"], ["roman-field-army", "rhegium-campanians"]]));
    expect(swapped.get("carthage")!.map((force) => force.id)).toContain("roman-second-army");
    expect(swapped.get("rhegium-campanians")!.map((force) => force.id)).toContain("roman-field-army");
  });
});
