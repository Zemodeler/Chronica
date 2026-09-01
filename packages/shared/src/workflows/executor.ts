import type { WorldState } from "../world/world-state";
import type { ProposedInvocation } from "../actions/orders";
import { WORKFLOW_REGISTRY } from "./registry";
import { WorkflowNotFoundError, WorkflowParamsError, type WorkflowResult } from "./types";
import { applyInventedWorkflow, type InventedPatchOperation, type RuntimeInventedWorkflow } from "./invented-workflow";

// Workflow executor (docs/14, ADR-0032).
//
// This is the single gate between a ProposedInvocation and a world mutation.
// It resolves the workflow, validates parameters, applies the mutation, and
// returns the result. The executor never throws on a valid workflow + valid
// world — it returns null from apply() for logically impossible operations
// (e.g. moving a force that does not exist). The caller records a failed result.

export interface ExecutionSuccess {
  readonly ok: true;
  readonly world: WorldState;
  readonly result: WorkflowResult;
  readonly resolvedInventedPatch?: readonly InventedPatchOperation[];
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
  inventedWorkflows: readonly RuntimeInventedWorkflow[] = [],
): ExecutionOutcome {
  const definition = WORKFLOW_REGISTRY.get(invocation.actionId);
  const invented = inventedWorkflows.find((workflow) => workflow.status === "active" && workflow.definition.actionId === invocation.actionId);
  if (!definition) {
    if (invented) {
      const appliedInvented = applyInventedWorkflow(invented.definition, world, invocation.parameters);
      if ("error" in appliedInvented) return { ok: false, reason: "not_applicable", message: appliedInvented.error };
      return {
        ok: true,
        world: appliedInvented.world,
        result: { summary: invented.definition.description, applied: true },
        resolvedInventedPatch: appliedInvented.resolvedOperations,
      };
    }
    return { ok: false, reason: "not_found", message: `No workflow "${invocation.actionId}".` };
  }

  const parsed = definition.parametersSchema.safeParse(invocation.parameters);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_params",
      message: `Invalid params for "${invocation.actionId}": ${parsed.error.issues.map((i: { message: string }) => i.message).join("; ")}`,
    };
  }

  const applied = definition.apply(world, parsed.data, { actorId: invocation.actorId, atStep });
  if (applied === null) {
    return {
      ok: false,
      reason: "not_applicable",
      message: `Workflow "${invocation.actionId}" cannot be applied to the current world state.`,
    };
  }

  return { ok: true, world: applied.world, result: applied.result };
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
  inventedWorkflows: readonly RuntimeInventedWorkflow[] = [],
): { world: WorldState; log: { invocation: ProposedInvocation; outcome: ExecutionOutcome }[] } {
  let current = world;
  const log: { invocation: ProposedInvocation; outcome: ExecutionOutcome }[] = [];

  for (const invocation of invocations) {
    const outcome = executeWorkflow(invocation, current, atStep, inventedWorkflows);
    log.push({ invocation, outcome });
    if (outcome.ok) {
      current = outcome.world;
    }
  }

  return { world: current, log };
}
