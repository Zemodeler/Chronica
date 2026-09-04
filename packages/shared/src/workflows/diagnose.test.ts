import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { diagnoseFailedInvocation } from "./diagnose";

// Why a refusal has to say something. Before this, every workflow that
// declined said only "cannot be applied to the current world state" -- so an
// order died on a guessed id, the Game Master reported the failure, and the
// player read a Chronicle entry about nothing happening.

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("diagnosing a refusal", () => {
  it("names the id that answers to nothing", () => {
    const diagnosis = diagnoseFailedInvocation(world(), "create_force", { polityId: "atlantis", locationProvinceId: "nowhere" });
    expect(diagnosis.message).toContain('polityId "atlantis"');
    expect(diagnosis.message).toContain('locationProvinceId "nowhere"');
    expect(diagnosis.message).toMatch(/inspect/i);
  });

  it("says nothing when every id resolves, so a real reason is not overwritten", () => {
    const w = world();
    const diagnosis = diagnoseFailedInvocation(w, "move_force", {
      forceId: w.material.forces[0]!.id,
      destinationProvinceId: w.map.provinces[0]!.id,
    });
    expect(diagnosis.message).toBeNull();
  });

  it("does not complain about the id a workflow is about to bring into being", () => {
    const w = world();
    const diagnosis = diagnoseFailedInvocation(w, "create_force", {
      polityId: w.map.polities[0]!.id,
      locationProvinceId: w.map.provinces[0]!.id,
      forceId: "legio-not-yet-raised",
    });
    expect(diagnosis.message).toBeNull();
  });

  it("checks every id in a list, not just the first", () => {
    const w = world();
    const diagnosis = diagnoseFailedInvocation(w, "start_battle", {
      attackingForceIds: [w.material.forces[0]!.id],
      defendingForceIds: ["ghost-legion"],
    });
    expect(diagnosis.message).toContain("ghost-legion");
  });
});
