import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("appoint_to_office — restricted shortcut", () => {
  it("fails without an authorization referencing a resolved, passed procedure", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "quintus-fabius", parameters: { characterId: "quintus-fabius", officeId: "roman-command" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("succeeds when authorized by a resolved, passed appointment procedure", () => {
    const w = world();
    // The scenario seeds roman-command as already held by Marcus; vacate it
    // first so this test is appointing into an open seat, not overriding one.
    w.material.officeSeats = w.material.officeSeats.map((s) =>
      s.officeId === "roman-command" ? { ...s, status: "vacant" as const, vacancyCause: "resignation" as const, holderCharacterId: null } : s,
    );
    w.material.politicalProcedures.push({
      id: "appoint-quintus", type: "appointment", institutionId: "roman-senate", sponsorCharacterId: "quintus-fabius",
      subjectKind: "office_seat", subjectId: "roman-command", linkedWorkflowId: "appoint_to_office",
      linkedWorkflowParams: { characterId: "quintus-fabius", officeId: "roman-command" },
      eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote",
      openedAtStep: 0, deadlineStep: null, resolvedAtStep: 1, visibility: "polity", voteRecordId: null,
      outcome: "passed", outcomeReason: "The Senate elected him.", sourceEventIds: [], resultingEventIds: [],
    });
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "quintus-fabius", parameters: { characterId: "quintus-fabius", officeId: "roman-command", authorization: { procedureId: "appoint-quintus" } } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.characters.find((c) => c.id === "quintus-fabius")?.officeId).toBe("roman-command");
  });

  it("refuses to appoint over an already-held exclusive seat", () => {
    // The scenario seeds roman-command as already held by Marcus.
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "system", parameters: { characterId: "quintus-fabius", officeId: "roman-command" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("system authority may appoint directly (narrow admin/test path)", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "system", parameters: { characterId: "quintus-fabius", officeId: "some-other-office" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
  });
});

describe("remove_from_office — restricted shortcut", () => {
  it("fails without an authorization referencing a resolved, passed procedure", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "remove_from_office", actorId: "quintus-fabius", parameters: { characterId: "marcus-atilius", reason: "Censure." } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("succeeds when authorized by a resolved, passed removal procedure and vacates the seat", () => {
    // The scenario already seeds an office seat for roman-command held by Marcus.
    const w = world();
    w.material.politicalProcedures = w.material.politicalProcedures.map((p) =>
      p.id === "senate-censure-marcus"
        ? { ...p, stage: "resolved" as const, outcome: "passed" as const, resolvedAtStep: 1, outcomeReason: "The Senate censured him." }
        : p,
    );
    const outcome = executeWorkflow(
      { actionId: "remove_from_office", actorId: "quintus-fabius", parameters: { characterId: "marcus-atilius", reason: "Censure.", authorization: { procedureId: "senate-censure-marcus" } } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.characters.find((c) => c.id === "marcus-atilius")?.officeId).toBeNull();
    const seat = outcome.world.material.officeSeats.find((s) => s.officeId === "roman-command");
    expect(seat?.status).toBe("vacant");
    expect(seat?.vacancyCause).toBe("removal");
  });
});
