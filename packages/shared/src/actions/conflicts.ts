import type { ActionPlan, ActionPlanOrigin, ActionPlanStage } from "./plans";
import { releaseStageReservations, type ResourceReservation } from "./reservations";

/**
 * Priorities, conflicts, and preemption (docs/32, Phase 4).
 *
 * Priority is applied only after authority/ownership checks elsewhere have
 * already passed; it decides who wins when two plans genuinely compete for
 * the same resource, never whether either one is allowed at all.
 *
 * Only conflicts over a resource's *identity* (the same character's time,
 * the same force, the same account, the same office) are detected here,
 * deterministically. "Incompatible destinations" and "contradictory
 * diplomatic positions" reduce to the same-force/same-office case once a
 * caller names the actual resource in contention; "mutually exclusive
 * objectives" and "conflicting constraints" need semantic judgment this
 * module deliberately does not manufacture -- the same honesty stance
 * `feasibility.ts` takes about dimensions it cannot check.
 */
export type PlanPriorityContext =
  | "new_instruction"
  | "revision"
  | "existing_plan"
  | "delegated_work"
  | "npc_self_directed"
  | "world_background";

/** Lower ranks win. New instructions and revisions outrank standing work; standing work outranks the world's own background plans. */
const PLAN_PRIORITY_RANK: Record<PlanPriorityContext, number> = {
  new_instruction: 1,
  revision: 2,
  existing_plan: 3,
  delegated_work: 4,
  npc_self_directed: 5,
  world_background: 6,
};

export function priorityRank(context: PlanPriorityContext): number {
  return PLAN_PRIORITY_RANK[context];
}

/**
 * The priority context a plan falls into absent an explicit new submission
 * or revision this turn -- callers that just created or revised a plan
 * should pass `"new_instruction"`/`"revision"` directly instead of this.
 */
export function defaultPriorityContextFor(origin: ActionPlanOrigin): PlanPriorityContext {
  if (origin.kind === "player") return "existing_plan";
  if (origin.kind === "npc") return "npc_self_directed";
  return "world_background";
}

export type ConflictResourceKind = "character_time" | "force" | "account" | "office";

export interface StageResourceClaim {
  readonly planId: string;
  readonly stageId: string;
  readonly kind: ConflictResourceKind;
  readonly resourceId: string;
  readonly priorityContext: PlanPriorityContext;
  /** Tie-break only: the later-updated plan wins when priority context is identical. */
  readonly updatedAtStep: number;
}

export interface PlanConflict {
  readonly kind: ConflictResourceKind;
  readonly resourceId: string;
  readonly claims: readonly StageResourceClaim[];
}

/**
 * Conflicts are only ever detected across *different* plans. Two stages of
 * the same plan claiming the same resource in sequence (one depends on the
 * other) is ordinary scheduling, not a conflict -- `dependsOn` already
 * enforces that they cannot both be `in_progress` at once.
 */
export function detectResourceConflicts(claims: readonly StageResourceClaim[]): PlanConflict[] {
  const groups = new Map<string, StageResourceClaim[]>();
  for (const claim of claims) {
    const key = `${claim.kind}:${claim.resourceId}`;
    const group = groups.get(key);
    if (group) group.push(claim); else groups.set(key, [claim]);
  }
  const conflicts: PlanConflict[] = [];
  for (const group of groups.values()) {
    const distinctPlans = new Set(group.map((c) => c.planId));
    if (distinctPlans.size < 2) continue;
    conflicts.push({ kind: group[0]!.kind, resourceId: group[0]!.resourceId, claims: group });
  }
  return conflicts;
}

function winningClaim(claims: readonly StageResourceClaim[]): StageResourceClaim {
  return claims.reduce((best, candidate) => {
    const bestRank = priorityRank(best.priorityContext);
    const candidateRank = priorityRank(candidate.priorityContext);
    if (candidateRank < bestRank) return candidate;
    if (candidateRank > bestRank) return best;
    return candidate.updatedAtStep >= best.updatedAtStep ? candidate : best;
  });
}

/** Every losing stage id across a batch of conflicts, with the reason its plan should record. */
export function resolveConflicts(conflicts: readonly PlanConflict[]): ReadonlyMap<string, string> {
  const losers = new Map<string, string>();
  for (const conflict of conflicts) {
    const winner = winningClaim(conflict.claims);
    for (const claim of conflict.claims) {
      if (claim.stageId === winner.stageId && claim.planId === winner.planId) continue;
      losers.set(claim.stageId, `Superseded: a higher-priority plan claimed the same ${conflict.kind.replace("_", " ")} (${conflict.resourceId}).`);
    }
  }
  return losers;
}

function preemptedStage(stage: ActionPlanStage, reason: string): ActionPlanStage {
  // Rule #8 (docs/32): completed effects are never reversed merely because a plan is revised or preempted.
  if (stage.status === "completed" || stage.status === "failed" || stage.status === "superseded") return stage;
  if (stage.status === "in_progress") return { ...stage, status: "interrupted", statusReason: reason };
  return { ...stage, status: "superseded", statusReason: reason };
}

/**
 * Applies preemption to every losing stage: a pending/ready/blocked stage is
 * superseded, an in-progress stage is interrupted, and reservations it still
 * held are released. Nothing already completed is touched (rule #8).
 */
export function applyPreemption(
  plans: readonly ActionPlan[],
  losingStageIds: ReadonlyMap<string, string>,
  reservations: readonly ResourceReservation[],
  atStep: number,
): { plans: ActionPlan[]; reservations: ResourceReservation[] } {
  if (losingStageIds.size === 0) return { plans: [...plans], reservations: [...reservations] };
  let nextReservations = reservations;
  const nextPlans = plans.map((plan) => {
    let touched = false;
    const stages = plan.stages.map((stage) => {
      const reason = losingStageIds.get(stage.id);
      if (reason === undefined) return stage;
      const updated = preemptedStage(stage, reason);
      if (updated !== stage) {
        touched = true;
        nextReservations = releaseStageReservations(nextReservations, stage.id, atStep);
      }
      return updated;
    });
    return touched ? { ...plan, stages, updatedAtStep: atStep } : plan;
  });
  return { plans: nextPlans, reservations: [...nextReservations] };
}
