import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("sponsor_procedure", () => {
  it("opens a new procedure sponsored by an eligible character", () => {
    const w = world();
    const outcome = executeWorkflow(
      {
        actionId: "sponsor_procedure",
        actorId: "quintus-fabius",
        parameters: {
          procedureId: "new-petition",
          type: "petition",
          institutionId: null,
          sponsorCharacterId: "quintus-fabius",
          subjectKind: "polity",
          subjectId: "rome",
          linkedWorkflowId: "add_gold",
          resolutionMechanism: "sponsor_discretion",
          visibility: "polity",
        },
      },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.politicalProcedures.some((p) => p.id === "new-petition" && p.stage === "proposed")).toBe(true);
  });

  it("refuses a duplicate procedure id", () => {
    const w = world();
    const outcome = executeWorkflow(
      {
        actionId: "sponsor_procedure",
        actorId: "quintus-fabius",
        parameters: {
          procedureId: "senate-censure-marcus",
          type: "petition",
          institutionId: null,
          sponsorCharacterId: "quintus-fabius",
          subjectKind: "polity",
          subjectId: "rome",
          linkedWorkflowId: "add_gold",
          resolutionMechanism: "sponsor_discretion",
          visibility: "polity",
        },
      },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("pledge_support / withdraw_support", () => {
  it("records a resolver-computed position for an eligible participant", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "pledge_support", actorId: "marcus-atilius", parameters: { procedureId: "senate-censure-marcus", supporterKind: "character", supporterId: "marcus-atilius" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.supportPositions.some((p) => p.procedureId === "senate-censure-marcus" && p.supporterId === "marcus-atilius")).toBe(true);
  });

  it("refuses a supporter who is not an eligible participant of the procedure", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "pledge_support", actorId: "hamilcar", parameters: { procedureId: "senate-censure-marcus", supporterKind: "character", supporterId: "hamilcar" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("withdraws a previously recorded position before resolution", () => {
    const w = world();
    const pledged = executeWorkflow(
      { actionId: "pledge_support", actorId: "marcus-atilius", parameters: { procedureId: "senate-censure-marcus", supporterKind: "character", supporterId: "marcus-atilius" } },
      w,
      1,
    );
    expect(pledged.ok).toBe(true);
    if (!pledged.ok) return;
    const withdrawn = executeWorkflow(
      { actionId: "withdraw_support", actorId: "marcus-atilius", parameters: { procedureId: "senate-censure-marcus", supporterKind: "character", supporterId: "marcus-atilius" } },
      pledged.world,
      2,
    );
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    const latest = withdrawn.world.material.supportPositions
      .filter((p) => p.procedureId === "senate-censure-marcus" && p.supporterId === "marcus-atilius")
      .sort((a, b) => b.changedAtStep - a.changedAtStep)[0];
    expect(latest?.position).toBe("undecided");
  });
});

describe("call_vote", () => {
  it("moves an eligible procedure to voting_or_deciding when the sponsor calls it", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "call_vote", actorId: "hanno", parameters: { procedureId: "carthage-command-handover", callerCharacterId: "hanno" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.politicalProcedures.find((p) => p.id === "carthage-command-handover")?.stage).toBe("voting_or_deciding");
  });

  it("refuses a caller who is not the procedure's sponsor", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "call_vote", actorId: "hamilcar", parameters: { procedureId: "carthage-command-handover", callerCharacterId: "hamilcar" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("assign_command — restricted shortcut", () => {
  it("fails without an authorization referencing a resolved, passed procedure", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "assign_command", actorId: "hanno", parameters: { forceId: "carthaginian-army", commanderCharacterId: "hamilcar" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });

  it("succeeds when authorized by a resolved, passed command_assignment procedure", () => {
    const w = world();
    w.material.politicalProcedures = w.material.politicalProcedures.map((p) =>
      p.id === "carthage-command-handover"
        ? { ...p, stage: "resolved" as const, outcome: "passed" as const, resolvedAtStep: 1, outcomeReason: "Hanno's authority carried it." }
        : p,
    );
    const outcome = executeWorkflow(
      {
        actionId: "assign_command",
        actorId: "hanno",
        parameters: { forceId: "carthaginian-army", commanderCharacterId: "hamilcar", authorization: { procedureId: "carthage-command-handover" } },
      },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.forces.find((f) => f.id === "carthaginian-army")?.commanderCharacterId).toBe("hamilcar");
  });

  it("succeeds with system authority even without a procedure (narrow admin/test path)", () => {
    const w = world();
    const outcome = executeWorkflow(
      { actionId: "assign_command", actorId: "system", parameters: { forceId: "carthaginian-army", commanderCharacterId: "hamilcar" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(true);
  });
});

describe("assign_command — a magistrate's own authority", () => {
  // A consul who cannot put a commander at the head of his republic's legions
  // without first carrying a motion is not a consul. The procedure route
  // resolves a turn later, which made the most ordinary act of the office
  // impossible to perform at all.
  it("lets a seated magistrate command his own polity's force with no procedure", () => {
    const w = world();
    const consul = w.characters.find((c) => c.id === "marcus-atilius");
    const romanForce = w.material.forces.find((f) => f.polityId === consul?.polityId);
    expect(consul).toBeDefined();
    expect(romanForce).toBeDefined();
    expect(w.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === "marcus-atilius")).toBe(true);

    const outcome = executeWorkflow(
      { actionId: "assign_command", actorId: "marcus-atilius", parameters: { forceId: romanForce!.id, commanderCharacterId: "marcus-atilius" } },
      w,
      1,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.material.forces.find((f) => f.id === romanForce!.id)?.commanderCharacterId).toBe("marcus-atilius");
  });

  it("still refuses someone holding no office in the force's polity", () => {
    const w = world();
    const romanForce = w.material.forces.find((f) => f.polityId === "rome");
    const outcome = executeWorkflow(
      { actionId: "assign_command", actorId: "hanno", parameters: { forceId: romanForce!.id, commanderCharacterId: "hanno" } },
      w,
      1,
    );
    expect(outcome.ok).toBe(false);
  });
});
