import type { WorldState } from "../world/world-state";
import { WORKFLOW_REGISTRY } from "./registry";
import type { WorkflowCandidate, WorkflowCandidateSource } from "./manager-types";

// Workflow Manager policy validator (Issue #6).
//
// Deterministic checks that run before the Workflow Manager AI call.
// Candidates that fail are auto-rejected with an audit record; the AI
// never sees them. All checks are stateless given (candidate, world).

export type PolicyViolationKind =
  | "unknown_action"
  | "invalid_params"
  | "unknown_actor"
  | "dead_actor"
  | "authority_mismatch"
  | "scope_violation"
  | "treasury_unauthorised"
  | "duplicate";

export interface PolicyViolation {
  readonly kind: PolicyViolationKind;
  readonly message: string;
}

/** Map from WorkflowCandidateSource to the invokerAuthority kind it represents. */
const SOURCE_TO_INVOKER: Record<WorkflowCandidateSource, string> = {
  player_directive: "player",
  character_director: "character_director",
  near_event: "world_director",
  far_event: "world_director",
  coarse_event: "world_director",
};

/** Numeric rank for scope tiers — lower = narrower. */
const SCOPE_RANK: Record<string, number> = { near: 0, far: 1, coarse: 2 };

/** Source to its scope tier (only relevant for world_director). */
const SOURCE_TO_SCOPE: Partial<Record<WorkflowCandidateSource, string>> = {
  near_event: "near",
  far_event: "far",
  coarse_event: "coarse",
};

/**
 * Validate a single candidate against world state.
 * Returns null if valid, or a PolicyViolation describing the first failure.
 *
 * Checks run in order; the first failure is returned immediately.
 * Caller is responsible for duplicate detection (check 8) across the full list.
 */
export function validateCandidate(candidate: WorkflowCandidate, world: WorldState): PolicyViolation | null {
  const { requestedInvocation: inv, source } = candidate;

  // 1. Registered action
  const definition = WORKFLOW_REGISTRY.get(inv.actionId);
  if (!definition) {
    return {
      kind: "unknown_action",
      message: `Workflow "${inv.actionId}" is not registered in the skill catalog.`,
    };
  }

  // 2. Parameter schema
  const parsed = definition.parametersSchema.safeParse(inv.parameters);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: { message: string }) => i.message).join("; ");
    return {
      kind: "invalid_params",
      message: `Invalid parameters for "${inv.actionId}": ${issues}`,
    };
  }

  // 3. Actor existence
  const actor = world.characters.find((c) => c.id === inv.actorId);
  if (!actor) {
    return {
      kind: "unknown_actor",
      message: `Actor "${inv.actorId}" does not exist in world state.`,
    };
  }

  // 4. Actor alive
  if (!actor.alive) {
    return {
      kind: "dead_actor",
      message: `Actor "${inv.actorId}" (${actor.name}) is dead and cannot invoke workflows.`,
    };
  }

  // 5. invokerAuthority — source must map to an allowed invoker kind
  if (definition.invokerAuthority && definition.invokerAuthority.length > 0) {
    const invoker = SOURCE_TO_INVOKER[source];
    if (!definition.invokerAuthority.includes(invoker as never)) {
      return {
        kind: "authority_mismatch",
        message: `Skill "${inv.actionId}" may only be invoked by [${definition.invokerAuthority.join(", ")}]; source "${source}" maps to "${invoker}".`,
      };
    }
  }

  // 6. scopeLimit — world_director invokers must be within the allowed scope tier
  if (definition.scopeLimit) {
    const sourceTier = SOURCE_TO_SCOPE[source];
    if (sourceTier !== undefined) {
      const allowed = SCOPE_RANK[definition.scopeLimit] ?? 2;
      const actual = SCOPE_RANK[sourceTier] ?? 0;
      if (actual > allowed) {
        return {
          kind: "scope_violation",
          message: `Skill "${inv.actionId}" requires scope ≤ "${definition.scopeLimit}"; source "${source}" is scope "${sourceTier}".`,
        };
      }
    }
  }

  // 7. Office authorisedActionIds — requires scenario.government.offices, not available
  // in WorldState alone. Intentionally deferred; the Workflow Manager AI prompt describes
  // office authority, and the executor enforces a null return for inapplicable mutations.
  // TODO: pass scenario offices when scenario is available in the pipeline.

  // 8. Treasury permissions — if params reference an accountId, verify the actor has access
  const params = parsed.data as Record<string, unknown>;
  const paramAccountId = params["accountId"];
  if (typeof paramAccountId === "string") {
    const spending = params["amount"];
    if (typeof spending === "number" && spending > 0) {
      // This is a spending-type operation; verify actor has adequate permission.
      // add_gold and similar income grants don't require actor permission (they're granted).
      // For operations that require actor authority (spend_gold, transfer_gold), check access.
      const isSpend = inv.actionId === "spend_gold" || inv.actionId === "transfer_gold";
      if (isSpend) {
        const hasAccess = world.material.accountAccess.some(
          (a) =>
            a.characterId === inv.actorId &&
            a.accountId === paramAccountId &&
            (a.permissions.includes("spend_without_vote") || a.permissions.includes("propose_spending")),
        );
        if (!hasAccess) {
          return {
            kind: "treasury_unauthorised",
            message: `Actor "${inv.actorId}" does not have treasury access to account "${paramAccountId}" required for "${inv.actionId}".`,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Validate all candidates, returning a map from correlationId to violation (or null).
 * Also performs duplicate detection across the full list.
 */
export function validateAllCandidates(
  candidates: readonly WorkflowCandidate[],
  world: WorldState,
): Map<string, PolicyViolation | null> {
  const results = new Map<string, PolicyViolation | null>();
  const seen = new Map<string, string>(); // "actionId:keyParam" → correlationId

  for (const candidate of candidates) {
    const violation = validateCandidate(candidate, world);
    if (violation) {
      results.set(candidate.correlationId, violation);
      continue;
    }

    // Duplicate detection: same actionId + actorId is a duplicate
    const dupeKey = `${candidate.requestedInvocation.actionId}:${candidate.requestedInvocation.actorId}`;
    const prior = seen.get(dupeKey);
    if (prior !== undefined) {
      results.set(candidate.correlationId, {
        kind: "duplicate",
        message: `Duplicate: "${candidate.requestedInvocation.actionId}" by actor "${candidate.requestedInvocation.actorId}" already proposed (correlationId: ${prior}).`,
      });
    } else {
      seen.set(dupeKey, candidate.correlationId);
      results.set(candidate.correlationId, null);
    }
  }

  return results;
}
