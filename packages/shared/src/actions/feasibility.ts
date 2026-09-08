import { z } from "zod";
import type { WorldState } from "../world/world-state";
import { WORKFLOW_REGISTRY } from "../workflows/registry";
import type { InterpretedClaim } from "./plans";

/**
 * Feasibility service (docs/32, Phase 3) -- advisory, not a gate.
 *
 * This module only ever produces structured context for the Game Master's
 * own tool loop to consult (surfaced as the `assess_feasibility` read tool,
 * `gm/read-tools.ts`). It never refuses a mutation itself: the GM's tool
 * call remains the sole authority that applies or refuses one, exactly as it
 * does today for every ordinary workflow. This is a deliberate divergence
 * from an earlier draft of this plan, made to stay consistent with the
 * GM-authority direction (docs/24) and the retirement of deterministic
 * fallback layers. Do not "upgrade" this into a gate -- see docs/32's
 * invariants section.
 *
 * Only dimensions this module can check *purely from world state* produce a
 * finding at all; a dimension needing genuine judgment (political consent,
 * physical realism, knowledge) is left to the GM entirely rather than
 * reported here with a manufactured answer.
 */
export const FeasibilityDimensionSchema = z.enum([
  "actor_exists",
  "target_exists",
  "authority",
  "resource_control",
  "resource_amount",
  "location",
  "reachability",
  "time",
  "political_consent",
  "knowledge",
  "physical_realism",
  "world_consistency",
  "workflow_support",
]);
export type FeasibilityDimension = z.infer<typeof FeasibilityDimensionSchema>;

export const FeasibilityFindingResultSchema = z.enum(["pass", "fail", "uncertain", "conditional"]);
export type FeasibilityFindingResult = z.infer<typeof FeasibilityFindingResultSchema>;

export interface FeasibilityFinding {
  readonly dimension: FeasibilityDimension;
  readonly result: FeasibilityFindingResult;
  readonly reason: string;
  readonly factRefs: readonly string[];
  /** Whether a different attempt (a different actor, resource, or route) could still pass this dimension. */
  readonly recoverable: boolean;
}

export const FeasibilityClassificationSchema = z.enum([
  "viable",
  "conditional",
  "misinformed",
  "impossible",
  "clarification_required",
  "unsupported",
]);
export type FeasibilityClassification = z.infer<typeof FeasibilityClassificationSchema>;

export interface FeasibilityResourceRef {
  readonly accountId?: string;
  readonly forceId?: string;
}

export interface FeasibilityAssessmentInput {
  readonly world: WorldState;
  readonly actorId: string;
  /** Set when the stage names a province condition (docs/32, `ActionPlanStage.provinceId`). */
  readonly targetProvinceId?: string | null;
  /** Set when the stage already names the built-in workflow it intends to attempt. */
  readonly actionId?: string | null;
  readonly resourceRefs?: readonly FeasibilityResourceRef[];
  /** Claims already classified by `interpret_plan` (docs/32, Phase 2); a contradicted world premise fails `world_consistency`. */
  readonly claims?: readonly InterpretedClaim[];
}

export interface FeasibilityAssessment {
  readonly findings: readonly FeasibilityFinding[];
  readonly classification: FeasibilityClassification;
}

function actorExists(world: WorldState, actorId: string): FeasibilityFinding {
  const actor = world.characters.find((c) => c.id === actorId);
  if (!actor) return { dimension: "actor_exists", result: "fail", reason: `No character with id "${actorId}" exists.`, factRefs: [], recoverable: false };
  if (!actor.alive) return { dimension: "actor_exists", result: "fail", reason: `${actor.name} is not alive.`, factRefs: [], recoverable: false };
  return { dimension: "actor_exists", result: "pass", reason: `${actor.name} exists and is alive.`, factRefs: [], recoverable: true };
}

function locationExists(world: WorldState, provinceId: string): FeasibilityFinding {
  const province = world.map.provinces.find((p) => p.id === provinceId);
  if (!province) return { dimension: "location", result: "fail", reason: `No province with id "${provinceId}" exists.`, factRefs: [], recoverable: false };
  return { dimension: "location", result: "pass", reason: `${province.name} exists.`, factRefs: [], recoverable: true };
}

function resourceControl(world: WorldState, actorId: string, ref: FeasibilityResourceRef): FeasibilityFinding | null {
  if (ref.accountId !== undefined) {
    const account = world.material.accounts.find((a) => a.id === ref.accountId);
    if (!account) return { dimension: "resource_control", result: "fail", reason: `No account with id "${ref.accountId}" exists.`, factRefs: [], recoverable: false };
    if (account.owner.kind !== "character" || account.owner.id !== actorId) {
      return { dimension: "resource_control", result: "fail", reason: `Account "${ref.accountId}" is not controlled by this actor.`, factRefs: [], recoverable: false };
    }
    return { dimension: "resource_control", result: "pass", reason: `Actor controls account "${ref.accountId}".`, factRefs: [], recoverable: true };
  }
  if (ref.forceId !== undefined) {
    const force = world.material.forces.find((f) => f.id === ref.forceId);
    if (!force) return { dimension: "resource_control", result: "fail", reason: `No force with id "${ref.forceId}" exists.`, factRefs: [], recoverable: false };
    if (force.controllerCharacterId !== actorId && force.commanderCharacterId !== actorId) {
      return { dimension: "resource_control", result: "fail", reason: `Force "${ref.forceId}" is not commanded or controlled by this actor.`, factRefs: [], recoverable: false };
    }
    return { dimension: "resource_control", result: "pass", reason: `Actor commands or controls force "${ref.forceId}".`, factRefs: [], recoverable: true };
  }
  return null;
}

function workflowSupport(actionId: string): FeasibilityFinding {
  if (!WORKFLOW_REGISTRY.has(actionId)) {
    return { dimension: "workflow_support", result: "fail", reason: `No registered workflow named "${actionId}" exists yet.`, factRefs: [], recoverable: true };
  }
  return { dimension: "workflow_support", result: "pass", reason: `"${actionId}" is a registered workflow.`, factRefs: [], recoverable: true };
}

function worldConsistency(claims: readonly InterpretedClaim[]): FeasibilityFinding | null {
  const contradicted = claims.filter((c) => c.kind === "world_premise" && c.verification === "contradicted");
  if (contradicted.length === 0) return null;
  return {
    dimension: "world_consistency",
    result: "fail",
    reason: `Contradicted world premise: ${contradicted.map((c) => c.text).join("; ")}`,
    factRefs: contradicted.flatMap((c) => c.contradictionFactIds),
    recoverable: false,
  };
}

function classify(findings: readonly FeasibilityFinding[]): FeasibilityClassification {
  const failing = findings.filter((f) => f.result === "fail");
  if (failing.some((f) => !f.recoverable)) {
    return failing.some((f) => f.dimension === "world_consistency") ? "misinformed" : "impossible";
  }
  if (failing.length > 0) return "unsupported";
  if (findings.some((f) => f.result === "uncertain")) return "clarification_required";
  if (findings.some((f) => f.result === "conditional")) return "conditional";
  return "viable";
}

/**
 * Assesses only the dimensions this function can check purely from world
 * state. Called by the `assess_feasibility` read tool; the GM decides what,
 * if anything, to do with the result.
 */
export function assessFeasibility(input: FeasibilityAssessmentInput): FeasibilityAssessment {
  const findings: FeasibilityFinding[] = [actorExists(input.world, input.actorId)];
  if (input.targetProvinceId != null) findings.push(locationExists(input.world, input.targetProvinceId));
  for (const ref of input.resourceRefs ?? []) {
    const finding = resourceControl(input.world, input.actorId, ref);
    if (finding) findings.push(finding);
  }
  if (input.actionId != null) findings.push(workflowSupport(input.actionId));
  const consistency = worldConsistency(input.claims ?? []);
  if (consistency) findings.push(consistency);
  return { findings, classification: classify(findings) };
}
