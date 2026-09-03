import { z } from "zod";
import type { WorldState } from "../world/world-state";

// Workflow registry types (docs/14, ADR-0032).
//
// Workflows are the concrete game operations the AI may propose and the
// resolution pipeline may execute. They are the only channel through which
// AI-generated intent becomes deterministic world-state change.
//
// A workflow:
//  - Has a stable string ID the AI names and the registry resolves.
//  - Declares a Zod schema for its parameters so invalid proposals are
//    rejected before any mutation runs.
//  - Exposes a pure apply() that transforms WorldState immutably.
//  - Carries a short description the AI reads when choosing which to invoke.

export const WorkflowResultSchema = z.object({
  /** Human-readable one-sentence summary for the chronicle. */
  summary: z.string().min(1).max(400),
  /** Whether the action succeeded (false = partially applied or failed). */
  applied: z.boolean(),
});
export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;

export interface WorkflowApplyContext {
  readonly actorId: string;
  readonly atStep: number;
}

/** Which AI sources are permitted to invoke a workflow (skills framing, ADR-0032). */
export type WorkflowInvokerAuthority = "player" | "world_director" | "character_director" | "system";

/** World Director scope tiers, narrowest first. */
export type WorkflowScopeLimit = "near" | "far" | "coarse";

export interface WorkflowDefinition<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Stable identifier used by AI proposals. */
  readonly id: string;
  /** One-line description shown to the AI when it selects workflows. */
  readonly description: string;
  /** Category for grouping in registry documentation. */
  readonly category: "military" | "political" | "economic" | "character" | "narrative" | "map" | "material";
  /**
   * Which invoker kinds may propose this workflow (skill authority).
   * Omit to allow any invoker. Used by the Workflow Manager policy validator.
   */
  readonly invokerAuthority?: readonly WorkflowInvokerAuthority[];
  /**
   * For world_director invokers: the broadest scope tier allowed to propose this.
   * "near" = only Near events; "far" = Near or Far; "coarse" = any tier.
   * Omit to place no scope restriction.
   */
  readonly scopeLimit?: WorkflowScopeLimit;
  /** Zod schema validating the raw `parameters` record. */
  readonly parametersSchema: TParams;
  /**
   * Pure transformation: given valid params and current world, return the next
   * world. Must not throw on a valid world + valid params. Returns null if the
   * workflow cannot be applied (caller records a failed result, not an error).
   */
  readonly apply: (
    world: WorldState,
    params: z.infer<TParams>,
    context: WorkflowApplyContext,
  ) => { world: WorldState; result: WorkflowResult } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWorkflowDefinition = WorkflowDefinition<any>;

/**
 * Helper that preserves the concrete TParams type for the apply() callback
 * while widening to AnyWorkflowDefinition for registry storage.
 */
export function defineWorkflow<TParams extends z.ZodTypeAny>(
  workflow: WorkflowDefinition<TParams>,
): AnyWorkflowDefinition {
  return workflow;
}

export class WorkflowNotFoundError extends Error {
  constructor(actionId: string) {
    super(`No workflow registered for actionId "${actionId}".`);
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowParamsError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(actionId: string, issues: z.ZodIssue[]) {
    super(`Invalid parameters for workflow "${actionId}": ${issues.map((i) => i.message).join("; ")}`);
    this.name = "WorkflowParamsError";
    this.issues = issues;
  }
}
