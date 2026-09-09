import "server-only";

import { executeWorkflow } from "@chronica/shared";
import type { EventHandler } from "./event-loop";

// docs/32 corrective pass, requirement 3: the generic resolver for an
// `action_phase` event a reaction agent scheduled (`GameMasterSession`'s
// `deferMutations` mode, `agents/reaction-runner.ts`) instead of applying
// its validated action immediately. Runs the exact same registered-workflow
// executor `project-tick.ts`'s `linkedWorkflowId` dispatch already uses for
// engine-driven mutation, so a reaction's effect lands on the world exactly
// when the queue actually reaches it -- never before, never merely narrated.
//
// A bare `{actionId, stageId}` payload with no `actorId`/`parameters` (a
// shape this schema has always allowed, for a future plan-stage-linked use
// this phase does not build) is not this handler's concern: it does
// nothing, the same as the pre-existing no-op default.
export const resolveActionPhase: EventHandler = (world, event, atStep) => {
  if (event.payload.kind !== "action_phase" || event.payload.actorId === undefined) {
    return { world, events: [] };
  }
  const { actionId, actorId, parameters } = event.payload;
  const outcome = executeWorkflow({ actionId, actorId, parameters: parameters ?? {} }, world, atStep);
  if (!outcome.ok) {
    return {
      world,
      events: [{
        atStep, kind: "capability_gap", actionId, actorId, parameters: parameters ?? {},
        summary: `A scheduled reaction by ${actorId} did not take effect: ${outcome.message}`,
        materialConsequence: false,
      }],
    };
  }
  return {
    world: outcome.world,
    events: [{
      atStep, kind: "action", actionId, actorId, parameters: parameters ?? {},
      summary: outcome.result.summary, materialConsequence: outcome.result.noOp !== true,
    }],
  };
};
