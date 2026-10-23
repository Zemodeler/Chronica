import { describe, expect, it } from "vitest";
import { sameConfederation, type Force, type WorldState } from "@chronica/shared";
import { definition, withWar } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";
import { withTheConsularArmyOnceDrawn } from "./the-opening-as-it-was";
import { planSupply } from "./supply-plan";

/**
 * An ally feeds the army (supply-plan's third way, `friendlyPower`): where the army stands on a country that sells it nothing and the power has no ground of its own with bread
 * to send, the bread comes up by convoy from the nearest ground of a friend by the foedus, the cost is the chest's, and the plan says it is an ally's bread.
 */

const ARMY = "roman-field-army";
const warfare = definition.warfare;
let built: WorldState | undefined;
const atWar = (): WorldState => (built ??= withTheConsularArmyOnceDrawn(withWar(stockedWorld(150, 2.2, [], 3_000_000), "rome", "carthage")));
const armyOf = (world: WorldState): Force => world.material.forces.find((force) => force.id === ARMY)!;

/** The army stands where no market sells it bread, and not a province of Rome's own is left to send any: the ground of the Republic is, for this test, held by Carthage. */
function aloneWithAllies(): { world: WorldState; allied: Set<string> } {
  const world = atWar();
  const allied = new Set(world.map.polities.filter((polity) => polity.id !== "rome" && sameConfederation(world.polityAgreements, "rome", polity.id)).map((polity) => polity.id));
  const where = armyOf(world).locationId;
  return {
    allied,
    world: {
      ...world,
      map: {
        ...world.map,
        provinces: world.map.provinces.map((province) => {
          if (province.id === where) return { ...province, controllerPolityId: "carthage", settlements: province.settlements.map((settlement) => ({ ...settlement, controllerPolityId: "carthage" })) };
          return province.controllerPolityId === "rome" ? { ...province, controllerPolityId: "carthage" } : province;
        }),
      },
    },
  };
}

describe("an ally feeds the army", () => {
  it("sends bread up from the nearest ground of a friend by the foedus, at the chest's cost, and says it is an ally's", () => {
    const { world, allied } = aloneWithAllies();
    expect(allied.size).toBeGreaterThan(0);
    const plan = planSupply(world, armyOf(world), 30, { warfare });
    expect(plan.ok).toBe(true);
    expect(plan.how).toBe("ally");
    expect(plan.days).toBe(30);
    expect(plan.cost).toBeGreaterThan(0);
    expect(plan.legitimacyCost).toBe(0);
    expect(plan.deltas[0]).toMatchObject({ op: "force_provision", how: "convoy", forceRef: ARMY, days: 30 });
    const from = (plan.deltas[0] as { fromProvinceId: string | null }).fromProvinceId;
    const source = world.map.provinces.find((province) => province.id === from);
    expect(source).toBeDefined();
    expect(allied.has(source!.controllerPolityId!)).toBe(true);
    expect(plan.words).toMatch(/was sent up to Roman field army from .*, the bread of an ally/);
    expect(plan.considered.join(" ")).toMatch(/no market/);
  });

  it("does not ask an ally for bread when it is not a friend by the foedus", () => {
    const { world, allied } = aloneWithAllies();
    // The foedus gone, the same country is a stranger's and the officer takes the bread another way, or finds none.
    const strangers: WorldState = { ...world, polityAgreements: world.polityAgreements.filter((agreement) => !(agreement.kind === "foedus" && allied.has(agreement.polityId))) };
    const plan = planSupply(strangers, armyOf(strangers), 30, { warfare });
    expect(plan.how).not.toBe("ally");
  });

  it("is the same every time", () => {
    const { world } = aloneWithAllies();
    expect(JSON.stringify(planSupply(world, armyOf(world), 30, { warfare }))).toBe(JSON.stringify(planSupply(world, armyOf(world), 30, { warfare })));
  });
});
