import { describe, expect, it } from "vitest";
import { nextDueEvent, type WorldEventRecord } from "./event-queue";

function event(overrides: Partial<WorldEventRecord> & Pick<WorldEventRecord, "instant">): WorldEventRecord {
  return {
    id: `evt-${Math.random()}`,
    gameId: "game-1",
    scheduledForTurnId: null,
    kind: "midnight_tick",
    status: "pending",
    priority: 0,
    isPlayerAction: false,
    subjectRef: { kind: "world", id: "world" },
    actionId: null,
    operationId: null,
    payload: { kind: "midnight_tick" },
    causalDepth: 0,
    causedByEventId: null,
    causedByFactId: null,
    createdAtStep: 0,
    resolvedAtStep: null,
    resolvedFactIds: [],
    ...overrides,
  };
}

describe("nextDueEvent (docs/32, Phase 7)", () => {
  it("selects the earliest-instant pending event within the window", () => {
    const earlier = event({ instant: { day: 5, minute: 11 * 60 } });
    const later = event({ instant: { day: 5, minute: 12 * 60 } });
    expect(nextDueEvent([later, earlier], { day: 5, minute: 12 * 60 })).toBe(earlier);
  });

  it("resolves an 11:00 world event before a noon player order at the same simulated day", () => {
    const worldEvent = event({ instant: { day: 5, minute: 11 * 60 }, isPlayerAction: false });
    const playerOrder = event({ instant: { day: 5, minute: 12 * 60 }, isPlayerAction: true });
    expect(nextDueEvent([playerOrder, worldEvent], { day: 5, minute: 12 * 60 })).toBe(worldEvent);
  });

  it("breaks a tie at the same instant in favor of the player-ready action", () => {
    const npcEvent = event({ instant: { day: 5, minute: 12 * 60 }, isPlayerAction: false });
    const playerOrder = event({ instant: { day: 5, minute: 12 * 60 }, isPlayerAction: true });
    expect(nextDueEvent([npcEvent, playerOrder], { day: 5, minute: 12 * 60 })).toBe(playerOrder);
  });

  it("breaks a same-instant, same-player-flag tie by higher priority", () => {
    const low = event({ instant: { day: 5, minute: 60 }, priority: 0 });
    const high = event({ instant: { day: 5, minute: 60 }, priority: 5 });
    expect(nextDueEvent([low, high], { day: 5, minute: 60 })).toBe(high);
  });

  it("ignores events beyond the window end", () => {
    const tooLate = event({ instant: { day: 6, minute: 0 } });
    expect(nextDueEvent([tooLate], { day: 5, minute: 0 })).toBeNull();
  });

  it("ignores non-pending events", () => {
    const resolved = event({ instant: { day: 5, minute: 0 }, status: "resolved" });
    expect(nextDueEvent([resolved], { day: 5, minute: 0 })).toBeNull();
  });

  it("returns null for an empty batch", () => {
    expect(nextDueEvent([], { day: 0, minute: 0 })).toBeNull();
  });
});
