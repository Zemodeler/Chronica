import { describe, expect, it } from "vitest";
import { PersistentOperationSchema, isTerminalOperationStatus } from "./operations";

const operationBase = {
  id: "op-1",
  originatingOrderId: "action-1",
  ownerRef: { kind: "character" as const, id: "marcus-atilius" },
  objective: "Take Messana",
  stage: "in_progress",
  startedAtStep: 0,
  updatedAtStep: 0,
  status: "active" as const,
};

describe("PersistentOperationSchema", () => {
  it("applies safe defaults for a freshly opened operation", () => {
    const result = PersistentOperationSchema.parse(operationBase);
    expect(result.standingInstructions).toBe("");
    expect(result.risks).toEqual([]);
    expect(result.relatedForceIds).toEqual([]);
    expect(result.statusReason).toBeNull();
  });

  it("requires a statusReason once the operation reaches a terminal status", () => {
    const result = PersistentOperationSchema.safeParse({
      ...operationBase,
      status: "failed",
      statusReason: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a terminal operation that states why it ended", () => {
    const result = PersistentOperationSchema.parse({
      ...operationBase,
      status: "completed",
      statusReason: "Messana capitulated after the assault.",
    });
    expect(result.status).toBe("completed");
  });
});

describe("isTerminalOperationStatus", () => {
  it("treats active and paused as non-terminal", () => {
    expect(isTerminalOperationStatus("active")).toBe(false);
    expect(isTerminalOperationStatus("paused")).toBe(false);
  });

  it("treats completed, failed, cancelled, and superseded as terminal", () => {
    expect(isTerminalOperationStatus("completed")).toBe(true);
    expect(isTerminalOperationStatus("failed")).toBe(true);
    expect(isTerminalOperationStatus("cancelled")).toBe(true);
    expect(isTerminalOperationStatus("superseded")).toBe(true);
  });
});
