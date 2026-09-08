import { describe, expect, it } from "vitest";
import { estimateWorkflowDurationDays, WORKFLOW_REGISTRY } from "./registry";

describe("estimateWorkflowDurationDays (docs/32, Phase 5)", () => {
  it("prefers a workflow's own declared duration over the legacy fallback table", () => {
    const moveForce = WORKFLOW_REGISTRY.get("move_force");
    expect(moveForce?.duration).toBeDefined();
    expect(estimateWorkflowDurationDays(["move_force"])).toBe(moveForce!.duration!.likelyDays);
  });

  it("falls back to a sensible default for a workflow with no declared duration and no legacy entry", () => {
    expect(estimateWorkflowDurationDays(["some_action_nobody_declared"])).toBe(7);
  });

  it("takes the maximum across several named actions, since one order can require several", () => {
    expect(estimateWorkflowDurationDays(["add_gold", "start_siege"])).toBe(estimateWorkflowDurationDays(["start_siege"]));
  });

  it("never returns less than 1, even for an empty list", () => {
    expect(estimateWorkflowDurationDays([])).toBe(1);
  });
});
