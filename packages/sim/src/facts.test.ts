import { describe, expect, it } from "vitest";
import { materializeFacts } from "./facts";
import { createIdFactory } from "./ports";

describe("an engine-made fact whose summary runs past the record's cap", () => {
  it("is cut to fit rather than failing the burst", () => {
    const long = `${"The fleet arrived. ".repeat(50)}End.`;
    expect(long.length).toBeGreaterThan(600);
    const { facts } = materializeFacts({
      proposals: [{
        localId: "long", kind: "project_completed", summary: long, affectedRefs: [], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 20,
      }],
      now: { day: 3, minute: 0 }, atStep: 3, ids: createIdFactory("cap"), causalDepth: 0, assignedIds: new Map(),
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.summary.length).toBeLessThanOrEqual(600);
    expect(facts[0]!.summary.endsWith("…")).toBe(true);
    expect(facts[0]!.summary.startsWith("The fleet arrived.")).toBe(true);
  });
});
