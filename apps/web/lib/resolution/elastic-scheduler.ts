import "server-only";

import type { FactualEvent, PlayerPlan, ScenarioClock, StopReason } from "@chronica/shared";
import { daysPerStep, estimateWorkflowDurationDays } from "@chronica/shared";

// Elastic simulation scheduler (docs/32, Phase 7) -- SHADOW MODE ONLY.
//
// `decideElasticStop` is a pure function implementing the roadmap's
// stop-condition priority order and day-level math. It does not yet decide
// how long a turn actually runs: `pipeline.ts` still resolves exactly one
// turn per call and still commits `elapsedStepEnd`/`stopReason` exactly as
// it did before this phase. This module's decision is computed alongside
// that, and only the *new*, previously-always-null `turns.elapsed_day_end` /
// `stopping_fact_ids` / `requested_player_decision` columns (docs/32 Phase 6)
// receive it -- so this phase can start collecting real shadow-mode data
// (docs/32 Phase 16: compare stop decisions before ever exposing elastic
// time to players) without changing one bit of live turn-advancement
// behavior.
//
// Only dimensions this function can genuinely detect today produce a
// finding: an explicit mandatory-decision signal (an NPC-initiated dialogue
// this turn, or a plan with outstanding clarification questions) and the
// day-level max span. The remaining dimensions from docs/32's priority list
// -- an irreversible player-involving event, a watch condition, a plan
// interruption, a scenario-defined salience threshold -- have no upstream
// detection anywhere in the codebase yet (no watch-condition mechanism
// exists; `ActionPlan`'s interruption tracking is not wired into the live
// write path until Phase 9). Rather than manufacture an answer, this module
// accepts them as caller-supplied, empty by default -- the same honesty
// stance `feasibility.ts` and `conflicts.ts` already take about dimensions
// they cannot check.

export interface ElasticSchedulerInput {
  readonly elapsedStepStart: number;
  readonly scenarioClock?: ScenarioClock | undefined;
  readonly factualEvents: readonly FactualEvent[];
  /** Every plan touched this turn, across every owner -- `PlayerPlan` today, `ActionPlan` once Phase 9 unifies the write path. */
  readonly plans: readonly PlayerPlan[];
  /** A direct attack, death, succession, betrayal, or surrender involving the player this turn. Not yet detected anywhere -- pass explicitly once an upstream source exists. */
  readonly irreversibleEventFactIds?: readonly string[];
  /** A scenario-authored watch condition became true. No watch-condition mechanism exists yet. */
  readonly watchConditionFactIds?: readonly string[];
  /** A plan stage was interrupted by preemption this turn (docs/32, Phase 4/9). Not yet populated -- `ActionPlan` isn't the live write path yet. */
  readonly planInterruptionFactIds?: readonly string[];
  /** A scenario-defined salience threshold was crossed. No such threshold mechanism exists yet. */
  readonly thresholdCrossedFactIds?: readonly string[];
}

export interface ElasticStopDecision {
  readonly elapsedDayStart: number;
  readonly elapsedDayEnd: number;
  /**
   * Null when nothing this function can check fired and max span was not
   * reached -- meaning an actual elastic scheduler would have kept
   * advancing past this turn's boundary instead of stopping here. This is
   * exactly the shadow-mode signal docs/32 Phase 16 asks for: how often
   * would elastic time have returned control where today's fixed one-step
   * cadence does anyway.
   */
  readonly stopReason: StopReason | null;
  readonly stoppingFactIds: readonly string[];
  readonly requestedPlayerDecision: string | null;
}

const FLAG_NPC_INITIATED_DIALOGUE_ACTION_ID = "flag_npc_initiated_dialogue";

function mandatoryPlayerDecision(
  factualEvents: readonly FactualEvent[],
  plans: readonly PlayerPlan[],
): { factIds: string[]; description: string } | null {
  const dialogueFacts = factualEvents.filter((event) => event.actionId === FLAG_NPC_INITIATED_DIALOGUE_ACTION_ID);
  if (dialogueFacts.length > 0) {
    return { factIds: dialogueFacts.map((event) => event.id), description: "A character wants to speak with you." };
  }
  const clarifying = plans.filter((plan) => plan.clarificationQuestions.length > 0);
  if (clarifying.length > 0) {
    return {
      factIds: clarifying.map((plan) => plan.id),
      description: clarifying.flatMap((plan) => plan.clarificationQuestions).join(" "),
    };
  }
  return null;
}

/**
 * Computes this turn's shadow elastic-scheduler decision. Pure, and never
 * itself advances or stops anything -- see the module comment above.
 */
export function decideElasticStop(input: ElasticSchedulerInput): ElasticStopDecision {
  const daysThisTurn = Math.max(1, estimateWorkflowDurationDays(input.factualEvents.map((event) => event.actionId)));
  const elapsedDayStart = Math.round(input.elapsedStepStart * daysPerStep(input.scenarioClock));
  const elapsedDayEnd = elapsedDayStart + daysThisTurn;
  const base = { elapsedDayStart, elapsedDayEnd };

  const decision = mandatoryPlayerDecision(input.factualEvents, input.plans);
  if (decision !== null) {
    return { ...base, stopReason: "player_decision", stoppingFactIds: decision.factIds, requestedPlayerDecision: decision.description };
  }
  const clarification = input.plans.find((plan) => plan.clarificationQuestions.length > 0);
  if (clarification !== undefined) {
    return { ...base, stopReason: "clarification_required", stoppingFactIds: [clarification.id], requestedPlayerDecision: clarification.clarificationQuestions.join(" ") };
  }
  // "Immediately" reasons (docs/32): an irreversible player-involving event
  // bypasses minSpan, same as the mandatory-decision/clarification checks above.
  if ((input.irreversibleEventFactIds?.length ?? 0) > 0) {
    return { ...base, stopReason: "salient_event", stoppingFactIds: [...input.irreversibleEventFactIds!], requestedPlayerDecision: null };
  }
  // Routine reasons: below minSpan, the clock does not stop for these --
  // it keeps players from being woken for trivia (docs/32, `ScenarioClock.minSpan`).
  const minSpanDays = (input.scenarioClock?.minSpan ?? 0) * daysPerStep(input.scenarioClock);
  const spanSoFarDays = elapsedDayEnd - elapsedDayStart;
  if (spanSoFarDays >= minSpanDays) {
    if ((input.watchConditionFactIds?.length ?? 0) > 0) {
      return { ...base, stopReason: "watch_condition", stoppingFactIds: [...input.watchConditionFactIds!], requestedPlayerDecision: null };
    }
    if ((input.planInterruptionFactIds?.length ?? 0) > 0) {
      return { ...base, stopReason: "plan_interrupted", stoppingFactIds: [...input.planInterruptionFactIds!], requestedPlayerDecision: null };
    }
    if ((input.thresholdCrossedFactIds?.length ?? 0) > 0) {
      return { ...base, stopReason: "threshold_crossed", stoppingFactIds: [...input.thresholdCrossedFactIds!], requestedPlayerDecision: null };
    }
  }
  const maxSpanDays = (input.scenarioClock?.maxSpan ?? Infinity) * daysPerStep(input.scenarioClock);
  if (spanSoFarDays >= maxSpanDays) {
    return { ...base, stopReason: "max_span", stoppingFactIds: [], requestedPlayerDecision: null };
  }
  // Nothing this function can check fired, and max span was not reached: an
  // actual elastic scheduler would have kept advancing past this boundary.
  return { ...base, stopReason: null, stoppingFactIds: [], requestedPlayerDecision: null };
}
