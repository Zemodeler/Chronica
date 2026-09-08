import { describe, expect, it } from "vitest";
import { activeReservations, releaseReservation, releaseStageReservations, reserveResource } from "./reservations";

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
