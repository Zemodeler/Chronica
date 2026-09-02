import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";
import type { WorldState } from "../../world/world-state";

const world = () => structuredClone(firstPunicWarScenario.initialWorld) as WorldState;

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
