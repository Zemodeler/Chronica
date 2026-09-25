import { describe, expect, it } from "vitest";
import type { Province } from "../world/map";
import type { ProvinceMaterial } from "../material-state";
import {
  deriveDefaultProvinceMaterial,
  ensureProvinceMaterial,
  applyRecruitmentToMaterial,
  applyWarDamage,
  applyCoarseRecoveryTick,
  advanceProvinceMaterial,
  applyWarDamageForExecutedWorkflows,
  findProvinceMaterial,
} from "./province-material";

const province: Province = {
  id: "sicily-west",
  name: "Western Sicily",
  formerNames: [],
  terrainId: "coastal-plain",
  settlements: [
    { id: "drepanum-city", name: "Drepanum", kind: "port", provinceId: "sicily-west", controllerPolityId: "carthage", size: 55, fortificationLevel: 3 },
  ],
  controllerPolityId: "carthage",
  controlFirmnessBps: 8_000,
  tier: "focus",
};

function material(overrides: Partial<ProvinceMaterial> = {}): ProvinceMaterial {
  return {
    ...deriveDefaultProvinceMaterial(province, 0),
    ...overrides,
  };
}

describe("deriveDefaultProvinceMaterial", () => {
  it("derives population from settlement size", () => {
    const result = deriveDefaultProvinceMaterial(province, 5);
    expect(result.population).toBe(55 * 400);
    expect(result.availableManpower).toBeGreaterThan(0);
    expect(result.availableManpower).toBeLessThan(result.population);
    expect(result.lastMaterialUpdateStep).toBe(5);
  });

  it("derives zero population for a province with no settlements", () => {
    const empty: Province = { ...province, settlements: [] };
    const result = deriveDefaultProvinceMaterial(empty, 0);
    expect(result.population).toBe(0);
    expect(result.availableManpower).toBe(0);
  });
});

describe("ensureProvinceMaterial", () => {
  it("backfills a missing province and leaves an existing one untouched", () => {
    const otherProvince: Province = { ...province, id: "sicily-east", settlements: [] };
    const existing = material({ population: 999 });
    const world = {
      map: { provinces: [province, otherProvince], edges: [], polities: [], politicalRelations: [] },
      material: { provinceMaterial: [existing] },
    } as never;

    const result = ensureProvinceMaterial(world, 10);
    expect(result.material.provinceMaterial).toHaveLength(2);
    expect(findProvinceMaterial(result, province.id)?.population).toBe(999);
    expect(findProvinceMaterial(result, otherProvince.id)?.population).toBe(0);
  });

  it("is a no-op when every province already has material state", () => {
    const world = {
      map: { provinces: [province], edges: [], polities: [], politicalRelations: [] },
      material: { provinceMaterial: [material()] },
    } as never;
    expect(ensureProvinceMaterial(world, 10)).toBe(world);
  });
});

describe("applyRecruitmentToMaterial", () => {
  it("draws down available manpower and dents productive capacity", () => {
    const before = material({ availableManpower: 1_000, productiveCapacityBps: 10_000 });
    const after = applyRecruitmentToMaterial(before, 400, 3);
    expect(after.availableManpower).toBe(600);
    expect(after.productiveCapacityBps).toBeLessThan(10_000);
    expect(after.lastMaterialUpdateStep).toBe(3);
  });

  it("never draws more manpower than is available", () => {
    const before = material({ availableManpower: 100 });
    const after = applyRecruitmentToMaterial(before, 10_000, 1);
    expect(after.availableManpower).toBe(0);
  });
});

describe("applyWarDamage", () => {
  it("reduces food, stability, production, and population, and raises war damage and displacement", () => {
    const before = material({ population: 10_000, foodSecurityBps: 8_000, stabilityBps: 7_000, warDamageBps: 0, displacedPopulation: 0 });
    const after = applyWarDamage(before, { severityBps: 5_000 }, 2);
    expect(after.population).toBeLessThan(before.population);
    expect(after.displacedPopulation).toBeGreaterThan(0);
    expect(after.foodSecurityBps).toBeLessThan(before.foodSecurityBps);
    expect(after.stabilityBps).toBeLessThan(before.stabilityBps);
    expect(after.warDamageBps).toBeGreaterThan(before.warDamageBps);
  });
});

describe("applyCoarseRecoveryTick", () => {
  it("gradually restores a damaged province without healing it instantly", () => {
    const damaged = material({ foodSecurityBps: 2_000, stabilityBps: 1_000, warDamageBps: 6_000, lastMaterialUpdateStep: 0 });
    const after = applyCoarseRecoveryTick(damaged, 1);
    expect(after.foodSecurityBps).toBeGreaterThan(damaged.foodSecurityBps);
    expect(after.stabilityBps).toBeGreaterThan(damaged.stabilityBps);
    expect(after.warDamageBps).toBeLessThan(damaged.warDamageBps);
    // One step of recovery must not fully heal six turns of accumulated damage.
    expect(after.warDamageBps).toBeGreaterThan(0);
  });

  it("is a no-op when the province was already updated this step", () => {
    const current = material({ lastMaterialUpdateStep: 5 });
    expect(applyCoarseRecoveryTick(current, 5)).toBe(current);
  });

  it("keeps eroding stability and displacing population while a province stays food-insecure, even with no fresh damage", () => {
    // Stability already at baseline (no war-recovery boost to mask the
    // effect) and severely short of food -- isolates the ongoing shortage
    // pressure from the unrelated war-damage recovery this same tick applies.
    const hungry = material({ stabilityBps: 7_000, foodSecurityBps: 1_000, displacedPopulation: 0, lastMaterialUpdateStep: 0 });
    const after = applyCoarseRecoveryTick(hungry, 5);
    expect(after.stabilityBps).toBeLessThan(hungry.stabilityBps);
    expect(after.displacedPopulation).toBeGreaterThan(0);
  });

  it("does not erode stability or displace anyone once food security is at or above the shortage threshold", () => {
    const secure = material({ stabilityBps: 7_000, foodSecurityBps: 4_000, displacedPopulation: 0, lastMaterialUpdateStep: 0 });
    const after = applyCoarseRecoveryTick(secure, 5);
    expect(after.stabilityBps).toBeGreaterThanOrEqual(secure.stabilityBps);
    expect(after.displacedPopulation).toBe(0);
  });
});

describe("advanceProvinceMaterial", () => {
  it("applies recovery only to provinces not marked affected this turn", () => {
    const damagedA = material({ provinceId: "a", stabilityBps: 1_000, lastMaterialUpdateStep: 0 });
    const damagedB = material({ provinceId: "b", stabilityBps: 1_000, lastMaterialUpdateStep: 0 });
    const world = {
      map: { provinces: [{ ...province, id: "a" }, { ...province, id: "b" }], edges: [], polities: [], politicalRelations: [] },
      material: { provinceMaterial: [damagedA, damagedB] },
    } as never;

    const result = advanceProvinceMaterial(world, 10, new Set(["a"]));
    expect(findProvinceMaterial(result, "a")?.stabilityBps).toBe(1_000); // affected this turn — left alone here
    expect(findProvinceMaterial(result, "b")?.stabilityBps).toBeGreaterThan(1_000); // recovers
  });
});

describe("applyWarDamageForExecutedWorkflows", () => {
  it("strikes the besieged settlement's province on start_siege and marks it affected", () => {
    const world = {
      map: { provinces: [province], edges: [], polities: [], politicalRelations: [] },
      material: { provinceMaterial: [material()], forces: [] },
    } as never;

    const result = applyWarDamageForExecutedWorkflows(world, [
      { actionId: "start_siege", parameters: { settlementId: "drepanum-city", invadingForceIds: ["f1"] } },
    ], 3);

    expect(result.affectedProvinceIds.has(province.id)).toBe(true);
    expect(findProvinceMaterial(result.world, province.id)?.warDamageBps).toBeGreaterThan(0);
  });

  it("ignores an unrelated workflow", () => {
    const world = {
      map: { provinces: [province], edges: [], polities: [], politicalRelations: [] },
      material: { provinceMaterial: [material()], forces: [] },
    } as never;
    const result = applyWarDamageForExecutedWorkflows(world, [
      { actionId: "add_gold", parameters: { accountId: "acc-1", amount: 10 } },
    ], 3);
    expect(result.affectedProvinceIds.size).toBe(0);
  });
});
