import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ensurePolityLeadership, type ProposedInvocation, type WorldState } from "@chronica/shared";
import { applyMilitaryEmergencyFallback } from "./military-emergency-fallback";

// Requirement 4: an invaded polity must take one legal, state-backed
// response in the same turn even when the model never acts for it. These
// tests reproduce the scenario the spec names directly: Rome's field army
// marches into the leaderless Etruscan cities' territory.

const ETRURIA = "punic-italy-etrurian-uplands";

function invadedWorld(): WorldState {
  const world = structuredClone(punicWarsScenario.initialWorld);
  const invaded: WorldState = {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) =>
        force.id === "roman-field-army" ? { ...force, locationId: ETRURIA } : force,
      ),
    },
  };
  // Mirrors the pipeline's own step order: leadership is seeded before this
  // fallback ever runs, so the fallback can assume a living leader exists.
  return ensurePolityLeadership(invaded, 1).world;
}

describe("applyMilitaryEmergencyFallback", () => {
  it("levies a new force for an invaded polity with none of its own, when nothing answered for it this turn", () => {
    const world = invadedWorld();
    const leader = world.characters.find((character) => character.polityId === "etruscan-cities" && character.alive);
    expect(leader).toBeDefined();

    const result = applyMilitaryEmergencyFallback(world, 1, []);

    expect(result.invocations).toHaveLength(1);
    expect(result.invocations[0]!.ok).toBe(true);
    expect(result.invocations[0]!.invocation.actionId).toBe("create_force");
    expect(result.invocations[0]!.invocation.actorId).toBe(leader!.id);
    expect(result.world.material.forces.some((force) => force.polityId === "etruscan-cities")).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.materialConsequence).toBe(true);
    expect(result.events[0]!.summary).toMatch(/etruscan cities/i);
  });

  it("moves an existing idle force to meet the invader instead of levying a second one", () => {
    const world = invadedWorld();
    const leader = world.characters.find((character) => character.polityId === "etruscan-cities" && character.alive)!;
    const withIdleForce: WorldState = {
      ...world,
      // Give the Etruscan cities a second holding so their own reserve force
      // can sit somewhere that isn't itself foreign-controlled ground --
      // otherwise placing it anywhere else in this map would trigger a
      // second, unrelated invasion of whoever already holds that province.
      map: {
        ...world.map,
        provinces: world.map.provinces.map((province) =>
          province.id === "punic-italy-samnium" ? { ...province, controllerPolityId: "etruscan-cities" } : province,
        ),
      },
      material: {
        ...world.material,
        forces: [
          ...world.material.forces,
          {
            id: "etruscan-home-guard",
            name: "Etruscan home guard",
            polityId: "etruscan-cities",
            commanderCharacterId: leader.id,
            controllerCharacterId: leader.id,
            locationId: "punic-italy-samnium", // Etruscan-held ground, not yet at the invaded province
            positionId: null,
            authorizedStrength: 1_200,
            personnel: [{ categoryId: "infantry", label: "Levy", fit: 1_000, unavailable: [] }],
            moraleBps: 7_000,
            cohesionBps: 7_000,
            fatigueBps: 0,
            provisionStatus: "provisioned",
            provisionedThroughStep: 8,
            payObligationId: null,
            payArrearsPeriods: 0,
            history: [],
          },
        ],
      },
    };

    const result = applyMilitaryEmergencyFallback(withIdleForce, 1, []);

    expect(result.invocations).toHaveLength(1);
    expect(result.invocations[0]!.invocation.actionId).toBe("move_force");
    expect(result.invocations[0]!.invocation.parameters["forceId"]).toBe("etruscan-home-guard");
    expect(result.invocations[0]!.invocation.parameters["destinationProvinceId"]).toBe(ETRURIA);
    const moved = result.world.material.forces.find((force) => force.id === "etruscan-home-guard");
    expect(moved?.locationId).toBe(ETRURIA);
  });

  it("does nothing when the Game Master (or a political procedure) already answered for the invaded polity this turn", () => {
    const world = invadedWorld();
    const leader = world.characters.find((character) => character.polityId === "etruscan-cities" && character.alive)!;
    const alreadyResponded: ProposedInvocation[] = [
      { actionId: "create_force", actorId: leader.id, parameters: { polityId: "etruscan-cities", locationProvinceId: ETRURIA, name: "Levy", size: 1_000, kind: "infantry" } },
    ];

    const result = applyMilitaryEmergencyFallback(world, 1, alreadyResponded);

    expect(result.invocations).toHaveLength(0);
    expect(result.events).toHaveLength(0);
    // Nothing was minted twice.
    expect(result.world.material.forces.filter((force) => force.polityId === "etruscan-cities")).toHaveLength(0);
  });

  it("never acts for a polity that is not currently invaded", () => {
    const world = structuredClone(punicWarsScenario.initialWorld);
    const result = applyMilitaryEmergencyFallback(world, 1, []);
    expect(result.invocations).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });
});
