import { z } from "zod";
import type { WorldState } from "../world/world-state";
import { WORKFLOW_REGISTRY } from "./registry";
import type { WorkflowCandidate, WorkflowCandidateSource } from "./manager-types";

// Deterministic workflow policy (Issue #6; extended by the GM refactor).
//
// These checks run before any mutation, against the current (staged) world.
// Nothing here consults an AI: a candidate that fails is refused with an exact
// reason, and that reason is what the Game Master and the Chronicle both see.
//
// GM refactor: the `game_master` source is the one invoker that speaks for the
// player, the world, and named characters alike, because the roles those
// invokers named have been folded into a single agent. It still cannot invoke
// a `system`-only workflow -- deterministic engine paths such as
// `resolve_battle` stay out of any model's hands.

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

/**
 * A stable identity for an invocation when deciding whether it is a true
 * duplicate.  Action + actor alone is too coarse: one commander may quite
 * legitimately raise two differently named forces or issue distinct orders
 * in a turn.  Only the same action, actor, and parameters are duplicates.
 */
function stableParameterEncoding(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableParameterEncoding).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableParameterEncoding(record[key])}`).join(",")}}`;
}

export function workflowInvocationKey(invocation: WorkflowCandidate["requestedInvocation"]): string {
  return `${invocation.actionId}:${invocation.actorId}:${stableParameterEncoding(invocation.parameters)}`;
}

/** Map from WorkflowCandidateSource to the invokerAuthority kind it represents. */
const SOURCE_TO_INVOKER: Record<WorkflowCandidateSource, string> = {
  game_master: "game_master",
  player_directive: "player",
  character_director: "character_director",
  near_event: "world_director",
  far_event: "world_director",
  coarse_event: "world_director",
  reaction_director: "world_director",
  simulator: "world_director",
  world_director_synthesis: "world_director",
};

/** Numeric rank for scope tiers — lower = narrower. */
const SCOPE_RANK: Record<string, number> = { near: 0, far: 1, coarse: 2 };

/** Source to its scope tier (only relevant for world_director). */
const SOURCE_TO_SCOPE: Partial<Record<WorkflowCandidateSource, string>> = {
  near_event: "near",
  far_event: "far",
  coarse_event: "coarse",
  reaction_director: "near",
  simulator: "coarse",
  world_director_synthesis: "coarse",
};

/**
 * Whether an invoker may propose a workflow declaring `authority`.
 *
 * The Game Master satisfies every declared authority except a workflow that
 * only `system` may invoke: those are the deterministic engine's own entry
 * points (battle resolution, life events, procedure resolution), spliced in by
 * the pipeline, and no model may call them directly.
 */
function invokerSatisfiesAuthority(invoker: string, authority: readonly string[]): boolean {
  if (invoker === "game_master") return authority.some((kind) => kind !== "system");
  return authority.includes(invoker);
}

/**
 * Validate a single candidate against world state.
 * Returns null if valid, or a PolicyViolation describing the first failure.
 *
 * Checks run in order; the first failure is returned immediately.
 * Caller is responsible for duplicate detection (check 8) across the full list.
 */
export function validateCandidate(
  candidate: WorkflowCandidate,
  world: WorldState,
): PolicyViolation | null {
  const { requestedInvocation: inv, source } = candidate;

  // 1. Registered action. An unregistered actionId has no execution path at
  //    all now (see executor.ts): there is no runtime-template fallback.
  const definition = WORKFLOW_REGISTRY.get(inv.actionId);
  if (!definition) {
    return {
      kind: "unknown_action",
      message: `Workflow "${inv.actionId}" is not registered in the skill catalog.`,
    };
  }

  // 2. Parameter schema
  const schema = definition.parametersSchema as z.ZodType<unknown>;
  const parsed = schema.safeParse(inv.parameters);
  if (!parsed.success) {
    return {
      kind: "invalid_params",
      message: `Invalid parameters for "${inv.actionId}": ${parsed.error.issues.map((i) => i.message).join("; ")}`,
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
  const authority = definition.invokerAuthority;
  if (authority && authority.length > 0) {
    const invoker = SOURCE_TO_INVOKER[source];
    if (!invokerSatisfiesAuthority(invoker, authority)) {
      return {
        kind: "authority_mismatch",
        message: `Skill "${inv.actionId}" may only be invoked by [${authority.join(", ")}]; source "${source}" maps to "${invoker}".`,
      };
    }
  }

  // 6. scopeLimit — world_director invokers must be within the allowed scope tier
  const scopeLimit = definition.scopeLimit;
  if (scopeLimit) {
    const sourceTier = SOURCE_TO_SCOPE[source];
    if (sourceTier !== undefined) {
      const allowed = SCOPE_RANK[scopeLimit] ?? 2;
      const actual = SCOPE_RANK[sourceTier] ?? 0;
      if (actual > allowed) {
        return {
          kind: "scope_violation",
          message: `Skill "${inv.actionId}" requires scope ≤ "${scopeLimit}"; source "${source}" is scope "${sourceTier}".`,
        };
      }
    }
  }

  // 7. Office authorisedActionIds — requires scenario.government.offices, not available
  // in WorldState alone. Intentionally deferred; the executor enforces a null return for
  // inapplicable mutations, and political procedures carry their own grants.

  // 8. Treasury permissions — if params reference an accountId, verify the actor has access
  const params = parsed.data as Record<string, unknown>;
  const paramAccountId = params["accountId"];
  if (typeof paramAccountId === "string") {
    const spending = params["amount"];
    if (typeof spending === "number" && spending > 0) {
      // This is a spending-type operation; verify actor has adequate permission.
      // add_gold and similar income grants don't require actor permission (they're granted).
      // For operations that require actor authority (remove_gold, transfer_gold), check access.
      const isSpend = inv.actionId === "remove_gold" || inv.actionId === "transfer_gold";
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
  const seen = new Map<string, string>(); // exact invocation → correlationId

  for (const candidate of candidates) {
    const violation = validateCandidate(candidate, world);
    if (violation) {
      results.set(candidate.correlationId, violation);
      continue;
    }

    // Distinct orders by the same actor are allowed.  Reject only an exact
    // repeat, rather than turning a second legitimate levy into a refusal.
    const dupeKey = workflowInvocationKey(candidate.requestedInvocation);
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
