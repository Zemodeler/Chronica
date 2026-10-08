import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { Force } from "../material-state";
import { resolveBattle } from "./battle-resolver";
import { EQUIPMENT_MODIFIER_CEILING_BPS, EQUIPMENT_MODIFIER_FLOOR_BPS, EQUIPMENT_NEUTRAL_BPS, equipmentModifierBps } from "./equipment";

/**
 * A poorly kitted army fights worse, a well kitted one a little better, and neither by much.
 *
 * Kit is read as one more modifier of the field, with the position, the ground, the commander and the posture; it is bounded to a tenth either way (well inside the 2,000 basis
 * points no single factor may pass), so that it is a thing to look after and not a way to win. An army the engine has not yet looked at reads as neutral.
 */
const world = () => structuredClone(firstPunicWarScenario.initialWorld);
const province = () => world().map.provinces.find((candidate) => candidate.settlements.some((settlement) => settlement.id === "messana-city"))!;
const army = (id: string, overrides: Partial<Force>): Force => ({
  ...world().material.forces.find((candidate) => candidate.id === "legio-i")!, id, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 4_000, unavailable: [] }],
  moraleBps: 7_000, cohesionBps: 7_000, fatigueBps: 0, ...overrides,
});
const contact = (attackerKit: number | undefined, defenderKit: number | undefined) => {
  const attacker = army("attacker-force", attackerKit === undefined ? {} : { equipmentBps: attackerKit });
  const defender = army("defender-force", defenderKit === undefined ? {} : { equipmentBps: defenderKit });
  const result = resolveBattle({
    battle: { battleId: "kit", provinceId: province().id, startedAtStep: 10, participants: [{ forceId: attacker.id, side: "attacker", arrivesAtPhase: "contact" }, { forceId: defender.id, side: "defender", arrivesAtPhase: "contact" }] },
    participants: [{ forceId: attacker.id, force: attacker, side: "attacker", commander: null }, { forceId: defender.id, force: defender, side: "defender", commander: null }],
    province: province(), provinceMaterial: null, adjacentProvinceIds: [],
  }, "kit-seed");
  return result.phases[0]!;
};

describe("a poorly kitted army fights worse", () => {
  it("reads as nothing where the army has not been looked at, and at the ordinary condition", () => {
    expect(equipmentModifierBps({})).toBe(0);
    expect(equipmentModifierBps({ equipmentBps: EQUIPMENT_NEUTRAL_BPS })).toBe(0);
  });

  it("is bounded however bad or good the kit", () => {
    expect(equipmentModifierBps({ equipmentBps: 0 })).toBe(EQUIPMENT_MODIFIER_FLOOR_BPS);
    expect(equipmentModifierBps({ equipmentBps: 10_000 })).toBe(EQUIPMENT_MODIFIER_CEILING_BPS);
    for (let kit = 0; kit <= 10_000; kit += 250) {
      const bps = equipmentModifierBps({ equipmentBps: kit });
      expect(Math.abs(bps)).toBeLessThanOrEqual(1_000);
      expect(Math.abs(bps)).toBeLessThan(2_000);
    }
    expect(equipmentModifierBps({ equipmentBps: 3_000 })).toBeLessThan(equipmentModifierBps({ equipmentBps: 5_000 }));
  });

  it("weakens an army in rags in the same fight, and strengthens one in new arms, by a bounded share", () => {
    const even = contact(EQUIPMENT_NEUTRAL_BPS, EQUIPMENT_NEUTRAL_BPS);
    const ragged = contact(1_000, EQUIPMENT_NEUTRAL_BPS);
    const fine = contact(10_000, EQUIPMENT_NEUTRAL_BPS);
    expect(ragged.attackerEffectiveStrength).toBeLessThan(even.attackerEffectiveStrength);
    expect(fine.attackerEffectiveStrength).toBeGreaterThan(even.attackerEffectiveStrength);
    // The other side is the same either way.
    expect(ragged.defenderEffectiveStrength).toBe(even.defenderEffectiveStrength);
    // Never beyond a tenth off, nor three in a hundred up.
    expect(ragged.attackerEffectiveStrength / even.attackerEffectiveStrength).toBeGreaterThan(0.89);
    expect(fine.attackerEffectiveStrength / even.attackerEffectiveStrength).toBeLessThan(1.04);
  });
});
