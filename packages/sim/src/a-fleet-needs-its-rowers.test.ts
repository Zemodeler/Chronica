import { describe, expect, it } from "vitest";
import { PUNIC_IDS } from "@chronica/db";
import { CREW_PER_WARSHIP, crewPerHull, ownsAndHolds } from "@chronica/shared";
import { raiseLevy } from "./levies";
import { createIdFactory } from "./ports";
import { opening } from "./equipment-test-kit";

/**
 * A fleet needs its rowers.
 *
 * Ships were hulls, and a hundred and twenty of them stood ready whether or not there was a man in the country to pull an oar. A quinquereme wanted three hundred oarsmen and a hundred and
 * twenty marines (Polybius 1.26.7); the marines were legionaries embarked, the oarsmen came from the naval pool, the roll of the ports and the landless of the census (6.19.4) and, at Rome,
 * the seamen of the allies who owed ships (the socii navales). They draw the roll as any levy does, and a fleet that is lost takes its crews with it.
 */
const LATIUM = PUNIC_IDS.rome;
const ships = (world: ReturnType<typeof opening>, polityId: string, hulls: number, provinceId: string) => raiseLevy(world, {
  polityId, provinceId, men: hulls, payerAccountId: null, pays: false, atStep: 0, cause: "fleet", ids: createIdFactory("rowers"), categoryId: "warship",
});
const roll = (world: ReturnType<typeof opening>, polityId: string): number => world.map.provinces.filter((province) => ownsAndHolds(province, polityId))
  .reduce((sum, province) => sum + (world.material.provinceMaterial.find((row) => row.provinceId === province.id)?.availableManpower ?? 0), 0);

describe("a fleet needs its rowers", () => {
  const world = opening();

  it("wants three hundred oarsmen to a warship and a few to a transport", () => {
    expect(crewPerHull("warship")).toBe(CREW_PER_WARSHIP);
    expect(CREW_PER_WARSHIP).toBe(300);
    expect(crewPerHull("transport")).toBeLessThan(CREW_PER_WARSHIP);
    expect(crewPerHull("infantry")).toBe(0);
  });

  it("draws every crew out of the roll of its power's ground, three hundred to a ship", () => {
    const before = roll(world, "rome");
    const levy = ships(world, "rome", 20, LATIUM);
    expect(levy.men).toBe(20);
    // Some of the oarsmen are the allies' seamen; at least two thirds are Rome's own.
    const drawn = before - roll(levy.world, "rome");
    expect(drawn).toBeGreaterThanOrEqual(20 * 300 * 0.64);
    expect(drawn).toBeLessThanOrEqual(20 * 300);
  });

  it("manns fewer hulls where there are no oarsmen for them, and says why", () => {
    const poor = {
      ...world,
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => ({ ...row, availableManpower: Math.min(row.availableManpower, 40) })) },
    };
    const levy = ships(poor, "rome", 120, LATIUM);
    expect(levy.men).toBeLessThan(120);
    expect(levy.short).toMatch(/could be manned/);
    // The oarsmen are Rome's own, and the allies' seamen at most a third and a half of a hundred of the crews.
    const own = roll(poor, "rome");
    expect(levy.men * 300).toBeLessThanOrEqual(own / 0.65 + 1);
  });

  it("does not give a lost fleet's crews back", () => {
    const levy = ships(world, "carthage", 50, world.map.provinces.find((province) => ownsAndHolds(province, "carthage"))!.id);
    const after = roll(levy.world, "carthage");
    expect(after).toBeLessThan(roll(world, "carthage"));
    // The fleet is sunk: nothing in the roll returns its three hundred men a ship, but the years' growth (`applyCoarseRecoveryTick`) fills it slowly.
    expect(roll(world, "carthage") - after).toBeGreaterThanOrEqual(50 * 300 * 0.99);
  });
});
