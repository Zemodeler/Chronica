import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { WorldStateSchema, adjacentTo, type WorldState } from "@chronica/shared";
import { routeOpenBps } from "./trade-flows";
import { withWar } from "./fiscal-test-kit";

/**
 * A tiny war with a one-town Campanian garrison cut every Roman venture to a third, wherever the garrison stood: a war at the other end of Italy shut
 * the harbours at Rome. Now a route is shut by the enemy's men at its ends or next to them, and only a little by a war elsewhere.
 */
const base = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const ROME = PUNIC_IDS.rome;

const enemyIn = (world: WorldState, provinceId: string, polityId: string): WorldState => {
  const template = world.material.forces.find((force) => force.polityId === polityId) ?? world.material.forces[0]!;
  return { ...world, material: { ...world.material, forces: [...world.material.forces, { ...template, id: `enemy-${provinceId}`, polityId, locationId: provinceId, outlaw: false }] } };
};

describe("a small war does not close every route", () => {
  it("leaves a province nine tenths open when the war is elsewhere, and a province at peace whole", () => {
    expect(routeOpenBps({ ...base(), polityAgreements: [] }, ROME)).toBe(10_000);
    const warring = withWar({ ...base(), polityAgreements: [] }, "rome", "carthage");
    const open = routeOpenBps(warring, ROME);
    expect(open).toBeGreaterThanOrEqual(9_000);
  });
  it("shuts it by a third when the enemy stands in it, and by a third less when he stands next to it", () => {
    const warring = withWar(base(), "rome", "carthage");
    const here = routeOpenBps(enemyIn(warring, ROME, "carthage"), ROME);
    expect(here).toBe(3_500);
    const next = adjacentTo(warring, ROME)[0]!.provinceId;
    const beside = routeOpenBps(enemyIn(warring, next, "carthage"), ROME);
    expect(beside).toBe(6_500);
  });
  it("is not moved by the men of a power that is not the enemy", () => {
    const warring = withWar(base(), "rome", "carthage");
    expect(routeOpenBps(enemyIn(warring, ROME, "syracuse"), ROME)).toBeGreaterThanOrEqual(9_000);
  });
});
