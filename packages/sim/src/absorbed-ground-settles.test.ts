import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { reviewPowers } from "./polity-end";

/**
 * Ground that wants its old master settles under a quiet, fed hold.
 *
 * Nothing raised the firmness of taken or surrendered ground, so its yearning grew four hundred a month whatever its
 * holder did and every absorbed province rose about fourteen months on (hand runs of 2026-10-16 and 2026-10-22, H2).
 */
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

function carry(world: WorldState, provinceId: string, months: number): WorldState {
  let current = world;
  for (let month = 1; month <= months; month += 1) current = reviewPowers(current, month * 30, createIdFactory(`settle-${month}`)).world;
  return current;
}

describe("ground that wants its old master", () => {
  const province = (world: WorldState) => world.map.provinces.find((candidate) => candidate.controllerPolityId === "rome")!;

  it("does not rise in two years while the hold is quiet and the people are fed", () => {
    const world = opening();
    const target = province(world);
    const loose: WorldState = {
      ...world,
      map: { ...world.map, provinces: world.map.provinces.map((candidate) => (candidate.id === target.id ? { ...candidate, controlFirmnessBps: 3_000, yearning: { polityId: "samnites", bps: 4_000, updatedAtStep: 0 } } : candidate)) },
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === target.id ? { ...row, stabilityBps: 6_500, foodSecurityBps: 7_000 } : row)) },
    };
    const after = carry(loose, target.id, 24);
    const settled = after.map.provinces.find((candidate) => candidate.id === target.id)!;
    expect(settled.controllerPolityId).toBe("rome");
    expect(settled.controlFirmnessBps).toBeGreaterThan(5_000);
  });

  it("still rises where order has broken down: misery does not settle a hold", () => {
    const world = opening();
    const target = province(world);
    const loose: WorldState = {
      ...world,
      map: { ...world.map, provinces: world.map.provinces.map((candidate) => (candidate.id === target.id ? { ...candidate, controlFirmnessBps: 3_000, yearning: { polityId: "samnites", bps: 4_000, updatedAtStep: 0 } } : candidate)) },
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === target.id ? { ...row, stabilityBps: 1_500, foodSecurityBps: 1_500 } : row)) },
    };
    const after = carry(loose, target.id, 24);
    expect(after.map.provinces.find((candidate) => candidate.id === target.id)!.controllerPolityId).toBe("samnites");
  });
});
