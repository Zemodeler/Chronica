import "server-only";

import type {
  CandidateAction,
  CharacterIntentActionType,
  CharacterSocialEvent,
  CharacterSuggestion,
  ProposedInvocation,
  WorldState,
} from "@chronica/shared";

// Character agency execution helpers (character-sim phase 3).
//
// Two kinds of state a chosen action can produce, both already validated
// before either function below is called:
//
//  - A material/bookkeeping change goes through a real, registered workflow
//    (the same `runWorkflowManager`/`executeWorkflows` gate every player and
//    World Director action already passes through) -- `buildXInvocation`
//    below only ever builds the invocation; it never mutates anything.
//  - A pure social consequence (a threat, an attempt at reconciliation) has
//    no material effect and instead becomes a `CharacterSocialEvent`,
//    applied through the exact same `applySocialEvents` ledger dialogue
//    already uses -- one boundary for every relation-cause change in the
//    game, chat-originated or agency-originated.
//
// Neither path invents a target, an office, a resource, or a workflow that
// candidate generation (`character-agency/candidates.ts`) did not already
// name from real world state.

/** An approved goal/plot suggestion becomes an invocation of the existing character-agency workflows. */
export function buildCharacterSuggestionInvocation(
  suggestion: CharacterSuggestion,
  actorCharacterId: string,
): ProposedInvocation | null {
  switch (suggestion.suggestionKind) {
    case "create_goal": {
      if (suggestion.proposedGoal === null) return null;
      return {
        actionId: "create_character_goal",
        actorId: actorCharacterId,
        parameters: {
          characterId: suggestion.characterId,
          objective: suggestion.proposedGoal.objective,
          category: suggestion.proposedGoal.category,
          targetEntityIds: suggestion.proposedGoal.targetEntityIds,
          priority: suggestion.proposedGoal.priority,
          visibility: suggestion.proposedGoal.visibility,
        },
      };
    }
    case "update_goal": {
      if (suggestion.goalId === null) return null;
      return {
        actionId: "update_character_goal",
        actorId: actorCharacterId,
        parameters: {
          goalId: suggestion.goalId,
          ...(suggestion.goalStatus !== null ? { status: suggestion.goalStatus } : {}),
          note: suggestion.rationale.slice(0, 240) || "Updated.",
        },
      };
    }
    case "create_plot": {
      if (suggestion.proposedPlot === null) return null;
      return {
        actionId: "create_character_plot",
        actorId: actorCharacterId,
        parameters: {
          characterId: suggestion.characterId,
          goalId: suggestion.proposedPlot.goalId,
          objective: suggestion.proposedPlot.objective,
          participantIds: suggestion.proposedPlot.participantIds,
          targetIds: suggestion.proposedPlot.targetIds,
          visibility: suggestion.proposedPlot.visibility,
          stakes: suggestion.proposedPlot.stakes,
          currentObstacle: suggestion.proposedPlot.currentObstacle,
          worldStorylineId: suggestion.storylineId,
        },
      };
    }
    case "advance_plot": {
      if (suggestion.plotId === null || suggestion.plotStage === null) return null;
      return {
        actionId: "advance_character_plot",
        actorId: actorCharacterId,
        parameters: {
          plotId: suggestion.plotId,
          newStage: suggestion.plotStage,
          note: suggestion.rationale.slice(0, 240) || `Advanced to ${suggestion.plotStage}.`,
        },
      };
    }
    case "resolve_plot": {
      if (suggestion.plotId === null || suggestion.plotResolutionStatus === null) return null;
      return {
        actionId: "resolve_character_plot",
        actorId: actorCharacterId,
        parameters: {
          plotId: suggestion.plotId,
          status: suggestion.plotResolutionStatus,
          note: suggestion.rationale.slice(0, 240) || `Resolved: ${suggestion.plotResolutionStatus}.`,
        },
      };
    }
    // "react" and "develop_relationship" carry no goal/plot mutation -- they
    // are narrative-only advisory notes, same as before this phase.
    default:
      return null;
  }
}

const PLOT_STAGE_SEQUENCE = ["forming", "preparing", "attempting", "consequence", "adapting", "resolved"] as const;

function nextPlotStage(currentStage: string): (typeof PLOT_STAGE_SEQUENCE)[number] {
  const index = PLOT_STAGE_SEQUENCE.indexOf(currentStage as (typeof PLOT_STAGE_SEQUENCE)[number]);
  return PLOT_STAGE_SEQUENCE[Math.min(index + 1, PLOT_STAGE_SEQUENCE.length - 1)]!;
}

/** A chosen candidate whose `legalWorkflowIds` names a real, registered workflow. Returns null if the candidate cannot be translated (should not happen for a legal candidate). */
export function buildIntentInvocation(candidate: CandidateAction, world: WorldState): ProposedInvocation | null {
  switch (candidate.actionType) {
    case "advance_plot": {
      const plot = (world.characterPlots ?? []).find((p) => p.id === candidate.sourcePlotId);
      if (plot === undefined) return null;
      return {
        actionId: "advance_character_plot",
        actorId: candidate.actorCharacterId,
        parameters: {
          plotId: plot.id,
          newStage: nextPlotStage(plot.stage),
          note: candidate.rationale.slice(0, 240),
        },
      };
    }
    case "seek_office": {
      if (candidate.requiredOfficeId === null) return null;
      return {
        actionId: "appoint_to_office",
        actorId: candidate.actorCharacterId,
        parameters: { characterId: candidate.actorCharacterId, officeId: candidate.requiredOfficeId },
      };
    }
    case "economic_action": {
      if (candidate.requiredResource === null) return null;
      return {
        actionId: "remove_gold",
        actorId: candidate.actorCharacterId,
        parameters: {
          accountId: candidate.requiredResource.accountId,
          amount: candidate.requiredResource.minAmount,
          reason: candidate.rationale.slice(0, 240),
        },
      };
    }
    default:
      return null;
  }
}

/** Dimension + direction a pure social action moves, and the social-event kind it is recorded as. */
const SOCIAL_ACTION_EFFECT: Partial<Record<CharacterIntentActionType, {
  kind: CharacterSocialEvent["kind"];
  dimension: "affection" | "trust" | "fear" | "respect" | "obligation";
  delta: number;
}>> = {
  threaten: { kind: "insult", dimension: "fear", delta: 15 },
  reconcile: { kind: "favour", dimension: "affection", delta: 12 },
  offer_favour: { kind: "favour", dimension: "affection", delta: 10 },
  negotiate: { kind: "conversation", dimension: "trust", delta: 6 },
  publicly_oppose: { kind: "insult", dimension: "respect", delta: -12 },
};

/**
 * A pure social candidate becomes a `CharacterSocialEvent` applied through
 * the same ledger dialogue uses -- never a bespoke mutation path. Returns
 * null for an action with no target or no modeled social effect (e.g. wait,
 * prepare, travel): those are legitimate, deliberate no-ops this phase.
 */
export function buildIntentSocialEvent(
  candidate: CandidateAction,
  atStep: number,
  gameId: string,
): CharacterSocialEvent | null {
  const effect = SOCIAL_ACTION_EFFECT[candidate.actionType];
  if (effect === undefined || candidate.targetIds.length === 0) return null;
  const targetId = candidate.targetIds[0]!;
  const eventId = `intent-social-${candidate.actorCharacterId}-${atStep}`;
  return {
    id: eventId,
    gameId,
    sourceTurnId: null,
    sourceSessionId: null,
    sourceMessageId: null,
    participantCharacterIds: [candidate.actorCharacterId, targetId],
    kind: effect.kind,
    visibility: "polity",
    knownByCharacterIds: [candidate.actorCharacterId, targetId],
    relationCauses: [{
      subjectCharacterId: targetId,
      targetCharacterId: candidate.actorCharacterId,
      label: candidate.expectedEffectSummary,
      score: effect.delta,
      decayPerYearBps: 3_000,
      dimensions: { [effect.dimension]: effect.delta },
    }],
    knowledgeClaims: [],
    proposedBeliefs: [],
    pressureChanges: [],
    commitmentProposal: null,
    introducedCharacter: null,
    introducedProfile: null,
    createdAtStep: atStep,
    appliedAtStep: null,
    appliedInTurnId: null,
    status: "proposed",
    rejectionReason: null,
  };
}
