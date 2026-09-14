import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("appoint_to_office — restricted shortcut", () => {
  it("succeeds even without an authorization referencing a resolved, passed procedure", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "quintus-fabius", parameters: { characterId: "quintus-fabius", officeId: "some-other-office" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.characters.find((c) => c.id === "quintus-fabius")?.officeId).toBe("some-other-office");
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

  it("appoints over an already-held exclusive seat rather than refusing", () => {
    // The scenario seeds roman-command as already held by Marcus.
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "system", parameters: { characterId: "quintus-fabius", officeId: "roman-command" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.characters.find((c) => c.id === "quintus-fabius")?.officeId).toBe("roman-command");
    const seat = outcome.world.material.officeSeats.find((s) => s.officeId === "roman-command");
    expect(seat?.holderCharacterId).toBe("quintus-fabius");
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

  it("refuses an authorization naming a procedure that never resolved", () => {
    const w = world();
    w.material.politicalProcedures.push({
      id: "unresolved-appointment", type: "appointment", institutionId: "roman-senate", sponsorCharacterId: "quintus-fabius",
      subjectKind: "office_seat", subjectId: "some-other-office", linkedWorkflowId: "appoint_to_office",
      linkedWorkflowParams: { characterId: "quintus-fabius", officeId: "some-other-office" },
      eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "voting_or_deciding", resolutionMechanism: "vote",
      openedAtStep: 0, deadlineStep: null, resolvedAtStep: null, visibility: "polity", voteRecordId: null,
      outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [],
    });
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "quintus-fabius", parameters: { characterId: "quintus-fabius", officeId: "some-other-office", authorization: { procedureId: "unresolved-appointment" } } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses an authorization whose procedure names a different character", () => {
    const w = world();
    w.material.officeSeats = w.material.officeSeats.map((s) =>
      s.officeId === "roman-command" ? { ...s, status: "vacant" as const, vacancyCause: "resignation" as const, holderCharacterId: null } : s,
    );
    w.material.politicalProcedures.push({
      id: "appoint-someone-else", type: "appointment", institutionId: "roman-senate", sponsorCharacterId: "quintus-fabius",
      subjectKind: "office_seat", subjectId: "roman-command", linkedWorkflowId: "appoint_to_office",
      linkedWorkflowParams: { characterId: "hamilcar", officeId: "roman-command" },
      eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote",
      openedAtStep: 0, deadlineStep: null, resolvedAtStep: 1, visibility: "polity", voteRecordId: null,
      outcome: "passed", outcomeReason: "The Senate elected Hamilcar, not Quintus.", sourceEventIds: [], resultingEventIds: [],
    });
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "quintus-fabius", parameters: { characterId: "quintus-fabius", officeId: "roman-command", authorization: { procedureId: "appoint-someone-else" } } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses an authorization whose procedure links a different workflow entirely", () => {
    const w = world();
    w.material.politicalProcedures.push({
      id: "unrelated-procedure", type: "decree", institutionId: "roman-senate", sponsorCharacterId: "quintus-fabius",
      subjectKind: "polity", subjectId: "rome", linkedWorkflowId: "add_gold",
      linkedWorkflowParams: { accountId: "marcus-purse", amount: 100, reason: "grant", provenance: { kind: "scenario_setup" } },
      eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "sponsor_discretion",
      openedAtStep: 0, deadlineStep: null, resolvedAtStep: 1, visibility: "polity", voteRecordId: null,
      outcome: "passed", outcomeReason: "Approved.", sourceEventIds: [], resultingEventIds: [],
    });
    const outcome = executeWorkflow(
      { actionId: "appoint_to_office", actorId: "quintus-fabius", parameters: { characterId: "quintus-fabius", officeId: "some-other-office", authorization: { procedureId: "unrelated-procedure" } } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("remove_from_office — restricted shortcut", () => {
  it("succeeds even without an authorization referencing a resolved, passed procedure", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "remove_from_office", actorId: "quintus-fabius", parameters: { characterId: "marcus-atilius", reason: "Censure." } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.characters.find((c) => c.id === "marcus-atilius")?.officeId).toBeNull();
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

  it("refuses an authorization naming an unresolved procedure, even for the right character", () => {
    const w = world();
    // senate-censure-marcus is seeded still "gathering_support", not resolved.
    const outcome = executeWorkflow(
      { actionId: "remove_from_office", actorId: "quintus-fabius", parameters: { characterId: "marcus-atilius", reason: "Censure.", authorization: { procedureId: "senate-censure-marcus" } } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("refuses an authorization whose procedure names a different character", () => {
    const w = world();
    w.material.politicalProcedures = w.material.politicalProcedures.map((p) =>
      p.id === "senate-censure-marcus"
        ? { ...p, stage: "resolved" as const, outcome: "passed" as const, resolvedAtStep: 1, linkedWorkflowParams: { characterId: "hamilcar", reason: "Wrong target." } }
        : p,
    );
    const outcome = executeWorkflow(
      { actionId: "remove_from_office", actorId: "quintus-fabius", parameters: { characterId: "marcus-atilius", reason: "Censure.", authorization: { procedureId: "senate-censure-marcus" } } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });
});
