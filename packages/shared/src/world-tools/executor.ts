import { checkAuthority } from "../authority/authority-grant";
import { executeWorkflow } from "../workflows/executor";
import type { WorldState } from "../world/world-state";
import type { AnyWorldReadToolDefinition, AnyWorldToolDefinition, WorldToolContext, WorldToolOutcome, WorldToolReadOutcome } from "./types";

/**
 * Validates params, runs the authority check when the tool declares one, then
 * either invokes the workflow `dispatch` names (through the real, unchanged
 * `executeWorkflow`) or calls `fallback`. Refuses outright only when neither
 * a dispatch nor a fallback is available -- C.5's "never a dead end for a
 * well-formed request" guarantee belongs to the caller (it decides what
 * counts as a capability gap worth recording), not to this function.
 */
export function executeWorldTool(
  tool: AnyWorldToolDefinition,
  world: WorldState,
  rawParams: unknown,
  ctx: WorldToolContext,
): WorldToolOutcome {
  const parsed = tool.parametersSchema.safeParse(rawParams);
  if (!parsed.success) {
    return { ok: false, reason: `Invalid parameters for "${tool.id}": ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.` };
  }

  const requirement = tool.authorityRequirement?.(parsed.data, ctx) ?? null;
  if (requirement !== null && ctx.authorityIndex !== undefined) {
    const result = checkAuthority(ctx.authorityIndex, {
      holder: { kind: "character", id: ctx.actorId },
      domain: requirement.domain,
      scope: requirement.scope,
      power: requirement.power,
    });
    if (!result.authorized) return { ok: false, reason: `Refused: ${result.reason}` };
  }

  const dispatch = tool.dispatch(world, parsed.data, ctx);
  if (dispatch !== null) {
    const outcome = executeWorkflow({ actionId: dispatch.workflowId, actorId: ctx.actorId, parameters: dispatch.workflowParams }, world, ctx.atStep);
    return outcome.ok
      ? { ok: true, world: outcome.world, summary: outcome.result.summary }
      : { ok: false, reason: outcome.message };
  }

  if (tool.fallback !== undefined) return tool.fallback(world, parsed.data, ctx);
  return { ok: false, reason: `"${tool.id}" has no registered workflow for this call and no generic fallback.` };
}

/** Same validation discipline as `executeWorldTool`, for a tool that only ever reads. */
export function executeWorldReadTool(
  tool: AnyWorldReadToolDefinition,
  world: WorldState,
  rawParams: unknown,
  ctx: WorldToolContext,
): WorldToolReadOutcome {
  const parsed = tool.parametersSchema.safeParse(rawParams);
  if (!parsed.success) {
    return { ok: false, reason: `Invalid parameters for "${tool.id}": ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.` };
  }
  return tool.read(world, parsed.data, ctx);
}
