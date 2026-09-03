import { describe, expect, it } from "vitest";
import { CharacterIntentSchema } from "./intents";

describe("CharacterIntentSchema", () => {
  it("accepts a minimal valid intent and fills in defaults", () => {
    const parsed = CharacterIntentSchema.parse({
      id: "intent-1", actorCharacterId: "marcus-atilius", actionType: "wait",
      targetIds: [], rationale: "Nothing worth acting on yet.", prerequisites: [],
      intendedWorkflowIds: [], priority: 0, status: "proposed", createdAtStep: 3, visibility: "private",
    });
    expect(parsed.sourceGoalId).toBeNull();
    expect(parsed.sourcePlotId).toBeNull();
    expect(parsed.sourceCommitmentId).toBeNull();
    expect(parsed.sourceEventIds).toEqual([]);
    expect(parsed.resolutionReason).toBeNull();
  });

  it("rejects an unknown action type", () => {
    const result = CharacterIntentSchema.safeParse({
      id: "intent-1", actorCharacterId: "marcus-atilius", actionType: "invent_an_army",
      targetIds: [], rationale: "", prerequisites: [], intendedWorkflowIds: [],
      priority: 0, status: "proposed", createdAtStep: 3, visibility: "private",
    });
    expect(result.success).toBe(false);
  });
});
