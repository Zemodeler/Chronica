import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { NewWorldEvent } from "@chronica/db";
import type { Project, WorldEventRecord, WorldState } from "@chronica/shared";
import { advanceProjectsTick, ensureProjectTicksSeeded } from "./project-tick";
import type { EventQueuePort } from "./event-loop";

function world(overrides: Partial<Pick<WorldState, "projects">> = {}): WorldState {
  return { ...structuredClone(firstPunicWarScenario.initialWorld), ...overrides };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    kind: "academy",
    sponsorEntityRef: { kind: "polity", id: "rome" },
    label: "Found a war academy",
    status: "funded",
    reservationId: null,
    milestones: [
      { id: "m1", label: "Break ground", requiredAtElapsedOffset: 0, costAmount: 0, status: "pending", linkedWorkflowId: null, linkedWorkflowParams: {}, completedAtStep: null },
      { id: "m2", label: "Graduate first cohort", requiredAtElapsedOffset: 10, costAmount: 0, status: "pending", linkedWorkflowId: null, linkedWorkflowParams: {}, completedAtStep: null },
    ],
    completionWorkflowId: null,
    completionWorkflowParams: {},
    linkedEntityIds: [],
    startedAtStep: 1,
    targetCompletionStep: null,
    completedAtStep: null,
    provenanceEventIds: [],
    ...overrides,
  };
}

function baseEvent(projectId: string): WorldEventRecord {
  return {
    id: "evt-1", gameId: "game-1", scheduledForTurnId: null, kind: "world_process_tick", status: "pending",
    instant: { day: 1, minute: 0 }, priority: 0, isPlayerAction: false, subjectRef: { kind: "project", id: projectId },
    actionId: null, operationId: null,
    payload: { kind: "world_process_tick", processKind: "project", targetRef: { kind: "project", id: projectId } },
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

describe("advanceProjectsTick (docs/32, Part C.2/C.6)", () => {
  it("completes the due milestone and reports a materially-consequential event", () => {
    const w = world({ projects: [project()] });
    const result = advanceProjectsTick(w, baseEvent("project-1"), 1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.materialConsequence).toBe(true);
    expect(result.world.projects[0]?.milestones[0]?.status).toBe("completed");
  });

  it("schedules a follow-up tick when a later milestone is still pending", () => {
    const w = world({ projects: [project()] });
    const result = advanceProjectsTick(w, baseEvent("project-1"), 1);
    expect(result.followUpEvents).toBeDefined();
    expect(result.followUpEvents).toHaveLength(1);
    expect(result.followUpEvents?.[0]?.subjectRef.id).toBe("project-1");
  });

  it("produces no follow-up once the last milestone completes the project", () => {
    const singleMilestone = project({ milestones: [{ id: "m1", label: "Only step", requiredAtElapsedOffset: 0, costAmount: 0, status: "pending", linkedWorkflowId: null, linkedWorkflowParams: {}, completedAtStep: null }] });
    const w = world({ projects: [singleMilestone] });
    const result = advanceProjectsTick(w, baseEvent("project-1"), 1);
    expect(result.followUpEvents ?? []).toHaveLength(0);
    expect(result.world.projects[0]?.status).toBe("completed");
  });

  it("spends from the project's reservation when the milestone has a cost", () => {
    const w = world({ projects: [project({ reservationId: "res-1", milestones: [{ id: "m1", label: "Break ground", requiredAtElapsedOffset: 0, costAmount: 40, status: "pending", linkedWorkflowId: null, linkedWorkflowParams: {}, completedAtStep: null }] })] });
    const funded: WorldState = {
      ...w,
      material: {
        ...w.material,
        reservations: [{ id: "res-1", accountId: w.material.accounts[0]!.id, currencyId: w.material.accounts[0]!.currencyId, reservedAmount: 100, remainingAmount: 100, purposeKind: "project", purposeId: "project-1", status: "active", createdAtStep: 1, closedAtStep: null }],
      },
    };
    const result = advanceProjectsTick(funded, baseEvent("project-1"), 1);
    expect(result.world.material.reservations[0]?.remainingAmount).toBe(60);
  });

  it("is a no-op for an event naming a project that no longer exists", () => {
    const w = world();
    const result = advanceProjectsTick(w, baseEvent("no-such-project"), 1);
    expect(result.events).toHaveLength(0);
    expect(result.world).toBe(w);
  });
});

describe("ensureProjectTicksSeeded", () => {
  it("seeds a pending tick for a project with a due milestone and no event yet", async () => {
    const w = world({ projects: [project()] });
    const port = fakePort();
    await ensureProjectTicksSeeded(port, w, 1);
    expect(port.events.some((e) => e.kind === "world_process_tick" && e.subjectRef.id === "project-1")).toBe(true);
  });

  it("does not seed a duplicate when a pending tick already exists", async () => {
    const w = world({ projects: [project()] });
    const port = fakePort([baseEvent("project-1")]);
    await ensureProjectTicksSeeded(port, w, 1);
    expect(port.events.filter((e) => e.kind === "world_process_tick" && e.subjectRef.id === "project-1")).toHaveLength(1);
  });

  it("seeds nothing for a project with no due milestone", async () => {
    const futureProject = project({ milestones: [{ id: "m1", label: "Later", requiredAtElapsedOffset: 100, costAmount: 0, status: "pending", linkedWorkflowId: null, linkedWorkflowParams: {}, completedAtStep: null }] });
    const w = world({ projects: [futureProject] });
    const port = fakePort();
    await ensureProjectTicksSeeded(port, w, 1);
    expect(port.events).toHaveLength(0);
  });
});
