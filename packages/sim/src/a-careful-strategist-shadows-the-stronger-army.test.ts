import { fitStrengthOf, type CampaignPlan, type WorldState } from "@chronica/shared";
import { describe, expect, it } from "vitest";
import { keepTheField } from "./campaign";
import { shadowedForceIds } from "./a-shadowed-army-goes-hungry";
import { aMonth, atWar, dayInSeason, definition, forceOf, ledBy, neighboursOf, placed, romeAndCarthageAlone, withMen } from "./war-plan-kit";

/**
 * A careful strategist shadows the stronger army.
 *
 * Fabius had five thousand and Hannibal many more, and he did not shut himself in a town (the careful man's way) nor go out to be beaten: he
 * kept to the hills a march from the Carthaginian and let him find no corn and no quiet road. The rules now send a man of that kind
 * (a strategist, careful, no rash one) to shadow an army half as strong again as his own that ranges ground which is not its side's own; a plain
 * careful man still keeps his towns. And the army shadowed is cut from the country about it and from convoys from afar, so it must move on or go hungry.
 */
describe("a careful strategist shadows the stronger army", () => {
  const SUMMER = dayInSeason("summer");
  const ENEMY = "carthaginian-sicilian-army";
  function theStrongerArmyRanges(nature: Parameters<typeof ledBy>[2]): { world: WorldState; where: string; start: string } {
    let world = ledBy(romeAndCarthageAlone(atWar(SUMMER)), "roman-field-army", nature);
    const start = forceOf(world, "roman-field-army").locationId;
    const where = neighboursOf(world, start)[0]!;
    world = withMen(placed(world, ENEMY, where), ENEMY, 8_000);
    world = withMen(world, "roman-field-army", 5_000);
    return { world, where, start };
  }

  const strategist = theStrongerArmyRanges({ boldness: 35, caution: 75, strategist: 75, martial: 60 });
  const month = aMonth(strategist.world);
  const orders = month.world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;

  it("is sent to shadow the army, not to keep a town or to meet it", () => {
    expect(orders.mode).toBe("shadow");
    expect(orders.objective).toEqual({ kind: "army", forceId: ENEMY });
    expect(orders.byRule).toBe(true);
  });

  it("keeps a post within a march of the enemy, not in his camp, and does not shut himself in a town", () => {
    const army = forceOf(month.world, "roman-field-army");
    expect(army.locationId).not.toBe(strategist.where);
    expect(army.hold).not.toBe(true);
    expect(shadowedForceIds(month.world, month.world.instant.day).has(ENEMY)).toBe(true);
    expect(month.facts.some((fact) => /in sight and cut it off from its bread/.test(fact))).toBe(true);
  });

  it("goes to a post when the enemy is farther off than a march", () => {
    const far = placed(strategist.world, "roman-field-army", neighboursOf(strategist.world, neighboursOf(strategist.world, strategist.where)[1]!)[2] ?? strategist.start);
    const moved = aMonth(far);
    expect(moved.world.campaigns.find((entry) => entry.forceId === "roman-field-army")?.mode).toBe("shadow");
  });

  it("is not chosen by a plain careful man (no strategist), who keeps his town as before", () => {
    const plain = aMonth(theStrongerArmyRanges({ boldness: 15, caution: 90, strategist: 30, martial: 40 }).world);
    expect(plain.world.campaigns.find((entry) => entry.forceId === "roman-field-army")?.mode).not.toBe("shadow");
  });

  it("is not chosen against an enemy that is no stronger", () => {
    const even = withMen(strategist.world, ENEMY, 5_200);
    expect(aMonth(even).world.campaigns.find((entry) => entry.forceId === "roman-field-army")?.mode).not.toBe("shadow");
  });

  describe("the army shadowed", () => {
    // The enemy in the rich country about the Almo (it feeds him), the Roman a march off in the hills, and sixty days.
    const rich = forceOf(strategist.world, "roman-field-army").locationId;
    const post = neighboursOf(strategist.world, rich)[0]!;
    const base = (): WorldState => {
      let world = withMen(placed(strategist.world, ENEMY, rich), ENEMY, 6_000);
      world = placed(world, "roman-field-army", post);
      const day = world.instant.day;
      return { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === ENEMY || force.id === "roman-field-army" ? { ...force, reckonedToStep: day, provisionedThroughStep: day, provisionStatus: "provisioned" as const } : force)) } };
    };
    const order = (world: WorldState): CampaignPlan => ({
      forceId: "roman-field-army", polityId: "rome", warId: world.polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active" && [agreement.polityId, agreement.otherPolityId].includes("carthage"))!.id,
      theatreId: null, objective: { kind: "army", forceId: ENEMY }, baseProvinceId: null, fallbackProvinceId: null, mode: "shadow",
      issuedByCharacterId: "gaius-genucius", issuedStep: world.instant.day, expiresStep: world.instant.day + 150, byRule: true, forCommanderId: forceOf(world, "roman-field-army").commanderCharacterId,
    });
    const after = (world: WorldState): ReturnType<typeof forceOf> => {
      const toDay = world.instant.day + 60;
      return forceOf(keepTheField({ world, toDay, month: 6, warfare: definition.warfare }).world, ENEMY);
    };

    it("feeds on the country when nobody shadows it", () => {
      const world = base();
      expect(shadowedForceIds(world, world.instant.day).has(ENEMY)).toBe(false);
      expect(after(world).provisionStatus).toBe("provisioned");
    });

    it("is cut from the country when shadowed, and goes short and then loses men to hunger", () => {
      const world = { ...base(), campaigns: [order(base())] };
      expect(shadowedForceIds(world, world.instant.day).has(ENEMY)).toBe(true);
      const hungry = after(world);
      expect(hungry.provisionStatus).not.toBe("provisioned");
      expect(fitStrengthOf(hungry)).toBeLessThan(6_000);
    });

    it("is not cut where the shadow is too far off, or too small to be one", () => {
      const world = base();
      const far = { ...world, campaigns: [order(world)], material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: "afr-9sdex" } : force)) } };
      expect(shadowedForceIds(far, far.instant.day).has(ENEMY)).toBe(false);
      const screen = withMen({ ...world, campaigns: [order(world)] }, "roman-field-army", 400);
      expect(shadowedForceIds(screen, screen.instant.day).has(ENEMY)).toBe(false);
    });
  });
});
