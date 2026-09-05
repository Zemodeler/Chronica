import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "@chronica/shared";
import { advanceWorldDynamics } from "./world-dynamics";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

describe("advanceWorldDynamics", () => {
  it("turns a foreign army on controlled ground into a durable emergency for the defender", () => {
    const base = world();
    const province = base.map.provinces.find((candidate) => candidate.controllerPolityId === "carthage")!;
    const romanForce = base.material.forces.find((force) => force.polityId === "rome")!;
    const invaded: WorldState = {
      ...base,
      material: {
        ...base.material,
        forces: base.material.forces.map((force) => force.id === romanForce.id ? { ...force, locationId: province.id } : force),
      },
    };

    const result = advanceWorldDynamics(invaded, 1);
    const emergency = result.world.characterPressures.find((pressure) => pressure.id === `world-incursion-carthage-${romanForce.id}`);

    expect(emergency?.status).toBe("active");
    expect(emergency?.kind).toBe("military_emergency");
    expect(emergency?.label).toContain(romanForce.name);
    expect(result.events.some((event) => event.actionId === "world_incursion_pressure" && event.actorId === emergency?.characterId)).toBe(true);
  });

  it("creates a state-backed Roman Senate development every second season", () => {
    const result = advanceWorldDynamics(world(), 2);
    const scrutiny = result.world.characterPressures.find((pressure) => pressure.id === "world-roman-senate-scrutiny");

    expect(scrutiny?.status).toBe("active");
    expect(scrutiny?.kind).toBe("political_danger");
    expect(result.events.some((event) => event.actionId === "roman_senate_scrutiny")).toBe(true);
  });

  it("does not fabricate a Senate event on the intervening season", () => {
    const result = advanceWorldDynamics(world(), 1);
    expect(result.events.some((event) => event.actionId === "roman_senate_scrutiny")).toBe(false);
  });
});
