import { describe, expect, it } from "vitest";
import { OrderAssessmentSchema, OngoingActionSchema } from "./orders";

const assessmentBase = {
  directiveId: "directive-1",
  interpretation: "Move the legion and begin a siege.",
  feasibility: "conditional" as const,
  obstacleIds: [],
  dependencyActionIds: [],
  estimatedSteps: { min: 1, max: 2 },
  needsAdjudication: true,
};

describe("OrderAssessmentSchema", () => {
  it("accepts several workflow hints for a multi-step directive", () => {
    const result = OrderAssessmentSchema.parse({
      ...assessmentBase,
      workflows: [
        { actionId: "move_force", parameters: { forceId: "legio-i" } },
        { actionId: "start_siege", parameters: { settlementId: "drepanum-city" } },
      ],
    });

    expect(result.workflows.map((workflow) => workflow.actionId)).toEqual(["move_force", "start_siege"]);
    expect(result.workflow).toBeNull();
  });

  it("continues to accept the legacy single workflow hint", () => {
    const result = OrderAssessmentSchema.parse({
      ...assessmentBase,
      workflow: { actionId: "move_force", parameters: { forceId: "legio-i" } },
    });

    expect(result.workflows).toEqual([]);
    expect(result.workflow?.actionId).toBe("move_force");
  });
});

const ongoingActionBase = {
  id: "action-1",
  actorId: "marcus-atilius",
  sourceIntentId: "directive-1",
  revision: 1,
  revisions: [{
    revision: 1,
    sourceIntentId: "directive-1",
    submittedTurnIndex: 0,
    directiveKind: "new" as const,
    rawText: "move force",
    priority: 0,
    assessment: null,
    preservesProgress: false,
  }],
  invocation: {
    actionId: "move_force",
    actorId: "marcus-atilius",
    parameters: { forceId: "legio-i" },
    source: "grammar" as const,
    sourceRef: "directive-1",
  },
  startedTurnIndex: 0,
  startedAtStep: 0,
  priority: 0,
  dependencyActionIds: [],
  progress: { stepsElapsed: 0, stepsExpected: null },
  continuationPolicy: "automatic" as const,
  status: "active" as const,
  waitingReason: null,
  terminalReason: null,
  replacedByActionId: null,
};

describe("OngoingActionSchema (docs/14, Phase 1)", () => {
  it("parses a pre-Phase-1 action with none of the universal-order fields", () => {
    const result = OngoingActionSchema.parse(ongoingActionBase);
    expect(result.issuerRef).toBeUndefined();
    expect(result.operationId).toBeUndefined();
  });

  it("accepts the full universal order shape: issuer, target, authority basis, and operation link", () => {
    const result = OngoingActionSchema.parse({
      ...ongoingActionBase,
      issuerRef: { kind: "character", id: "marcus-atilius" },
      targetRefs: [{ kind: "province", id: "sicily-northeast" }],
      desiredOutcome: "move force to capua",
      posture: "avoid battle unless attacked",
      authorityBasis: { claimedType: "command_or_office", validated: false, basis: "No recognised command over Legio X." },
      requiredProcedureId: "senate-vote-1",
      resourceRefs: [{ forceId: "legio-i" }],
      operationId: "op-1",
      updatedAtStep: 3,
      chronicleChainId: "chain-1",
    });
    expect(result.issuerRef).toEqual({ kind: "character", id: "marcus-atilius" });
    expect(result.authorityBasis?.validated).toBe(false);
    expect(result.operationId).toBe("op-1");
  });

  it("rejects an unknown party-ref kind", () => {
    const result = OngoingActionSchema.safeParse({
      ...ongoingActionBase,
      issuerRef: { kind: "empire", id: "rome" },
    });
    expect(result.success).toBe(false);
  });
});
