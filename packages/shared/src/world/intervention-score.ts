import type { PlanConflict } from "../actions/conflicts";
import { priorityRank } from "../actions/conflicts";
import type { StopReason } from "./clock";
import type { Fact, InterventionSeverity } from "./facts";

/**
 * The real player-intervention threshold (unified action runtime,
 * "Player-intervention threshold"). Computed alongside, and independently
 * of, `resolution/elastic-scheduler.ts`'s existing shadow-mode
 * `decideElasticStop` -- this module owns only the score and the hard-stop
 * checks; nothing here decides how long a turn runs or writes to any
 * pipeline state. Wiring this in as the live stop condition is a later,
 * separate cutover (see the unified-action-runtime plan's Stage 5).
 *
 * Deliberately structural rather than tied to `PlayerPlan`/`ActionPlan`
 * directly: both shapes carry `clarificationQuestions`/`options.budget`/
 * `spent`, so a caller on either side of that cutover can use this as-is.
 */
export interface InterventionPlanLike {
  readonly id: string;
  readonly clarificationQuestions: readonly string[];
  readonly spent: number;
  readonly options: { readonly budget: { readonly accountId: string; readonly amount: number } | null };
}

/** A fact whose `actionId` follows this convention flags that an NPC initiated a dialogue the player must answer (matches `elastic-scheduler.ts`'s existing detector). */
const NPC_INITIATED_DIALOGUE_ACTION_ID = "flag_npc_initiated_dialogue";

/** Point value awarded for each severity level, out of one factor's declared maximum. */
function severityPoints(severity: InterventionSeverity, max: number): number {
  switch (severity) {
    case "none": return 0;
    case "minor": return Math.round(max / 3);
    case "moderate": return Math.round((max * 2) / 3);
    case "major": return max;
  }
}

const FACTOR_MAX = {
  irreversibility: 30,
  deviationFromPlan: 25,
  directPlayerInvolvement: 20,
  strategicConsequence: 15,
  uncertainty: 10,
} as const;

export type InterventionFactor = keyof typeof FACTOR_MAX;

export interface InterventionScoreBreakdown {
  readonly irreversibility: number;
  readonly deviationFromPlan: number;
  readonly directPlayerInvolvement: number;
  readonly strategicConsequence: number;
  readonly uncertainty: number;
}

export interface InterventionDecision {
  /** Non-null when a hard stop fired -- these bypass the score entirely, per the design's "regardless of score" rule. */
  readonly hardStopReason: StopReason | null;
  readonly requestedPlayerDecision: string | null;
  /** 0-100. Only meaningful when `hardStopReason` is null -- a hard stop always requires intervention regardless of this value. */
  readonly score: number;
  readonly breakdown: InterventionScoreBreakdown;
  /** True when either a hard stop fired or the score met/exceeded the threshold. */
  readonly requiresIntervention: boolean;
  /** Every fact/plan id that contributed to the stop -- a hard stop's cause, or (for a score-based stop) whichever facts supplied the highest-scoring factor. */
  readonly contributingFactIds: readonly string[];
}

export interface InterventionScoreInput {
  /** Every Fact produced since the last decision point. */
  readonly facts: readonly Fact[];
  /** Every plan touched in this window, across every owner. */
  readonly plans: readonly InterventionPlanLike[];
  /** Resource conflicts detected this window (`actions/conflicts.ts`'s `detectResourceConflicts`), if the caller has them. */
  readonly conflicts?: readonly PlanConflict[];
  /**
   * World matter ids `matterPriorityActors` routed to the player instead of
   * an autonomous NPC pass this window (docs/plans/ai-world-matters-runtime.md,
   * Phase 6 -- "Player intervention": "the player holds the responsibility
   * and no standing instruction answers it"). A non-empty list is always a
   * hard stop -- categorical, since the doc frames this as the player's own
   * responsibility going unanswered, not a matter of degree a score could
   * weigh against other factors.
   */
  readonly playerResponsibleMatterIds?: readonly string[];
  /** Default 60, per the design doc. Scenario rules may override; one campaign must keep its selected threshold stable. */
  readonly threshold?: number;
}

const DEFAULT_THRESHOLD = 60;

/**
 * Hard stops that bypass the score entirely (unified action runtime,
 * "Some conditions are hard stops... regardless of score"):
 *
 * - a plan has an outstanding clarification question;
 * - an NPC initiated a dialogue the player must answer;
 * - a plan's actual spend has exceeded its own stated budget;
 * - two plans contend for the same resource with no explicit newer
 *   instruction breaking the tie (both landed at the same priority rank);
 * - a fact is both irreversible and genuinely uncertain in its outcome --
 *   "the player must choose among materially different responses before
 *   an irreversible action can proceed."
 */
function findHardStop(input: InterventionScoreInput): { reason: StopReason; description: string | null; factIds: string[] } | null {
  const playerResponsibleMatterIds = input.playerResponsibleMatterIds ?? [];
  if (playerResponsibleMatterIds.length > 0) {
    return {
      reason: "salient_event",
      description: "A matter needing your attention has no standing instruction to answer it.",
      factIds: [...playerResponsibleMatterIds],
    };
  }

  const dialogueFacts = input.facts.filter((fact) => fact.kind === NPC_INITIATED_DIALOGUE_ACTION_ID);
  if (dialogueFacts.length > 0) {
    return { reason: "salient_event", description: "A character wants to speak with you.", factIds: dialogueFacts.map((f) => f.id) };
  }

  const clarifying = input.plans.filter((plan) => plan.clarificationQuestions.length > 0);
  if (clarifying.length > 0) {
    return {
      reason: "clarification_required",
      description: clarifying.flatMap((plan) => plan.clarificationQuestions).join(" "),
      factIds: clarifying.map((plan) => plan.id),
    };
  }

  const overBudget = input.plans.filter((plan) => plan.options.budget !== null && plan.spent > plan.options.budget.amount);
  if (overBudget.length > 0) {
    return {
      reason: "threshold_crossed",
      description: "A plan's actual spending has exceeded the limit you set for it.",
      factIds: overBudget.map((plan) => plan.id),
    };
  }

  for (const conflict of input.conflicts ?? []) {
    const ranks = conflict.claims.map((claim) => priorityRank(claim.priorityContext)).sort((a, b) => a - b);
    if (ranks.length >= 2 && ranks[0] === ranks[1]) {
      return {
        reason: "plan_interrupted",
        description: `Two of your standing plans both claim the same ${conflict.kind.replace("_", " ")} (${conflict.resourceId}), with no newer instruction to say which one should give way.`,
        factIds: conflict.claims.map((claim) => claim.planId),
      };
    }
  }

  const irreversibleAndUncertain = input.facts.filter(
    (fact) => fact.interventionSignals.irreversibility === "major" && fact.interventionSignals.uncertainty !== "none",
  );
  if (irreversibleAndUncertain.length > 0) {
    return {
      reason: "salient_event",
      description: "An irreversible action is pending, and more than one materially different response is available.",
      factIds: irreversibleAndUncertain.map((f) => f.id),
    };
  }

  return null;
}

function scoreForFactor(facts: readonly Fact[], factor: InterventionFactor): { points: number; factIds: string[] } {
  const max = FACTOR_MAX[factor];
  let bestPoints = 0;
  let bestFactIds: string[] = [];
  for (const fact of facts) {
    const points = severityPoints(fact.interventionSignals[factor], max);
    if (points > bestPoints) {
      bestPoints = points;
      bestFactIds = [fact.id];
    } else if (points === bestPoints && points > 0) {
      bestFactIds.push(fact.id);
    }
  }
  return { points: bestPoints, factIds: bestFactIds };
}

/**
 * Computes the player-intervention decision for one resolution window's
 * accumulated facts and plans. Pure, deterministic, and side-effect-free --
 * see the module comment for what this deliberately does not yet do.
 */
export function computeInterventionScore(input: InterventionScoreInput): InterventionDecision {
  const hardStop = findHardStop(input);
  if (hardStop !== null) {
    return {
      hardStopReason: hardStop.reason,
      requestedPlayerDecision: hardStop.description,
      score: 100,
      breakdown: { irreversibility: 0, deviationFromPlan: 0, directPlayerInvolvement: 0, strategicConsequence: 0, uncertainty: 0 },
      requiresIntervention: true,
      contributingFactIds: hardStop.factIds,
    };
  }

  const irreversibility = scoreForFactor(input.facts, "irreversibility");
  const deviationFromPlan = scoreForFactor(input.facts, "deviationFromPlan");
  const directPlayerInvolvement = scoreForFactor(input.facts, "directPlayerInvolvement");
  const strategicConsequence = scoreForFactor(input.facts, "strategicConsequence");
  const uncertainty = scoreForFactor(input.facts, "uncertainty");

  const breakdown: InterventionScoreBreakdown = {
    irreversibility: irreversibility.points,
    deviationFromPlan: deviationFromPlan.points,
    directPlayerInvolvement: directPlayerInvolvement.points,
    strategicConsequence: strategicConsequence.points,
    uncertainty: uncertainty.points,
  };
  const score = Math.min(100, breakdown.irreversibility + breakdown.deviationFromPlan + breakdown.directPlayerInvolvement + breakdown.strategicConsequence + breakdown.uncertainty);
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const requiresIntervention = score >= threshold;

  const contributingFactIds = requiresIntervention
    ? [...new Set([...irreversibility.factIds, ...deviationFromPlan.factIds, ...directPlayerInvolvement.factIds, ...strategicConsequence.factIds, ...uncertainty.factIds])]
    : [];

  return {
    hardStopReason: null,
    requestedPlayerDecision: null,
    score,
    breakdown,
    requiresIntervention,
    contributingFactIds,
  };
}
