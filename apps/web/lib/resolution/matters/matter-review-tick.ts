import "server-only";
import {
  buildAuthorityIndex,
  continuationDraftFor,
  standingPlanInvalidations,
  type WorldEventRecord,
  type WorldMatter,
  type WorldState,
} from "@chronica/shared";
import type { NewWorldEvent } from "@chronica/db";
import type { EventHandlerResult } from "../event-loop";
import { advanceMatterSchedule } from "./matter-scheduler";

/**
 * World matters, Phase 6 -- chronological integration (docs/plans/
 * ai-world-matters-runtime.md, "Chronological integration"). Dispatched
 * when a `world_process_tick` event's `processKind` is `"matter"`
 * (`event-loop.ts`'s `handlerFor`, wired in `pipeline.ts`): refreshes the
 * one named matter at its own real `WorldInstant` -- not turn start -- so
 * a changed responsible actor (a successor office-holder, say) is picked
 * up the moment this review actually runs, per the doc's "Actor selection
 * must be recomputed from current state whenever the matter is reviewed."
 *
 * Reuses `advanceMatterSchedule` (the same pure detection+disposition+
 * pressure pass the turn-level scheduler runs) rather than duplicating its
 * logic for one matter -- it is already idempotent and cheap enough to run
 * per tick.
 *
 * Deliberately does NOT attempt to determine `requiresPlayerDecision`
 * here: `EventHandler`'s signature (`(world, event, atStep)`) carries no
 * player-character id, and `resolveMatterRecipients`'s player-exclusion
 * logic needs one to route a player-responsible matter correctly rather
 * than guessing. Player-responsibility routing for matters stays where
 * Phase 2 already wired it -- `matterPriorityActors`/`resolveMatterRecipients`
 * inside the turn-level orchestrator, which does know the player id -- not
 * duplicated here. This is a deliberate, bounded limitation, consistent
 * with this phase's other deferred piece (in-loop intent interpretation):
 * a matter reviewed mid-loop is not itself an event-loop-level stopping
 * point yet.
 */
export function runMatterReviewTick(world: WorldState, event: WorldEventRecord, atStep: number): EventHandlerResult {
  const matterId = event.subjectRef.id;
  const advanced = advanceMatterSchedule(world, event.instant, atStep);
  let nextWorld = advanced.world;
  const matter = nextWorld.worldMatters?.find((m) => m.id === matterId);

  // The matter no longer exists (its source vanished and it was pruned
  // past the retained-history window) -- nothing further to schedule.
  // `advanced.events` still carries whatever `advanceWorldMatters` itself
  // produced this pass (e.g. a cancellation for a DIFFERENT matter that
  // happened to be due at the same instant), so it is still returned.
  if (matter === undefined) return { world: nextWorld, events: advanced.events };

  const followUpEvents: Omit<NewWorldEvent, "gameId">[] = [];
  const isTerminal = matter.status === "addressed" || matter.status === "cancelled";

  if (!isTerminal) {
    if (matter.standingPlanId !== null) {
      const plan = nextWorld.plans?.find((p) => p.id === matter.standingPlanId);
      if (plan === undefined) {
        nextWorld = withMatter(nextWorld, matter.id, (m) => ({ ...m, standingPlanId: null, status: "due" }));
      } else {
        const authorityIndex = buildAuthorityIndex({ officeSeats: nextWorld.material.officeSeats, forces: nextWorld.material.forces }, undefined, [], atStep);
        const invalidations = standingPlanInvalidations(nextWorld, plan, matter, authorityIndex, atStep);
        if (invalidations.length > 0) {
          nextWorld = withMatter(nextWorld, matter.id, (m) => ({ ...m, standingPlanId: null, status: "due" }));
        } else {
          const draft = continuationDraftFor(nextWorld, matter, plan, matter.nextReviewAt);
          if (draft !== null) {
            followUpEvents.push({ kind: draft.kind, instant: draft.instant, subjectRef: draft.subjectRef, payload: draft.payload, actionId: draft.actionId, createdAtStep: draft.createdAtStep });
          }
        }
      }
    }

    // Self-schedules the next review, mirroring `midnight_tick`'s own
    // next-day self-scheduling (`event-loop.ts`'s `nextMidnightTickInput`)
    // and `advanceWorldDevelopments`'s pre-event-queue equivalent.
    followUpEvents.push({
      kind: "world_process_tick",
      instant: matter.nextReviewAt,
      subjectRef: { kind: "matter", id: matter.id },
      payload: { kind: "world_process_tick", processKind: "matter", targetRef: { kind: "matter", id: matter.id } },
      createdAtStep: atStep,
    });
  }

  return { world: nextWorld, events: advanced.events, followUpEvents };
}

function withMatter(world: WorldState, matterId: string, update: (matter: WorldMatter) => WorldMatter): WorldState {
  const matters = world.worldMatters;
  if (matters === undefined) return world;
  return { ...world, worldMatters: matters.map((m) => (m.id === matterId ? update(m) : m)) };
}
