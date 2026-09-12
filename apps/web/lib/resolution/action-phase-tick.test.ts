import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ActionPlanSchema, type ActionPlan, type WorldEventRecord, type WorldState } from "@chronica/shared";
import { resolveActionPhase } from "./action-phase-tick";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function event(overrides: Partial<Extract<WorldEventRecord["payload"], { kind: "action_phase" }>> = {}): WorldEventRecord {
  return {
    id: "evt-1", gameId: "game-1", scheduledForTurnId: null, kind: "action_phase", status: "pending",
    instant: { day: 1, minute: 0 }, priority: 0, isPlayerAction: false, subjectRef: { kind: "character", id: "hanno" },
    actionId: null, operationId: null,
    payload: { kind: "action_phase", actionId: "move_character", ...overrides },
    causalDepth: 0, causedByEventId: null, causedByFactId: null, createdAtStep: 1, resolvedAtStep: null, resolvedFactIds: [],
  };
}

function planWithInProgressStage(stageId: string, actionId: string): ActionPlan {
  return ActionPlanSchema.parse({
    id: "plan-1",
    origin: { kind: "player", sourceId: "hanno", directiveId: "d1" },
    ownerCharacterId: "hanno",
    rawText: "Move to the northeast.",
    revisions: [{ atStep: 1, text: "Move to the northeast." }],
    options: {},
    interpretation: "Move to the northeast.",
    status: "active",
    stages: [{
      id: stageId, objective: "Travel", actorId: "hanno", status: "in_progress",
      action: { kind: "built_in", actionId, parameters: {} },
      startedAtStep: 1, durationEstimate: { minimumSteps: 1, likelySteps: 3, maximumSteps: 5, basis: ["test"] }, expectedCompletionStep: 4,
    }],
    assignments: [],
    spent: 0,
    createdAtStep: 1,
    updatedAtStep: 1,
  });
}

describe("resolveActionPhase -- closing out a scheduled plan stage (unified action runtime, Stage 3)", () => {
  it("completes the originating plan's stage when the scheduled action succeeds", async () => {
    const w = { ...world(), plans: [planWithInProgressStage("travel", "move_character")] };
    const result = await resolveActionPhase(
      w,
      event({ actorId: "hanno", stageId: "travel", parameters: { characterId: "hanno", destinationProvinceId: "ita-72843720b81376294924159-sicily-northeast" } }),
      4,
    );
    const stage = result.world.plans?.[0]?.stages.find((s) => s.id === "travel");
    expect(stage?.status).toBe("completed");
    expect(stage?.completedAtStep).toBe(4);
    expect(stage?.resultFactIds).toEqual(["evt-1-0"]);
    expect(result.world.plans?.[0]?.status).toBe("completed");
  });

  it("fails the originating plan's stage, with the refusal reason, when the scheduled action no longer applies", async () => {
    const w = { ...world(), plans: [planWithInProgressStage("travel", "move_character")] };
    const result = await resolveActionPhase(
      w,
      event({ actorId: "hanno", stageId: "travel", parameters: { characterId: "hanno", destinationProvinceId: "no-such-province" } }),
      4,
    );
    const stage = result.world.plans?.[0]?.stages.find((s) => s.id === "travel");
    expect(stage?.status).toBe("failed");
    expect(stage?.statusReason).toMatch(/no-such-province|province/i);
  });

  it("still applies the action, but leaves plans untouched, when no plan/stage matches the payload's stageId", async () => {
    const w = { ...world(), plans: [] as ActionPlan[] };
    const result = await resolveActionPhase(
      w,
      event({ actorId: "hanno", stageId: "no-such-stage", parameters: { characterId: "hanno", destinationProvinceId: "ita-72843720b81376294924159-sicily-northeast" } }),
      4,
    );
    expect(result.world.characters.find((c) => c.id === "hanno")?.locationProvinceId).toBe("ita-72843720b81376294924159-sicily-northeast");
    expect(result.world.plans).toEqual([]);
  });
});

describe("resolveActionPhase (docs/32 corrective pass, requirement 3)", () => {
  it("does nothing for a bare {actionId, stageId} payload with no actorId", async () => {
    const w = world();
    const result = await resolveActionPhase(w, event(), 1);
    expect(result.world).toBe(w);
    expect(result.events).toEqual([]);
  });

  it("applies a scheduled reaction's action to the world when it resolves", async () => {
    const w = world();
    const result = await resolveActionPhase(
      w,
      event({ actorId: "hanno", parameters: { characterId: "hanno", destinationProvinceId: "ita-72843720b81376294924159-sicily-northeast" } }),
      1,
    );
    const hanno = result.world.characters.find((c) => c.id === "hanno");
    expect(hanno?.locationProvinceId).toBe("ita-72843720b81376294924159-sicily-northeast");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.materialConsequence).toBe(true);
  });

  it("reports a capability gap, without touching the world, when the scheduled action no longer applies", async () => {
    const w = world();
    const result = await resolveActionPhase(
      w,
      event({ actorId: "hanno", parameters: { characterId: "hanno", destinationProvinceId: "no-such-province" } }),
      1,
    );
    expect(result.world).toBe(w);
    expect(result.events[0]?.kind).toBe("capability_gap");
    expect(result.events[0]?.materialConsequence).toBe(false);
  });
});
