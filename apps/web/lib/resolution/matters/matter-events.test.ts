import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { NewWorldEvent } from "@chronica/db";
import type { WorldEventRecord, WorldMatter, WorldState } from "@chronica/shared";
import { ensureMatterTicksSeeded } from "./matter-events";
import type { EventQueuePort } from "../event-loop";

const INSTANT = { day: 1, minute: 0 };

function world(matters: readonly WorldMatter[]): WorldState {
  return { ...structuredClone(firstPunicWarScenario.initialWorld), worldMatters: [...matters] };
}

function matter(overrides: Partial<WorldMatter> = {}): WorldMatter {
  return {
    id: "obligation:legio-pay:period-1",
    kind: "obligation_due",
    sourceRef: { kind: "obligation", id: "legio-pay" },
    status: "due",
    visibility: "public",
    summary: "Legio I's pay is due.",
    urgency: 50,
    createdAt: INSTANT,
    dueAt: INSTANT,
    nextReviewAt: INSTANT,
    lastReviewedAt: null,
    requiredAuthority: [],
    responsibleScopeRefs: [],
    stakeholderRefs: [],
    relevantFactIds: [],
    standingPlanId: null,
    supersedesMatterId: null,
    parentMatterId: null,
    offers: [],
    dispositions: [],
    resolutionFactIds: [],
    provinceId: null,
    intensity: 50,
    reviews: 1,
    pressureId: null,
    createdAtStep: 1,
    lastReviewedStep: 1,
    nextReviewStep: 1,
    ...overrides,
  };
}

function tickEvent(matterId: string): WorldEventRecord {
  return {
    id: "evt-existing", gameId: "game-1", scheduledForTurnId: null, kind: "world_process_tick", status: "pending",
    instant: INSTANT, priority: 0, isPlayerAction: false, subjectRef: { kind: "matter", id: matterId },
    actionId: null, operationId: null,
    payload: { kind: "world_process_tick", processKind: "matter", targetRef: { kind: "matter", id: matterId } },
    causalDepth: 0, causedByEventId: null, causedByFactId: null, createdAtStep: 1, resolvedAtStep: null, resolvedFactIds: [],
  };
}

function fakePort(seed: readonly WorldEventRecord[] = []): EventQueuePort & { readonly events: WorldEventRecord[] } {
  const events: WorldEventRecord[] = seed.map((e) => ({ ...e }));
  let nextId = events.length;
  return {
    events,
    async listDuePendingEvents(atOrBefore) {
      const key = atOrBefore.day * 1440 + atOrBefore.minute;
      return events.filter((e) => e.status === "pending" && e.instant.day * 1440 + e.instant.minute <= key);
    },
    async claimEvent() { return true; },
    async insertEvents(newEvents: readonly NewWorldEvent[]) {
      for (const input of newEvents) {
        events.push({
          id: `evt-${nextId++}`, gameId: "game-1", scheduledForTurnId: null, kind: input.kind, status: "pending",
          instant: input.instant, priority: input.priority ?? 0, isPlayerAction: input.isPlayerAction ?? false,
          subjectRef: input.subjectRef, actionId: input.actionId ?? null, operationId: input.operationId ?? null,
          payload: input.payload, causalDepth: input.causalDepth ?? 0, causedByEventId: input.causedByEventId ?? null,
          causedByFactId: input.causedByFactId ?? null, createdAtStep: input.createdAtStep, resolvedAtStep: null, resolvedFactIds: [],
        });
      }
    },
  };
}

describe("ensureMatterTicksSeeded (docs/plans/ai-world-matters-runtime.md, \"Chronological integration\")", () => {
  it("seeds a pending tick for a due matter with no event yet", async () => {
    const w = world([matter()]);
    const port = fakePort();
    await ensureMatterTicksSeeded(port, w, 1);
    expect(port.events.some((e) => e.kind === "world_process_tick" && e.subjectRef.kind === "matter" && e.subjectRef.id === "obligation:legio-pay:period-1")).toBe(true);
  });

  it("does not seed a duplicate when a pending tick already exists", async () => {
    const m = matter();
    const w = world([m]);
    const port = fakePort([tickEvent(m.id)]);
    await ensureMatterTicksSeeded(port, w, 1);
    expect(port.events.filter((e) => e.kind === "world_process_tick" && e.subjectRef.id === m.id)).toHaveLength(1);
  });

  it("seeds nothing for an upcoming matter that is not yet due", async () => {
    const w = world([matter({ status: "upcoming" })]);
    const port = fakePort();
    await ensureMatterTicksSeeded(port, w, 1);
    expect(port.events).toHaveLength(0);
  });

  it("seeds nothing for a terminal matter", async () => {
    const w = world([matter({ status: "addressed", resolutionFactIds: ["fact-1"] })]);
    const port = fakePort();
    await ensureMatterTicksSeeded(port, w, 1);
    expect(port.events).toHaveLength(0);
  });
});
