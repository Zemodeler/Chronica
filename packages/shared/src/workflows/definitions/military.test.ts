import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("move_force", () => {
  // docs/27: moving a force to where it already stands must not silently
  // "succeed" as if it moved -- it is a no-op, not a real relocation.
  it("is a no-op when the destination is the force's current province", () => {
    const w = world();
    const force = w.material.forces.find((f) => f.id === "carthaginian-army")!;
    const outcome = executeWorkflow(
      { actionId: "move_force", actorId: "test-actor", parameters: { forceId: force.id, destinationProvinceId: force.locationId } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.noOp).toBe(true);
    expect(outcome.world.material.forces.find((f) => f.id === force.id)?.locationId).toBe(force.locationId);
  });

  it("moves a force to a genuinely different province", () => {
    const w = world();
    const force = w.material.forces.find((f) => f.id === "legio-i")!;
    const destination = w.map.provinces.find((p) => p.id !== force.locationId)!.id;
    const outcome = executeWorkflow(
      { actionId: "move_force", actorId: "test-actor", parameters: { forceId: force.id, destinationProvinceId: destination } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.noOp).toBeUndefined();
    expect(outcome.world.material.forces.find((f) => f.id === force.id)?.locationId).toBe(destination);
  });

  it("moves a force to a named position within its current province", () => {
    const w = world();
    const force = w.material.forces.find((f) => f.id === "legio-i")!;
    const province = w.map.provinces.find((p) => p.id === force.locationId)!;
    const positioned = {
      ...w,
      map: {
        ...w.map,
        provinces: w.map.provinces.map((p) => p.id !== province.id ? p : {
          ...p,
          positions: [{ id: "ridge", provinceId: p.id, label: "The ridge", type: "pass" as const, combatModifierBps: 500, capacity: 2 }],
        }),
      },
    };
    const outcome = executeWorkflow(
      { actionId: "move_force", actorId: "test-actor", parameters: { forceId: force.id, destinationProvinceId: province.id, destinationPositionId: "ridge" } },
      positioned,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.noOp).toBeUndefined();
    expect(outcome.world.material.forces.find((f) => f.id === force.id)?.positionId).toBe("ridge");
  });
});

describe("start_siege", () => {
  // Workflows are tools, not gatekeepers: a besieging force does not have to
  // already stand in the target's province for the siege to begin.
  it("succeeds regardless of the invading force's current province", () => {
    const w = world();
    // carthaginian-army stands at sicily-west; messana-city is at sicily-northeast.
    const outcome = executeWorkflow(
      { actionId: "start_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", invadingForceIds: ["carthaginian-army"] } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const siege = outcome.world.conflicts.sieges.find((s) => s.settlementId === "messana-city");
    expect(siege?.invadingForceIds).toEqual(["carthaginian-army"]);
  });

  it("succeeds when the invading force already stands in the target's province", () => {
    const w = world();
    // legio-i already stands at sicily-northeast, where messana-city is.
    const outcome = executeWorkflow(
      { actionId: "start_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", invadingForceIds: ["legio-i"] } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
  });
});

describe("end_siege", () => {
  // Workflows are tools, not gatekeepers: end_siege hands the settlement to
  // whichever polity the caller names, whether or not that polity was ever
  // one of the besiegers, and whether or not the besieging force is still
  // standing. The GM/caller is the real gate on whether that call should
  // happen at all.
  function besiege(w: ReturnType<typeof world>) {
    return executeWorkflow(
      { actionId: "start_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", invadingForceIds: ["legio-i"] } },
      w,
      0,
    );
  }

  it("succeeds handing the settlement to a power that never besieged it", () => {
    const started = besiege(world());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const outcome = executeWorkflow(
      { actionId: "end_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", successfulCapture: true, newControllerPolityId: "carthage" } },
      started.world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const province = outcome.world.map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-northeast");
    expect(province?.controllerPolityId).toBe("carthage");
  });

  it("succeeds capturing once every besieging force is reduced to zero fit", () => {
    const started = besiege(world());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Wiped out in the fighting, but the record (and the siege's own
    // non-empty invadingForceIds) remains -- exactly the shape a real
    // near-annihilation leaves behind, distinct from the force simply being
    // withdrawn/disbanded.
    const gutted = {
      ...started.world,
      material: {
        ...started.world.material,
        forces: started.world.material.forces.map((f) =>
          f.id === "legio-i" ? { ...f, personnel: f.personnel.map((category) => ({ ...category, fit: 0 })) } : f,
        ),
      },
    };
    const outcome = executeWorkflow(
      { actionId: "end_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", successfulCapture: true, newControllerPolityId: "rome" } },
      gutted,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const province = outcome.world.map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-northeast");
    expect(province?.controllerPolityId).toBe("rome");
  });

  it("succeeds in handing the settlement to the polity that actually besieged it", () => {
    const started = besiege(world());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const outcome = executeWorkflow(
      { actionId: "end_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", successfulCapture: true, newControllerPolityId: "rome" } },
      started.world,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const province = outcome.world.map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-northeast");
    expect(province?.controllerPolityId).toBe("rome");
    expect(province?.controlFirmnessBps).toBe(3_000);
    expect(province?.settlements.find((settlement) => settlement.id === "messana-city")?.controllerPolityId).toBe("rome");
  });
});

describe("disband_forces_bulk", () => {
  it("disbands multiple forces and cleans up battle participants", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "disband_forces_bulk", actorId: "test-actor", parameters: { forceIds: ["legio-i", "carthaginian-army"], reason: "The war ends." } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.forces).toEqual([]);
    expect(outcome.world.conflicts.battles.find((b) => b.battleId === "sicilian-frontier")).toBeUndefined();
  });

  it("is not applicable when none of the given force ids exist", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "disband_forces_bulk", actorId: "test-actor", parameters: { forceIds: ["nowhere"], reason: "n/a" } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("blockade_port", () => {
  it("blockades a port settlement as a siege with no defenders", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "blockade_port", actorId: "test-actor", parameters: { settlementId: "messana-city", blockadingForceIds: ["legio-i"] } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const siege = outcome.world.conflicts.sieges.find((s) => s.settlementId === "messana-city");
    expect(siege?.invadingForceIds).toEqual(["legio-i"]);
    expect(siege?.defendingForceIds).toEqual([]);
  });

  it("blockades a non-port settlement just as readily", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "blockade_port", actorId: "test-actor", parameters: { settlementId: "settlement-rome", blockadingForceIds: ["legio-i"] } },
      w,
      0,
    );
    expect(outcome.ok).toBe(true);
  });
});
