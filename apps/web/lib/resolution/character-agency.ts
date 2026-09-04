import "server-only";

import type {
  CandidateAction,
  CharacterIntentActionType,
  CharacterSocialEvent,
  ProposedInvocation,
  WorldState,
} from "@chronica/shared";

// Character agency execution helpers (character-sim phase 3).
//
// Two kinds of state a chosen action can produce, both already validated
// before either function below is called:
//
//  - A material/bookkeeping change goes through a real, registered workflow
//    Since the Game Master refactor the invocation it builds is offered to
//    the agent as a formed intention rather than executed for it, so this
//    still only ever builds; it never mutates anything.
//  - A pure social consequence (a threat, an attempt at reconciliation) has
//    no material effect and instead becomes a `CharacterSocialEvent`,
//    applied through the exact same `applySocialEvents` ledger dialogue
//    already uses -- one boundary for every relation-cause change in the
//    game, chat-originated or agency-originated.
//
// Neither path invents a target, an office, a resource, or a workflow that
// candidate generation (`character-agency/candidates.ts`) did not already
// name from real world state.

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
