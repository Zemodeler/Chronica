import { z } from "zod";
import type { WorldState } from "../world/world-state";
import { WorldStateSchema } from "../world/world-state";
import { referenceViolationsIntroduced } from "../world/references";
import type { ProposedInvocation } from "../actions/orders";
import { WORKFLOW_REGISTRY } from "./registry";
import { isWorkflowRefusal, type WorkflowResult } from "./types";
import { diagnoseFailedInvocation } from "./diagnose";

// Workflow executor (docs/14, ADR-0032).
//
// This is the single gate between a ProposedInvocation and a world mutation.
// It resolves the workflow, validates parameters, applies the mutation, and
// returns the result. The executor never throws on a valid workflow + valid
// world -- it returns null from apply() for logically impossible operations
// (e.g. moving a force that does not exist). The caller records a failed result.
//
// GM refactor, requirement 7: the executor has no invented-workflow path any
// more. A runtime-generated template or JSON patch can no longer reach world
// state through ordinary play by any route -- an unregistered actionId is
// simply `not_found`. Persisted invented workflows stay readable for
// migration (see `invented-workflow.ts` and the db queries that list them),
// but making one real now means a developer writing a registered, typed
// workflow. See `gm/capability-request.ts` for the non-mutating safeguard
// that replaced the escape hatch.

export interface ExecutionSuccess {
  readonly ok: true;
  readonly world: WorldState;
  readonly result: WorkflowResult;
}

export interface ExecutionFailure {
  readonly ok: false;
  readonly reason: "not_found" | "invalid_params" | "not_applicable";
  readonly message: string;
}

export type ExecutionOutcome = ExecutionSuccess | ExecutionFailure;

/**
 * Validate and execute a workflow proposal against the current world state.
 *
 * Always returns an outcome — never throws. Callers check `outcome.ok` to
 * decide whether to record a success or a failed workflow event.
 */
export function executeWorkflow(
  invocation: ProposedInvocation,
  world: WorldState,
  atStep: number,
): ExecutionOutcome {
  const definition = WORKFLOW_REGISTRY.get(invocation.actionId);
  if (!definition) {
    return { ok: false, reason: "not_found", message: `No workflow "${invocation.actionId}".` };
  }

  const schema = definition.parametersSchema as z.ZodType<unknown>;
  let parsed = schema.safeParse(invocation.parameters);
  // A resolved political procedure's linked-workflow invocation
  // (character-agency/political-resolver.ts's buildInvocation) always
  // attaches an `authorization: { procedureId }` field to prove the grant.
  // Only the handful of workflows that gate on it (e.g. assign_command)
  // declare that key; every other workflow's .strict() schema rejects it as
  // unrecognized. Retry once with it stripped so an authorization-linked
  // workflow that doesn't itself care about the grant (start_war, move_force,
  // ...) isn't broken by a key it never asked for.
  if (
    !parsed.success
    && invocation.parameters !== null
    && typeof invocation.parameters === "object"
    && "authorization" in invocation.parameters
  ) {
    const { authorization: _authorization, ...withoutAuthorization } = invocation.parameters;
    const retried = schema.safeParse(withoutAuthorization);
    if (retried.success) parsed = retried;
  }
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_params",
      message: `Invalid params for "${invocation.actionId}": ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }

  const applied = definition.apply(world, parsed.data, { actorId: invocation.actorId, atStep });
  if (applied === null) {
    // A bare null says only "no". Before giving up on it, check the one thing
    // that is wrong most of the time and that the caller can actually fix.
    const diagnosis = diagnoseFailedInvocation(world, invocation.actionId, parsed.data);
    return {
      ok: false,
      reason: "not_applicable",
      message: diagnosis.message ?? `Workflow "${invocation.actionId}" cannot be applied to the current world state.`,
    };
  }
  // A workflow that named its own reason: pass it through untouched. This is
  // the text the Game Master reads to correct itself, and the text a player
  // eventually sees if nothing does.
  if (isWorkflowRefusal(applied)) {
    return { ok: false, reason: "not_applicable", message: applied.refused };
  }

  const validated = WorldStateSchema.safeParse(applied.world);
  if (!validated.success) {
    return {
      ok: false,
      reason: "not_applicable",
      message: `Workflow "${invocation.actionId}" produced an invalid world state: ${validated.error.issues.map((i) => i.message).join("; ")}`,
    };
  }

  // Zod validates each collection's shape; it does not check that the ids one
  // collection holds resolve in another. A workflow that leaves a character
  // pointing at a province, purse, or heir that does not exist has produced a
  // world the rest of the engine will read wrongly and silently, so it is
  // refused here. Checked as a delta, so a snapshot that already carried
  // breakage stays playable while it is repaired.
  const introduced = referenceViolationsIntroduced(world, validated.data);
  if (introduced.length > 0) {
    return {
      ok: false,
      reason: "not_applicable",
      message: `Workflow "${invocation.actionId}" would leave a dangling reference: ${introduced.join("; ")}`,
    };
  }

  return { ok: true, world: validated.data, result: applied.result };
}

/**
 * Apply a list of invocations in sequence, accumulating world mutations.
 *
 * Returns the final world plus a log of what succeeded or failed. Failures
 * do not abort — later invocations still run against the current accumulated
 * state.
 */
export function executeWorkflows(
  invocations: readonly ProposedInvocation[],
  world: WorldState,
  atStep: number,
): { world: WorldState; log: { invocation: ProposedInvocation; outcome: ExecutionOutcome }[] } {
  let current = world;
  const log: { invocation: ProposedInvocation; outcome: ExecutionOutcome }[] = [];

  for (const invocation of invocations) {
    const outcome = executeWorkflow(invocation, current, atStep);
    log.push({ invocation, outcome });
    if (outcome.ok) {
      current = outcome.world;
    }
  }

  return { world: current, log };
}
