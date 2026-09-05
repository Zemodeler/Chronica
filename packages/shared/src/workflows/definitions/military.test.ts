import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("start_siege", () => {
  // Regression: a siege named a besieging force with no check that the force
  // was anywhere near the target -- "route and target are valid" (item 2)
  // was unverified.
  it("refuses when the invading force is not located at the target settlement's province", () => {
    const w = world();
    // carthaginian-army stands at sicily-west; messana-city is at sicily-northeast.
    const outcome = executeWorkflow(
      { actionId: "start_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", invadingForceIds: ["carthaginian-army"] } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("Carthaginian Army");
    expect(outcome.message).toContain("not at");
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
  // Regression: a siege could "succeed" and hand a settlement to any power at
  // all, with no check that a besieger was still standing or that the power
  // receiving it was ever one of the besiegers.
  function besiege(w: ReturnType<typeof world>) {
    return executeWorkflow(
      { actionId: "start_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", invadingForceIds: ["legio-i"] } },
      w,
      0,
    );
  }

  it("refuses to hand the settlement to a power that never besieged it", () => {
    const started = besiege(world());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const outcome = executeWorkflow(
      { actionId: "end_siege", actorId: "test-actor", parameters: { settlementId: "messana-city", successfulCapture: true, newControllerPolityId: "carthage" } },
      started.world,
      0,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("did not besiege");
  });

  it("refuses a successful capture once every besieging force is reduced to zero fit", () => {
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
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("no one left to have captured it");
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

  it("is not applicable to a non-port settlement", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "blockade_port", actorId: "test-actor", parameters: { settlementId: "settlement-rome", blockadingForceIds: ["legio-i"] } },
      w,
      0,
    );
    expect(outcome.ok).toBe(false);
  });
});
