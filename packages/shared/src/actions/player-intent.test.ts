import { describe, expect, it } from "vitest";
import { PlayerIntentInterpretationSchema } from "./player-intent";

describe("PlayerIntentInterpretationSchema (docs/32, Part B.3)", () => {
  it("accepts a resolved directive with a concrete proposal", () => {
    const result = PlayerIntentInterpretationSchema.safeParse({
      directiveId: "d1",
      kind: "issuing_order",
      concreteProposal: {
        issuerRef: { kind: "character", id: "marcus-atilius" },
        targetRefs: [{ kind: "force", id: "legio-i" }],
        resourceRefs: [],
        proposedWorkflowId: "assign_command",
        proposedParameters: { commanderCharacterId: "marcus-atilius" },
        desiredOutcome: "Put Marcus in command of the legion.",
      },
      explicitConstraints: [],
      needsClarification: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects needsClarification=true without a clarificationQuestion", () => {
    const result = PlayerIntentInterpretationSchema.safeParse({
      directiveId: "d1",
      kind: "issuing_order",
      explicitConstraints: [],
      needsClarification: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a resolved directive with no concreteProposal", () => {
    const result = PlayerIntentInterpretationSchema.safeParse({
      directiveId: "d1",
      kind: "acting_personally",
      explicitConstraints: [],
      needsClarification: false,
    });
    expect(result.success).toBe(false);
  });

  it("accepts an unresolved directive carrying only a clarification question", () => {
    const result = PlayerIntentInterpretationSchema.safeParse({
      directiveId: "d1",
      kind: "issuing_order",
      explicitConstraints: ["but only if the Senate approves"],
      needsClarification: true,
      clarificationQuestion: "Which force should receive this order?",
    });
    expect(result.success).toBe(true);
  });
});
