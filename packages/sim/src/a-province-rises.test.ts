import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { EMPTY_ECONOMY_MEMORY, ScenarioDefinitionSchema, WorldStateSchema, atWar, economyOf, ensureProvinceMaterial, isQuietGround, type ProvinceMaterial, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { RISING_AFTER_MONTHS, YEARNING_AT_CONQUEST_BPS } from "./unrest";

/**
 * A province rises by itself.
 *
 * Misery never became a rising unless the narrator drew one, and ground taken
 * in war wanted nothing back: only a treaty or a surrender gave its people
 * someone to yearn for. Now ground lost in war remembers its old master, and
 * half a year of order broken down on top of hunger, a crushing tax or a
 * foreign master is a rising -- for the old master where there is one, as a
 * power of its own where there is not, and put down where the garrison is the
 * stronger.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const tick = (world: WorldState, toDay: number) => runDeterministicTick({ world, toDay, ids: createIdFactory(`rise-${toDay}`), warfare: definition.warfare });
const row = (world: WorldState, id: string): ProvinceMaterial => world.material.provinceMaterial.find((material) => material.provinceId === id)!;

/** A Roman province nobody garrisons, with men enough to rise -- and history enough to (the far edge never rises). */
function quietRomanProvince(world: WorldState): string {
  const garrisoned = new Set(world.material.forces.map((force) => force.locationId));
  const province = world.map.provinces.find((candidate) => candidate.controllerPolityId === "rome" && !isQuietGround(candidate) && !garrisoned.has(candidate.id) && row(world, candidate.id).availableManpower >= 1_000);
  expect(province).toBeDefined();
  return province!.id;
}

/** A province starving and in disorder, that has been so for all but the last month it needs. */
function miserable(world: WorldState, provinceId: string, months = RISING_AFTER_MONTHS - 1): WorldState {
  return {
    ...world,
    economy: { ...EMPTY_ECONOMY_MEMORY, lastReviewStep: 0, unrest: [{ provinceId, months }] },
    material: {
      ...world.material,
      provinceMaterial: world.material.provinceMaterial.map((material) => (material.provinceId === provinceId ? { ...material, stabilityBps: 1_000, foodSecurityBps: 1_500 } : material)),
    },
  };
}

describe("a province rises", () => {
  it("counts the months of misery, and forgets them as it recovers", () => {
    const world = opening();
    const provinceId = quietRomanProvince(world);
    const counted = tick(miserable(world, provinceId, 0), 30).world;
    expect(economyOf(counted).unrest.find((entry) => entry.provinceId === provinceId)?.months).toBe(1);
    // Fed and orderly again, the count runs down.
    const recovered = tick({ ...counted, material: { ...counted.material, provinceMaterial: counted.material.provinceMaterial.map((material) => (material.provinceId === provinceId ? { ...material, stabilityBps: 8_000, foodSecurityBps: 8_000 } : material)) } }, 60).world;
    expect(economyOf(recovered).unrest.find((entry) => entry.provinceId === provinceId)).toBeUndefined();
  });

  it("rises as a power of its own after half a year of it, where nobody else is wanted", () => {
    const world = opening();
    const provinceId = quietRomanProvince(world);
    const ticked = tick(miserable(world, provinceId), 30);
    expect(WorldStateSchema.safeParse(ticked.world).success).toBe(true);
    const holder = ticked.world.map.provinces.find((province) => province.id === provinceId)!.controllerPolityId!;
    expect(holder).not.toBe("rome");
    const rebels = ticked.world.map.polities.find((polity) => polity.id === holder)!;
    expect(rebels.name).toContain("Free People");
    expect(atWar(ticked.world.polityAgreements, holder, "rome")).toBe(true);
    expect(ticked.world.material.forces.some((force) => force.polityId === holder && force.locationId === provinceId)).toBe(true);
    expect(ticked.factProposals.find((fact) => fact.kind === "rising")?.summary).toContain("misery");
  });

  it("is put down where the garrison outnumbers it", () => {
    const world = opening();
    const provinceId = quietRomanProvince(world);
    const legion = world.material.forces.find((force) => force.polityId === "rome")!;
    const garrisoned: WorldState = {
      ...world,
      material: { ...world.material, forces: [...world.material.forces, { ...legion, id: "garrison", locationId: provinceId, positionId: null, personnel: [{ categoryId: "infantry", label: "Garrison", fit: 5_000, unavailable: [] }] }] },
    };
    const ticked = tick(miserable(garrisoned, provinceId), 30);
    expect(ticked.world.map.provinces.find((province) => province.id === provinceId)!.controllerPolityId).toBe("rome");
    expect(ticked.factProposals.some((fact) => fact.kind === "rising_crushed")).toBe(true);
  });

  it("rises for its old master where it has one", () => {
    const world = opening();
    const provinceId = quietRomanProvince(world);
    const yearning: WorldState = {
      ...world,
      map: { ...world.map, provinces: world.map.provinces.map((province) => (province.id === provinceId ? { ...province, yearning: { polityId: "samnites", bps: 3_000, updatedAtStep: 0 } } : province)) },
    };
    const ticked = tick(miserable(yearning, provinceId), 30);
    expect(ticked.world.map.provinces.find((province) => province.id === provinceId)!.controllerPolityId).toBe("samnites");
    expect(ticked.factProposals.some((fact) => fact.kind === "rising")).toBe(true);
  });

  it("remembers whose ground it was when it is taken in war", () => {
    const world = opening();
    const provinceId = quietRomanProvince(world);
    const taken: WorldState = {
      ...world,
      map: { ...world.map, provinces: world.map.provinces.map((province) => (province.id === provinceId ? { ...province, lostBy: { polityId: "carthage", atStep: 0 }, yearning: null } : province)) },
    };
    const ticked = tick(taken, 1).world;
    expect(ticked.map.provinces.find((province) => province.id === provinceId)!.yearning).toEqual({ polityId: "carthage", bps: YEARNING_AT_CONQUEST_BPS, updatedAtStep: 1 });
  });
});
