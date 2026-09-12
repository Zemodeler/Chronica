import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { AffectedAgentSelection, InterventionDecision, WorldEventRecord, WorldState } from "@chronica/shared";
import { advanceEventQueueWithPort, ensureMidnightTickSeeded, type AffectedAgentRunner, type EventQueuePort } from "./event-loop";
import type { NewWorldEvent } from "@chronica/db";

/** In-memory fake of `EventQueuePort` -- lets the loop's ordering/dispatch/reaction-cap logic run with no live database. */
function fakePort(seed: readonly WorldEventRecord[]): EventQueuePort & { readonly events: WorldEventRecord[] } {
  const events: WorldEventRecord[] = seed.map((e) => ({ ...e }));
  let nextId = events.length;
  return {
    events,
    listDuePendingEvents(atOrBefore) {
      const key = atOrBefore.day * 1440 + atOrBefore.minute;
      return Promise.resolve(events.filter((e) => e.status === "pending" && e.instant.day * 1440 + e.instant.minute <= key));
    },
    claimEvent(id) {
      const event = events.find((e) => e.id === id);
      if (event === undefined || event.status !== "pending") return Promise.resolve(false);
      event.status = "claimed";
      return Promise.resolve(true);
    },
    insertEvents(newEvents: readonly NewWorldEvent[]) {
      for (const input of newEvents) {
        events.push({
          id: `evt-${nextId++}`,
          gameId: "game-1",
          scheduledForTurnId: null,
          kind: input.kind,
          status: "pending",
          instant: input.instant,
          priority: input.priority ?? 0,
          isPlayerAction: input.isPlayerAction ?? false,
          subjectRef: input.subjectRef,
          actionId: input.actionId ?? null,
          operationId: input.operationId ?? null,
          payload: input.payload,
          causalDepth: input.causalDepth ?? 0,
          causedByEventId: input.causedByEventId ?? null,
          causedByFactId: input.causedByFactId ?? null,
          createdAtStep: input.createdAtStep,
          resolvedAtStep: null,
          resolvedFactIds: [],
        });
      }
      return Promise.resolve();
    },
  };
}

function baseEvent(overrides: Partial<WorldEventRecord> & Pick<WorldEventRecord, "instant" | "id">): WorldEventRecord {
  return {
    gameId: "game-1",
    scheduledForTurnId: null,
    kind: "action_phase",
    status: "pending",
    priority: 0,
    isPlayerAction: false,
    subjectRef: { kind: "character", id: "char-1" },
    actionId: null,
    operationId: null,
    payload: { kind: "action_phase", actionId: "act-1" },
    causalDepth: 0,
    causedByEventId: null,
    causedByFactId: null,
    createdAtStep: 0,
    resolvedAtStep: null,
    resolvedFactIds: [],
    ...overrides,
  };
}

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

describe("advanceEventQueueWithPort (docs/32, Phase 7)", () => {
  it("resolves an 11:00 world event before a noon player order at the same simulated day", async () => {
    const worldEvent = baseEvent({ id: "world-evt", instant: { day: 5, minute: 11 * 60 }, isPlayerAction: false });
    const playerOrder = baseEvent({ id: "player-evt", instant: { day: 5, minute: 12 * 60 }, isPlayerAction: true });
    const port = fakePort([playerOrder, worldEvent]);

    const order: string[] = [];
    const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 5, minute: 12 * 60 }, 1, {
      handlers: { action_phase: (w, event) => { order.push(event.id); return { world: w, events: [] }; } },
    });

    expect(order).toEqual(["world-evt", "player-evt"]);
    expect(result.resolvedEventIds).toEqual(["world-evt", "player-evt"]);
    expect(result.stopReason).toBe("window_end");
  });

  it("stops without resolving anything past the window end", async () => {
    const tooLate = baseEvent({ id: "later", instant: { day: 6, minute: 0 } });
    const port = fakePort([tooLate]);
    const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 5, minute: 0 }, 1, {});
    expect(result.resolvedEventIds).toEqual([]);
    expect(result.stopReason).toBe("window_end");
  });

  it("caps a chain of reactions at 3 causal layers, reopening a fresh chain at least a day later", async () => {
    const root = baseEvent({ id: "root", instant: { day: 1, minute: 0 }, causalDepth: 3 });
    const port = fakePort([root]);
    const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 0 }, 1, {
      handlers: {
        action_phase: (w) => ({
          world: w,
          events: [],
          followUpEvents: [{ kind: "action_phase", instant: { day: 1, minute: 5 }, subjectRef: { kind: "character", id: "char-1" }, payload: { kind: "action_phase", actionId: "act-2" }, createdAtStep: 1 }],
        }),
      },
    });
    expect(result.resolvedEventIds).toEqual(["root"]);
    // docs/32 corrective pass, requirement 4: the follow-up is staged for the
    // caller's own commit transaction, never written by the loop itself.
    const [scheduled] = result.pendingEventInserts;
    expect(scheduled?.causalDepth).toBe(0);
    expect(scheduled?.instant.day).toBeGreaterThan(1);
  });

  it("continues a reaction chain normally under the causal-depth cap", async () => {
    const root = baseEvent({ id: "root", instant: { day: 1, minute: 0 }, causalDepth: 1 });
    const port = fakePort([root]);
    const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 0 }, 1, {
      handlers: {
        action_phase: (w) => ({
          world: w,
          events: [],
          followUpEvents: [{ kind: "action_phase", instant: { day: 1, minute: 5 }, subjectRef: { kind: "character", id: "char-1" }, payload: { kind: "action_phase", actionId: "act-2" }, createdAtStep: 1 }],
        }),
      },
    });
    const [scheduled] = result.pendingEventInserts;
    expect(scheduled?.causalDepth).toBe(2);
    expect(scheduled?.instant).toEqual({ day: 1, minute: 5 });
  });

  it("self-schedules the next day's midnight_tick on resolving one", async () => {
    const tick = baseEvent({ id: "tick-1", instant: { day: 1, minute: 0 }, kind: "midnight_tick", payload: { kind: "midnight_tick" } });
    const port = fakePort([tick]);
    const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 0 }, 1, {});
    const nextTick = result.pendingEventInserts.find((e) => e.kind === "midnight_tick");
    expect(nextTick?.instant).toEqual({ day: 2, minute: 0 });
  });

  it("stages this run's resolutions and follow-ups without writing them, then persists correctly once the caller applies them (docs/32 corrective pass, requirement 4)", async () => {
    const root = baseEvent({ id: "root", instant: { day: 1, minute: 0 } });
    const port = fakePort([root]);
    const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 0 }, 1, {
      handlers: { action_phase: (w) => ({ world: w, events: [{ atStep: 1, kind: "action", actionId: "act-1", actorId: "char-1", parameters: {}, summary: "Something happened.", materialConsequence: true }] }) },
    });
    expect(result.resolvedEventIds).toEqual(["root"]);
    // Nothing was written by the loop itself -- the fake port's own store still shows "root" merely claimed.
    expect(port.events.find((e) => e.id === "root")?.status).toBe("claimed");
    expect(result.pendingResolutions).toEqual([{ id: "root", atStep: 1, factIds: [result.facts[0]!.id] }]);
  });

  it("ensureMidnightTickSeeded seeds a tick for a game with no queue rows yet, idempotently", async () => {
    const port = fakePort([]);
    await ensureMidnightTickSeeded(port, "game-1", 3, 1);
    expect(port.events.filter((e) => e.kind === "midnight_tick")).toHaveLength(1);
    await ensureMidnightTickSeeded(port, "game-1", 3, 1);
    expect(port.events.filter((e) => e.kind === "midnight_tick")).toHaveLength(1);
  });

  it("stops at a decision point when a handler requires player input", async () => {
    const first = baseEvent({ id: "first", instant: { day: 1, minute: 0 } });
    const second = baseEvent({ id: "second", instant: { day: 1, minute: 10 } });
    const port = fakePort([first, second]);
    const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 30 }, 1, {
      handlers: { action_phase: (w, event) => ({ world: w, events: [], requiresPlayerDecision: event.id === "first" }) },
    });
    expect(result.resolvedEventIds).toEqual(["first"]);
    expect(result.stopReason).toBe("decision_point");
  });

  describe("elastic continuation (unified action runtime, Stage 5)", () => {
    it("resolves a same-call follow-up once it becomes due within this call's own window, instead of only a future call noticing it", async () => {
      const root = baseEvent({ id: "root", instant: { day: 1, minute: 0 } });
      const port = fakePort([root]);
      const resolvedIds: string[] = [];
      const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 10 }, 1, {
        handlers: {
          action_phase: (w, event) => {
            resolvedIds.push(event.id);
            if (event.id !== "root") return { world: w, events: [] };
            return {
              world: w,
              events: [],
              followUpEvents: [{
                kind: "action_phase", instant: { day: 1, minute: 5 },
                subjectRef: { kind: "character", id: "char-1" }, payload: { kind: "action_phase", actionId: "act-2" }, createdAtStep: 1,
              }],
            };
          },
        },
      });
      expect(resolvedIds).toEqual(["root", expect.stringMatching(/^staged-/)]);
      expect(result.resolvedEventIds).toHaveLength(2);
      // Resolved within this same call -- nothing left to write as still-pending.
      expect(result.pendingEventInserts).toEqual([]);
      // The staged follow-up never touched the DB, so only the real,
      // DB-sourced "root" gets a resolution write.
      expect(result.pendingResolutions).toEqual([{ id: "root", atStep: 1, factIds: [] }]);
      expect(result.stopReason).toBe("window_end");
    });

    it("leaves a follow-up that never becomes due within this call's window exactly as before -- staged in-memory visibility changes nothing about it", async () => {
      const root = baseEvent({ id: "root", instant: { day: 1, minute: 0 } });
      const port = fakePort([root]);
      const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 0 }, 1, {
        handlers: {
          action_phase: (w) => ({
            world: w,
            events: [],
            followUpEvents: [{
              kind: "action_phase", instant: { day: 1, minute: 5 },
              subjectRef: { kind: "character", id: "char-1" }, payload: { kind: "action_phase", actionId: "act-2" }, createdAtStep: 1,
            }],
          }),
        },
      });
      expect(result.resolvedEventIds).toEqual(["root"]);
      const [scheduled] = result.pendingEventInserts;
      expect(scheduled?.instant).toEqual({ day: 1, minute: 5 });
    });

    it("stops at a decision point when checkIntervention reports requiresIntervention, mid-window rather than at handler/budget/window boundaries", async () => {
      const first = baseEvent({ id: "first", instant: { day: 1, minute: 0 } });
      const second = baseEvent({ id: "second", instant: { day: 1, minute: 10 } });
      const port = fakePort([first, second]);
      const stubDecision: InterventionDecision = {
        hardStopReason: "salient_event",
        requestedPlayerDecision: "Something demands your attention.",
        score: 100,
        breakdown: { irreversibility: 0, deviationFromPlan: 0, directPlayerInvolvement: 0, strategicConsequence: 0, uncertainty: 0 },
        requiresIntervention: true,
        contributingFactIds: ["fact-x"],
      };
      const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 30 }, 1, {
        handlers: { action_phase: (w) => ({ world: w, events: [] }) },
        checkIntervention: () => stubDecision,
      });
      expect(result.resolvedEventIds).toEqual(["first"]);
      expect(result.stopReason).toBe("decision_point");
      expect(result.interventionDecision).toEqual(stubDecision);
    });

    it("never calls checkIntervention when the caller omits it, running unconditionally to window end or budget as before", async () => {
      const first = baseEvent({ id: "first", instant: { day: 1, minute: 0 } });
      const second = baseEvent({ id: "second", instant: { day: 1, minute: 10 } });
      const port = fakePort([first, second]);
      const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 30 }, 1, {
        handlers: { action_phase: (w) => ({ world: w, events: [] }) },
      });
      expect(result.resolvedEventIds).toEqual(["first", "second"]);
      expect(result.stopReason).toBe("window_end");
      expect(result.interventionDecision).toBeUndefined();
    });
  });

  describe("agentRunner wiring (docs/32 corrective pass, requirement 3)", () => {
    it("calls the agent runner with the current world/facts/event whenever the selector picks someone, and folds its scheduled events through the normal causal-depth path", async () => {
      const root = baseEvent({ id: "root", instant: { day: 1, minute: 0 } });
      const port = fakePort([root]);
      const seenInputs: { atStep: number; eventId: string; factsCount: number }[] = [];
      const agentRunner: AffectedAgentRunner = {
        runReactions(input) {
          seenInputs.push({ atStep: input.atStep, eventId: input.event.id, factsCount: input.facts.length });
          return Promise.resolve({
            scheduledEvents: [{
              kind: "action_phase", instant: { day: 1, minute: 5 }, subjectRef: { kind: "character", id: "char-1" },
              payload: { kind: "action_phase", actionId: "move_character", actorId: "char-1", parameters: { characterId: "char-1", destinationProvinceId: "neighbor-a" } },
              createdAtStep: 1,
            }],
          });
        },
      };
      const selection: AffectedAgentSelection = { npcCharacterIds: ["char-1"], starContextRefs: [], withinBudget: true };

      const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 0 }, 1, {
        agentSelector: { selectAffectedAgents: () => selection },
        agentRunner,
        handlers: {
          action_phase: (w, event) => ({
            world: w,
            events: [{ atStep: 1, kind: "action", actionId: "act-1", actorId: "char-1", parameters: {}, summary: `${event.id} resolved.`, materialConsequence: true }],
          }),
        },
      });

      expect(seenInputs).toEqual([{ atStep: 1, eventId: "root", factsCount: 1 }]);
      // The reaction's scheduled event was folded through the SAME
      // causal-depth-capped follow-up path a handler's own followUpEvents
      // use -- never applied directly, never lost.
      expect(result.pendingEventInserts).toHaveLength(1);
      expect(result.pendingEventInserts[0]?.causalDepth).toBe(1);
      expect(result.pendingEventInserts[0]?.payload).toMatchObject({ actionId: "move_character", actorId: "char-1" });
    });

    it("never calls the agent runner when the selector picks no one", async () => {
      const root = baseEvent({ id: "root", instant: { day: 1, minute: 0 } });
      const port = fakePort([root]);
      let called = false;
      const agentRunner: AffectedAgentRunner = { runReactions() { called = true; return Promise.resolve({ scheduledEvents: [] }); } };

      await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 0 }, 1, {
        agentSelector: { selectAffectedAgents: () => ({ npcCharacterIds: [], starContextRefs: [], withinBudget: true }) },
        agentRunner,
      });

      expect(called).toBe(false);
    });

    it("a reaction's scheduled event past the causal-depth cap reopens a day later, exactly like a handler's own follow-up", async () => {
      const root = baseEvent({ id: "root", instant: { day: 1, minute: 0 }, causalDepth: 3 });
      const port = fakePort([root]);
      const agentRunner: AffectedAgentRunner = {
        runReactions() {
          return Promise.resolve({
            scheduledEvents: [{
              kind: "action_phase", instant: { day: 1, minute: 5 }, subjectRef: { kind: "character", id: "char-1" },
              payload: { kind: "action_phase", actionId: "move_character", actorId: "char-1", parameters: {} },
              createdAtStep: 1,
            }],
          });
        },
      };
      const result = await advanceEventQueueWithPort(port, "game-1", world(), { day: 1, minute: 0 }, 1, {
        agentSelector: { selectAffectedAgents: () => ({ npcCharacterIds: ["char-1"], starContextRefs: [], withinBudget: true }) },
        agentRunner,
      });
      expect(result.pendingEventInserts[0]?.causalDepth).toBe(0);
      expect(result.pendingEventInserts[0]?.instant.day).toBeGreaterThan(1);
    });
  });
});
