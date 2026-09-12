import { describe, expect, it } from "vitest";
import { activeReservations, claimedResourcesForStage, releaseReservation, releaseStageReservations, reserveResource } from "./reservations";

describe("reserveResource / releaseReservation (docs/32, Phase 4)", () => {
  it("adds a reservation and reports it as active", () => {
    const reservations = reserveResource([], { planId: "plan-1", stageId: "march", kind: "force", resourceId: "force-1", atStep: 1 });
    expect(reservations).toHaveLength(1);
    expect(activeReservations(reservations, { kind: "force", resourceId: "force-1" })).toHaveLength(1);
  });

  it("does not duplicate an already-active identical reservation", () => {
    const first = reserveResource([], { planId: "plan-1", stageId: "march", kind: "force", resourceId: "force-1", atStep: 1 });
    const second = reserveResource(first, { planId: "plan-1", stageId: "march", kind: "force", resourceId: "force-1", atStep: 2 });
    expect(second).toHaveLength(1);
  });

  it("releasing a reservation stops it from showing as active, without deleting its history", () => {
    const reserved = reserveResource([], { planId: "plan-1", stageId: "march", kind: "account", resourceId: "acct-1", atStep: 1 });
    const released = releaseReservation(reserved, reserved[0]!.id, 3);
    expect(activeReservations(released, { kind: "account", resourceId: "acct-1" })).toHaveLength(0);
    expect(released[0]!.releasedAtStep).toBe(3);
  });

  it("releaseStageReservations releases every reservation a stage holds", () => {
    let reservations = reserveResource([], { planId: "plan-1", stageId: "march", kind: "force", resourceId: "force-1", atStep: 1 });
    reservations = reserveResource(reservations, { planId: "plan-1", stageId: "march", kind: "account", resourceId: "acct-1", atStep: 1 });
    const released = releaseStageReservations(reservations, "march", 5);
    expect(activeReservations(released)).toHaveLength(0);
  });
});

describe("claimedResourcesForStage (unified action runtime, Stage 6)", () => {
  it("always claims the acting character's own time, even with no id parameters at all", () => {
    expect(claimedResourcesForStage("marcus-atilius", {})).toEqual([{ kind: "character_time", resourceId: "marcus-atilius" }]);
  });

  it("finds a force, an account, and an office from the call's own parameter names, generically", () => {
    const claims = claimedResourcesForStage("marcus-atilius", {
      forceId: "legio-ii",
      destinationProvinceId: "syracuse",
      accountId: "acct-1",
      officeId: "office-consul",
    });
    expect(claims).toEqual([
      { kind: "character_time", resourceId: "marcus-atilius" },
      { kind: "force", resourceId: "legio-ii" },
      { kind: "account", resourceId: "acct-1" },
      { kind: "office", resourceId: "office-consul" },
    ]);
  });

  it("finds every entry of a plural id-list parameter, not just the first", () => {
    const claims = claimedResourcesForStage("hieron-ii", { invadingForceIds: ["army-a", "army-b"] });
    expect(claims).toEqual([
      { kind: "character_time", resourceId: "hieron-ii" },
      { kind: "force", resourceId: "army-a" },
      { kind: "force", resourceId: "army-b" },
    ]);
  });

  it("never invents a claim for a parameter whose suffix names no resource kind", () => {
    const claims = claimedResourcesForStage("marcus-atilius", { characterId: "hanno", settlementId: "messana" });
    expect(claims).toEqual([{ kind: "character_time", resourceId: "marcus-atilius" }]);
  });

  it("never double-claims the same resource twice", () => {
    const claims = claimedResourcesForStage("marcus-atilius", { forceId: "legio-ii", defendingForceIds: ["legio-ii"] });
    expect(claims).toEqual([
      { kind: "character_time", resourceId: "marcus-atilius" },
      { kind: "force", resourceId: "legio-ii" },
    ]);
  });
});
