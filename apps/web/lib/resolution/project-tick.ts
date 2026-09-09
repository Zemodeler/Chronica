import "server-only";

import {
  completeMilestone,
  midnight,
  nextDueMilestone,
  spendFromReservation,
  executeWorkflow,
  type FactualEvent,
  type WorldEventRecord,
  type WorldState,
} from "@chronica/shared";
import type { NewWorldEvent } from "@chronica/db";
import type { EventHandlerResult, EventQueuePort } from "./event-loop";

// `advance_project` (docs/32, Part C.2/C.6): the `world_process_tick`
// handler that lets Part A's event queue drive a Project's milestones
// without a player or agent call each turn. One event per project with a
// pending milestone -- `subjectRef.id` names the project -- so several
// projects advance independently rather than one shared tick racing to
// cover all of them.

export function advanceProjectsTick(world: WorldState, event: WorldEventRecord, atStep: number): EventHandlerResult {
  const projectId = event.subjectRef.id;
  const project = world.projects.find((p) => p.id === projectId);
  if (project === undefined) return { world, events: [] };
  const milestone = nextDueMilestone(project, atStep);
  if (milestone === undefined) return { world, events: [] };

  let staged = world;
  const events: Omit<FactualEvent, "id">[] = [];

  // Spend from the project's reservation before invoking the milestone's own
  // workflow -- the reservation, not the linked workflow, is what proves the
  // funds were already committed (docs/32, Part C.3).
  if (project.reservationId !== null) {
    const reservation = staged.material.reservations.find((r) => r.id === project.reservationId);
    if (reservation !== undefined && reservation.status === "active") {
      const spent = spendFromReservation(reservation, milestone.costAmount, atStep);
      staged = { ...staged, material: { ...staged.material, reservations: staged.material.reservations.map((r) => (r.id === spent.id ? spent : r)) } };
    }
  }

  let summary = `${milestone.label} reached for ${project.label}.`;
  if (milestone.linkedWorkflowId !== null) {
    const outcome = executeWorkflow({ actionId: milestone.linkedWorkflowId, actorId: "system", parameters: milestone.linkedWorkflowParams }, staged, atStep);
    if (outcome.ok) {
      staged = outcome.world;
      summary = outcome.result.summary;
    } else {
      summary = `${milestone.label} was due for ${project.label}, but its linked workflow could not be applied: ${outcome.message}`;
    }
  }

  let updatedProject = completeMilestone(project, milestone.id, atStep);
  if (updatedProject.status === "completed" && updatedProject.completionWorkflowId !== null) {
    const outcome = executeWorkflow({ actionId: updatedProject.completionWorkflowId, actorId: "system", parameters: updatedProject.completionWorkflowParams }, staged, atStep);
    if (outcome.ok) {
      staged = outcome.world;
      summary = `${summary} ${outcome.result.summary}`;
    }
  }

  staged = { ...staged, projects: staged.projects.map((p) => (p.id === updatedProject.id ? updatedProject : p)) };
  events.push({
    atStep,
    kind: "action",
    actionId: "advance_project",
    actorId: "system",
    parameters: { projectId: project.id, milestoneId: milestone.id },
    summary,
    materialConsequence: true,
  });

  // Self-schedule the next tick only if this project still has work pending
  // -- mirrors `midnight_tick`'s own self-scheduling. A project with no more
  // pending milestones simply produces no follow-up event.
  const stillPending = updatedProject.milestones.find((m) => m.status === "pending");
  const followUpEvents: Omit<NewWorldEvent, "gameId">[] = stillPending === undefined ? [] : [{
    kind: "world_process_tick",
    instant: midnight(Math.max(atStep + 1, updatedProject.startedAtStep + stillPending.requiredAtElapsedOffset)),
    subjectRef: { kind: "project", id: updatedProject.id },
    payload: { kind: "world_process_tick", processKind: "project", targetRef: { kind: "project", id: updatedProject.id } },
    createdAtStep: atStep,
  }];

  return { world: staged, events, ...(followUpEvents.length > 0 ? { followUpEvents } : {}) };
}

/**
 * Ensures every project with a due-or-upcoming milestone has a pending
 * `world_process_tick` event -- called once per turn alongside
 * `ensureMidnightTickSeeded`, before `advanceEventQueueWithPort` runs.
 * Idempotent: a project that already has a pending tick is left alone,
 * mirroring `ensureMidnightTickSeeded`'s own "seed only what's missing"
 * discipline.
 */
export async function ensureProjectTicksSeeded(port: EventQueuePort, world: WorldState, atStep: number): Promise<void> {
  const dueProjects = world.projects.filter((project) => nextDueMilestone(project, atStep) !== undefined);
  if (dueProjects.length === 0) return;
  const pending = await port.listDuePendingEvents(midnight(atStep));
  const alreadyScheduled = new Set(
    pending.filter((event) => event.kind === "world_process_tick" && event.subjectRef.kind === "project").map((event) => event.subjectRef.id),
  );
  const toInsert: Omit<NewWorldEvent, "gameId">[] = dueProjects
    .filter((project) => !alreadyScheduled.has(project.id))
    .map((project) => ({
      kind: "world_process_tick" as const,
      instant: midnight(atStep),
      subjectRef: { kind: "project", id: project.id },
      payload: { kind: "world_process_tick" as const, processKind: "project" as const, targetRef: { kind: "project", id: project.id } },
      createdAtStep: atStep,
    }));
  if (toInsert.length > 0) await port.insertEvents(toInsert);
}
