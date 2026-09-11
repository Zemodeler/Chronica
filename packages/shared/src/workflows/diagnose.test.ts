import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { diagnoseFailedInvocation, repairInvocationIds } from "./diagnose";

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

// Repairing one, rather than only naming it. The bug: a siege ordered against
// "messana" was refused because the authoritative id is "settlement-messana",
// and that was reported to the player as history -- an order nobody heard --
// when nothing about the world had said no.

/** A settlement whose id is `settlement-x` and whose bare `x` names no other settlement. */
function unambiguousSettlement(w: ReturnType<typeof world>) {
  const settlements = w.map.provinces.flatMap((province) => province.settlements);
  const bareOf = (id: string) => id.replace(/^settlement-/, "");
  return settlements.find((candidate) => {
    const bare = bareOf(candidate.id);
    return bare !== candidate.id && settlements.filter((other) => bareOf(other.id) === bare).length === 1;
  })!;
}

describe("repairing a guessed id", () => {
  it("resolves an id written without the prefix the record stores", () => {
    const w = world();
    const settlement = unambiguousSettlement(w);
    const bare = settlement.id.replace(/^settlement-/, "");

    const repair = repairInvocationIds(w, "start_siege", { settlementId: bare });

    expect(repair?.parameters["settlementId"]).toBe(settlement.id);
    expect(repair?.repairs.join()).toContain(settlement.id);
  });

  it("resolves an entity named the way a person would say it", () => {
    const w = world();
    const settlement = unambiguousSettlement(w);

    const repair = repairInvocationIds(w, "start_siege", { settlementId: settlement.name });

    expect(repair?.parameters["settlementId"]).toBe(settlement.id);
  });

  it("leaves a call alone when every id already resolves", () => {
    const w = world();
    expect(repairInvocationIds(w, "move_force", {
      forceId: w.material.forces[0]!.id,
      destinationProvinceId: w.map.provinces[0]!.id,
    })).toBeNull();
  });

  it("refuses to guess when two entities could be meant", () => {
    const w = world();
    const settlement = unambiguousSettlement(w);
    const bare = settlement.id.replace(/^settlement-/, "");
    // A second settlement the same bare name could equally point at.
    w.map.provinces[0]!.settlements.push({ ...structuredClone(settlement), id: `outpost-${bare}` });

    expect(repairInvocationIds(w, "start_siege", { settlementId: bare })).toBeNull();
  });

  it("never repairs across kinds, so a character id cannot become a province", () => {
    const w = world();
    const province = w.map.provinces[0]!;
    const bare = province.id.split("-").pop()!;

    expect(repairInvocationIds(w, "kill_character", { characterId: bare })).toBeNull();
  });

  it("does not repair the id a workflow is about to bring into being", () => {
    const w = world();
    expect(repairInvocationIds(w, "create_force", {
      polityId: w.map.polities[0]!.id,
      locationProvinceId: w.map.provinces[0]!.id,
      forceId: "legio-not-yet-raised",
    })).toBeNull();
  });

  it("gives up entirely when one id of several cannot be resolved", () => {
    const w = world();
    const settlement = unambiguousSettlement(w);
    const bare = settlement.id.replace(/^settlement-/, "");

    // Repairing only the settlement would spend a retry on a call that still
    // fails for the other id, so nothing is repaired.
    expect(repairInvocationIds(w, "start_siege", { settlementId: bare, besiegingForceId: "ghost-legion" })).toBeNull();
  });
});
