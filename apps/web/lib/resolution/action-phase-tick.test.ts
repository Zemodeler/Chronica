import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldEventRecord, WorldState } from "@chronica/shared";
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
