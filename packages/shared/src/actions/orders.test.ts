import { describe, expect, it } from "vitest";
import { OrderAssessmentSchema } from "./orders";

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
