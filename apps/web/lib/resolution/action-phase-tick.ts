import "server-only";

import { completePlanStage, executeWorkflow, planSpending, releaseStageReservations, type ActionPlan, type WorldState } from "@chronica/shared";
import type { EventHandler } from "./event-loop";

// The generic resolver for an `action_phase` event -- either one a reaction
// agent scheduled (`GameMasterSession`'s `deferMutations` mode,
// `agents/reaction-runner.ts`) instead of applying its validated action
// immediately, or one `execute_plan_stage` scheduled via `completesAtStep`
// (unified action runtime, "Duration and milestones") because the
// interpreter judged this specific call's own effect should land later.
// Runs the exact same registered-workflow executor `project-tick.ts`'s
// `linkedWorkflowId` dispatch already uses for engine-driven mutation, so
// the effect lands on the world exactly when the queue actually reaches it
// -- never before, never merely narrated.
//
// A bare `{actionId, stageId}` payload with no `actorId`/`parameters` (a
// shape this schema has always allowed, for a not-yet-built handler) is not
// this handler's concern: it does nothing, the same as the pre-existing
// no-op default.
export const resolveActionPhase: EventHandler = (world, event, atStep) => {
  if (event.payload.kind !== "action_phase" || event.payload.actorId === undefined) {
    return { world, events: [] };
  }
  const { actionId, actorId, parameters, stageId } = event.payload;
  const plan = stageId === undefined ? undefined : world.plans?.find((p) => p.stages.some((s) => s.id === stageId));
  const outcome = executeWorkflow({ actionId, actorId, parameters: parameters ?? {} }, world, atStep);
  // The event loop assigns this same fact its id deterministically
  // (`${due.id}-${index}`, index 0 -- this handler's result always carries
  // exactly one event) -- computed here too so the plan stage's own
  // `resultFactIds` cites the fact that will actually exist once committed.
  const resultFactIds = [`${event.id}-0`];

  // Unified action runtime, Stage 6: a plan's own stated budget is a real
  // cap, not merely advisory context for the interpreter's judgment. A call
  // that would push this plan's total spend past its budget is refused
  // outright -- the world this handler returns is the one from BEFORE the
  // call, exactly as if it had never been attempted.
  if (outcome.ok && plan?.options.budget) {
    const debit = planSpending(world, outcome.world, plan);
    const remaining = plan.options.budget.amount - plan.spent;
    if (debit > remaining) {
      const budgetMessage = `This would spend ${debit} more from the account, exceeding the ${plan.options.budget.amount}-limit you set for this plan (${remaining} remained).`;
      return {
        world: closeOutPlanStage(world, stageId!, atStep, { success: false, resultFactIds, statusReason: budgetMessage, spentDelta: 0 }),
        events: [{
          atStep, kind: "capability_gap", actionId, actorId, parameters: parameters ?? {},
          summary: `A scheduled action by ${actorId} did not take effect: ${budgetMessage}`,
          materialConsequence: false,
        }],
      };
    }
  }

  const resolvedWorld = outcome.ok ? outcome.world : world;
  const spentDelta = outcome.ok && plan ? planSpending(world, outcome.world, plan) : 0;
  const finalWorld = stageId === undefined
    ? resolvedWorld
    : closeOutPlanStage(resolvedWorld, stageId, atStep, { success: outcome.ok, resultFactIds, statusReason: outcome.ok ? null : outcome.message, spentDelta });
  if (!outcome.ok) {
    return {
      world: finalWorld,
      events: [{
        atStep, kind: "capability_gap", actionId, actorId, parameters: parameters ?? {},
        summary: `A scheduled action by ${actorId} did not take effect: ${outcome.message}`,
        materialConsequence: false,
      }],
    };
  }
  return {
    world: finalWorld,
    events: [{
      atStep, kind: "action", actionId, actorId, parameters: parameters ?? {},
      summary: outcome.result.summary, materialConsequence: outcome.result.noOp !== true,
    }],
  };
};

/**
 * Closes out the `ActionPlan` stage this scheduled phase belongs to, if one
 * still matches. Never throws and never invents a state: a plan/stage that
 * no longer exists or is no longer `in_progress` (cancelled, superseded,
 * already closed some other way since this was scheduled) is left
 * untouched rather than forced into a state the world doesn't actually
 * support -- `completePlanStage`'s own refusal for a non-`in_progress`
 * stage is exactly the same honesty this codebase applies everywhere else.
 *
 * Also releases every reservation this stage held (unified action runtime,
 * Stage 6) -- its exclusive claim on a character's time, a force, an
 * account, or an office ends the instant its own work is done, success or
 * failure alike, and records `spentDelta` against the plan's own running
 * total so a later call against the same budget sees what remains.
 */
function closeOutPlanStage(
  world: WorldState,
  stageId: string,
  atStep: number,
  outcome: { success: boolean; resultFactIds: readonly string[]; statusReason: string | null; spentDelta: number },
): WorldState {
  const plan = world.plans?.find((p) => p.stages.some((s) => s.id === stageId));
  if (!plan) return world;
  const updated = completePlanStage(plan, stageId, atStep, outcome);
  if (typeof updated === "string") return world;
  const withSpend: ActionPlan = outcome.spentDelta > 0 ? { ...updated, spent: updated.spent + outcome.spentDelta } : updated;
  return {
    ...world,
    plans: world.plans!.map((p) => (p.id === plan.id ? withSpend : p)),
    stageReservations: releaseStageReservations(world.stageReservations ?? [], stageId, atStep),
  };
}
