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
  /**
   * True when the call was valid and applied but changed nothing at all --
   * renaming something to the name it already has, for instance. The world is
   * unchanged, so the Chronicle stays silent rather than reporting a change
   * that never occurred.
   */
  noOp: z.boolean().optional(),
});
export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;

export interface WorkflowApplyContext {
  readonly actorId: string;
  readonly atStep: number;
}

/**
 * A workflow declining to act, and saying why.
 *
 * `apply` returning `null` means "cannot be applied", which is all the
 * executor could ever tell the caller -- so a Game Master whose order failed
 * had nothing to correct and simply reported the failure to the player. A
 * refusal that names the precondition that failed is the difference between a
 * turn that recovers itself and a Chronicle entry about nothing.
 *
 * The reason is read by an AI and, when nothing recovers it, by a player.
 * Write it as a fact about the world -- "no settlement of that id exists",
 * "you do not sponsor that procedure" -- never as a fact about the code.
 */
export interface WorkflowRefusal {
  readonly refused: string;
}

export function refuse(reason: string): WorkflowRefusal {
  return { refused: reason };
}

export function isWorkflowRefusal(value: unknown): value is WorkflowRefusal {
  return typeof value === "object" && value !== null && typeof (value as WorkflowRefusal).refused === "string";
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
   * world. Must not throw on a valid world + valid params.
   *
   * To decline, return `refuse("why")` -- the caller passes that reason back
   * to whoever attempted it, which is what lets a wrong id or a missing step
   * be corrected instead of merely reported. Returning `null` still works and
   * still means "cannot be applied", but says nothing anyone can act on.
   */
  readonly apply: (
    world: WorldState,
    params: z.infer<TParams>,
    context: WorkflowApplyContext,
  ) => { world: WorldState; result: WorkflowResult } | WorkflowRefusal | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWorkflowDefinition = WorkflowDefinition<any>;

/**
 * The command taxonomy (docs/27): `agent_action` is AI-callable, `system_effect`
 * runs only from deterministic pipeline/executor code and is never offered as
 * a tool. A workflow is a `system_effect` exactly when every declared
 * `invokerAuthority` is `"system"` -- the same test `tools.ts`'s
 * `buildActionTools` and `policy.ts`'s `invokerSatisfiesAuthority` both need,
 * now expressed once instead of twice.
 */
export type CommandKind = "agent_action" | "system_effect";

export function commandKindOf(definition: AnyWorkflowDefinition): CommandKind {
  const authority = definition.invokerAuthority;
  const isSystemOnly = authority !== undefined && authority.length > 0 && authority.every((kind) => kind === "system");
  return isSystemOnly ? "system_effect" : "agent_action";
}

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
