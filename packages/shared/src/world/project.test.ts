import { describe, expect, it } from "vitest";
import { WORKFLOW_REGISTRY } from "../workflows/registry";
import { ProjectSchema, completeMilestone, nextDueMilestone, type Project } from "./project";

const [firstRegisteredWorkflowId] = [...WORKFLOW_REGISTRY.keys()];

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    kind: "academy",
    sponsorEntityRef: { kind: "polity", id: "rome" },
    label: "Found a war academy",
    status: "in_progress",
    reservationId: "r1",
    milestones: [
      { id: "m1", label: "Break ground", requiredAtElapsedOffset: 0, costAmount: 100, status: "pending", linkedWorkflowId: null, linkedWorkflowParams: {}, completedAtStep: null },
      { id: "m2", label: "Graduate first cohort", requiredAtElapsedOffset: 10, costAmount: 200, status: "pending", linkedWorkflowId: null, linkedWorkflowParams: {}, completedAtStep: null },
    ],
    completionWorkflowId: null,
    completionWorkflowParams: {},
    linkedEntityIds: [],
    startedAtStep: 1,
    targetCompletionStep: null,
    completedAtStep: null,
    provenanceEventIds: [],
    ...overrides,
  };
}

describe("ProjectSchema (docs/32, Part C.2)", () => {
  it("accepts a project whose linked workflow ids are registered", () => {
    const result = ProjectSchema.safeParse(project({ milestones: [{ id: "m1", label: "x", requiredAtElapsedOffset: 0, costAmount: 1, status: "pending", linkedWorkflowId: firstRegisteredWorkflowId ?? null, linkedWorkflowParams: {}, completedAtStep: null }] }));
    expect(result.success).toBe(true);
  });

  it("rejects a milestone naming an unregistered workflow", () => {
    const result = ProjectSchema.safeParse(project({ milestones: [{ id: "m1", label: "x", requiredAtElapsedOffset: 0, costAmount: 1, status: "pending", linkedWorkflowId: "not_a_real_workflow", linkedWorkflowParams: {}, completedAtStep: null }] }));
    expect(result.success).toBe(false);
  });

  it("rejects a completionWorkflowId that is not registered", () => {
    const result = ProjectSchema.safeParse(project({ completionWorkflowId: "not_a_real_workflow" }));
    expect(result.success).toBe(false);
  });
});

describe("nextDueMilestone", () => {
  it("returns the earliest pending milestone due by atStep", () => {
    expect(nextDueMilestone(project(), 1)?.id).toBe("m1");
    expect(nextDueMilestone(project(), 5)?.id).toBe("m1");
  });

  it("returns undefined when nothing pending is due yet", () => {
    const afterFirst = completeMilestone(project(), "m1", 1);
    expect(nextDueMilestone(afterFirst, 5)).toBeUndefined();
    expect(nextDueMilestone(afterFirst, 11)?.id).toBe("m2");
  });
});

describe("completeMilestone", () => {
  it("keeps the project in_progress after an earlier milestone completes", () => {
    const after = completeMilestone(project(), "m1", 2);
    expect(after.status).toBe("in_progress");
    expect(after.completedAtStep).toBeNull();
  });

  it("completes the project once its last milestone completes", () => {
    const afterFirst = completeMilestone(project(), "m1", 2);
    const afterSecond = completeMilestone(afterFirst, "m2", 12);
    expect(afterSecond.status).toBe("completed");
    expect(afterSecond.completedAtStep).toBe(12);
  });
});
