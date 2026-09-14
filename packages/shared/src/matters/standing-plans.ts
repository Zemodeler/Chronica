import type { WorldState } from "../world/world-state";
import type { WorldInstant } from "../world/instant";
import { checkAuthority, type AuthorityIndex } from "../authority/authority-grant";
import { availableBalance } from "../world/money-reservations";
import { activeReservations, claimedResourcesForStage } from "../actions/reservations";
import { defaultPriorityContextFor, detectResourceConflicts, type PlanConflict, type StageResourceClaim } from "../actions/conflicts";
import type { ActionPlan, ActionPlanStage, ScheduledEventDraft } from "../actions/plans";
import type { WorldMatter } from "./schema";

/**
 * Standing plans and routine continuity (docs/plans/ai-world-matters-runtime.md,
 * "Standing plans and routine continuity"). A matter linked to a standing
 * plan does not need a fresh AI judgment every review -- it continues the
 * already-declared plan through the ordinary stage/event mechanism -- until
 * one of the doc's reopening conditions fires, at which point AI judgment
 * returns.
 */

/** Sets `matter.standingPlanId`. */
export function linkStandingPlan(matter: WorldMatter, planId: string): WorldMatter {
  return { ...matter, standingPlanId: planId };
}

/**
 * The stage a standing plan's continuation replays -- the one repeatable
 * stage carrying a recorded `action` (`repeatEverySteps` non-null is the
 * same field `preparePlayerPlans` already reopens for a player's own
 * repeating stages; this generalizes reading it to a matter-linked plan of
 * any origin, not writing it -- reopening the stage status is a later
 * phase's job, once matter reviews run inside the event loop).
 */
function repeatingStageOf(plan: ActionPlan): ActionPlanStage | null {
  return plan.stages.find((s) => s.repeatEverySteps !== null && s.action !== null) ?? null;
}

/**
 * A follow-up `action_phase` draft for a standing plan's next cadence,
 * exactly mirroring `upgradeActionPlanToScheduledEvents`'s own draft shape.
 * Invariant 8 ("a standing continuation cannot exceed the decision that
 * authorized it"): this draft carries no action or parameters of its own --
 * it only ever names the EXISTING stage's own id, so whatever `execute_plan_stage`
 * runs when this draft's event comes due is exactly `stage.action`, verbatim,
 * with no path for this function to substitute a different or larger call.
 * Returns `null` when the plan has no repeatable stage, or when its
 * `standing` configuration says it is done (past `expiresAtStep`, or the
 * matter's own next review is past `standing.nextReviewStep`).
 */
export function continuationDraftFor(world: WorldState, matter: WorldMatter, plan: ActionPlan, atInstant: WorldInstant): ScheduledEventDraft | null {
  void world;
  if (plan.standing === null) return null;
  const stage = repeatingStageOf(plan);
  if (stage === null) return null;
  const atStep = matter.nextReviewStep;
  if (plan.standing.expiresAtStep !== null && atStep >= plan.standing.expiresAtStep) return null;
  if (atStep < plan.standing.nextReviewStep) return null;
  return {
    kind: "action_phase",
    instant: atInstant,
    subjectRef: { kind: "character", id: stage.actorId },
    payload: { kind: "action_phase", actionId: stage.id },
    actionId: stage.id,
    createdAtStep: atStep,
  };
}

/**
 * Reopening conditions (doc, "A standing plan returns to AI attention
 * when..."). An empty array means the plan may continue unattended; any
 * non-empty result means the caller should clear `matter.standingPlanId`,
 * set the matter back to `"due"`, and skip `continuationDraftFor`.
 *
 * Deliberate limitations, noted rather than guessed around: `ActionPlan`
 * does not record which specific authority grant justified it, so "lost the
 * authorizing grant" is checked against `matter.requiredAuthority` itself --
 * coherent, since the plan exists to answer this exact matter, but it would
 * miss a grant the plan relied on for some OTHER reason unconnected to the
 * matter that spawned it. "Referenced entity's ownership/control changed" is
 * not checked here at all: `ActionPlan` records no owner/controller
 * snapshot to compare against, and fabricating one would be guessing, not
 * reading state -- left for a later phase to add if a standing plan schema
 * gains such a field.
 */
export function standingPlanInvalidations(
  world: WorldState,
  plan: ActionPlan,
  matter: WorldMatter,
  authorityIndex: AuthorityIndex,
  atStep: number,
): readonly string[] {
  const reasons: string[] = [];
  if (plan.standing === null) return reasons;

  const owner = plan.ownerCharacterId === null ? null : world.characters.find((c) => c.id === plan.ownerCharacterId);
  if (plan.ownerCharacterId !== null && (owner === undefined || owner === null || !owner.alive)) {
    reasons.push(`The plan's own author (${plan.ownerCharacterId}) is no longer available.`);
  }

  if (owner?.alive && matter.requiredAuthority.length > 0) {
    const stillAuthorized = matter.requiredAuthority.some((requirement) =>
      checkAuthority(authorityIndex, { holder: { kind: "character", id: owner.id }, domain: requirement.domain, power: requirement.power, scope: requirement.scope }).authorized,
    );
    if (!stillAuthorized) reasons.push("The plan's author no longer holds the authority this matter required.");
  }

  const stage = repeatingStageOf(plan);
  if (stage?.action !== null && stage?.action !== undefined) {
    const accountId = typeof stage.action.parameters.accountId === "string" ? stage.action.parameters.accountId
      : typeof stage.action.parameters.payerAccountId === "string" ? stage.action.parameters.payerAccountId
      : null;
    const amount = typeof stage.action.parameters.amount === "number" ? stage.action.parameters.amount : 0;
    if (accountId !== null && amount > 0 && availableBalance(world.material, accountId) < amount) {
      reasons.push(`The account this plan spends from cannot currently cover the ${amount} it authorized.`);
    }

    const myClaims: StageResourceClaim[] = claimedResourcesForStage(stage.actorId, stage.action.parameters).map((claim) => ({
      planId: plan.id,
      stageId: stage.id,
      kind: claim.kind,
      resourceId: claim.resourceId,
      priorityContext: defaultPriorityContextFor(plan.origin),
      updatedAtStep: plan.updatedAtStep,
    }));
    const otherClaims: StageResourceClaim[] = (world.plans ?? [])
      .filter((p) => p.id !== plan.id)
      .flatMap((p) => p.stages.filter((s) => s.status === "in_progress" || s.status === "ready" || s.status === "pending").flatMap((s) =>
        s.action === null ? [] : claimedResourcesForStage(s.actorId, s.action.parameters).map((claim) => ({
          planId: p.id, stageId: s.id, kind: claim.kind, resourceId: claim.resourceId,
          priorityContext: defaultPriorityContextFor(p.origin), updatedAtStep: p.updatedAtStep,
        }))));
    const conflicts: readonly PlanConflict[] = detectResourceConflicts([...myClaims, ...otherClaims]);
    if (conflicts.some((c) => c.claims.some((claim) => claim.planId === plan.id))) {
      reasons.push("Another plan now claims a resource this standing plan also depends on.");
    }

    const reservedByOthers = activeReservations(world.stageReservations ?? []).filter((r) => r.planId !== plan.id);
    if (myClaims.some((claim) => reservedByOthers.some((r) => r.kind === claim.kind && r.resourceId === claim.resourceId))) {
      reasons.push("Another plan holds an exclusive reservation on a resource this standing plan depends on.");
    }
  }

  if (plan.options.budget !== null && plan.spent >= plan.options.budget.amount) {
    reasons.push(`The plan's own spending limit (${plan.options.budget.amount}) has been reached.`);
  }

  if (plan.standing.expiresAtStep !== null && atStep >= plan.standing.expiresAtStep) {
    reasons.push("The plan's standing authorization has expired.");
  }

  return reasons;
}
