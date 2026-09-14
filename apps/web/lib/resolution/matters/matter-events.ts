import "server-only";
import { midnight, type WorldState } from "@chronica/shared";
import type { NewWorldEvent } from "@chronica/db";
import type { EventQueuePort } from "../event-loop";

/**
 * World matters, Phase 6 -- chronological integration. Ensures every
 * `due`/`overdue` `WorldMatter` has a pending `world_process_tick`
 * ("matter") event, mirroring `project-tick.ts`'s `ensureProjectTicksSeeded`
 * exactly -- including its same narrow lookahead: only a matter due AT OR
 * BEFORE today (`midnight(atStep)`) is checked/seeded here, same as a
 * project's own tick. An `upcoming` matter needs no tick yet; the
 * turn-level `matter-scheduler.ts` pass (already wired in
 * `world-dynamics.ts`, independent of the event queue) is what actually
 * re-evaluates due-ness from canonical state every turn regardless of
 * whether any tick row exists -- this seeding only gives due matters a
 * real position in the chronological queue, it is not itself what decides
 * a matter is due. Idempotent: a matter that already has a pending event
 * is left alone.
 */
export async function ensureMatterTicksSeeded(port: EventQueuePort, world: WorldState, atStep: number): Promise<void> {
  const dueMatters = (world.worldMatters ?? []).filter((matter) => matter.status === "due" || matter.status === "overdue");
  if (dueMatters.length === 0) return;
  const pending = await port.listDuePendingEvents(midnight(atStep));
  const alreadyScheduled = new Set(
    pending.filter((event) => event.kind === "world_process_tick" && event.subjectRef.kind === "matter").map((event) => event.subjectRef.id),
  );
  const toInsert: Omit<NewWorldEvent, "gameId">[] = dueMatters
    .filter((matter) => !alreadyScheduled.has(matter.id))
    .map((matter) => ({
      kind: "world_process_tick" as const,
      instant: matter.nextReviewAt,
      subjectRef: { kind: "matter", id: matter.id },
      payload: { kind: "world_process_tick" as const, processKind: "matter" as const, targetRef: { kind: "matter", id: matter.id } },
      createdAtStep: atStep,
    }));
  if (toInsert.length > 0) await port.insertEvents(toInsert);
}
