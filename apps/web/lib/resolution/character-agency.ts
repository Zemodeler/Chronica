import "server-only";

import type {
  CandidateAction,
  CharacterIntentActionType,
  CharacterSelectionTier,
  CharacterSocialEvent,
  ContinuityTier,
  ProposedInvocation,
  WorkflowAuditEntry,
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

/**
 * A formed NPC intention offered to the Game Master as a concrete, executable
 * proposal -- never executed here. The agent is the one authority on what the
 * world does this turn, so this carries the exact `ProposedInvocation`
 * `buildIntentInvocation` produced, not a paraphrase the Game Master would
 * have to reconstruct from a description.
 */
export interface FormedNpcProposal {
  readonly intentId: string;
  readonly actorCharacterId: string;
  readonly actionType: string;
  readonly rationale: string;
  readonly workflowIds: readonly string[];
  readonly invocation: ProposedInvocation;
}

/**
 * Whether a character has explicit, scenario-authored agency state right
 * now: an active goal, an active or stalled plot, or an active pressure. This
 * is deliberately narrow -- commanding a force, or scoring well in selection,
 * is not enough on its own -- so it admits exactly the characters someone
 * gave a real stake in something, never "every background commander" a
 * scenario happens to name.
 */
export function hasActiveAgencyState(world: WorldState, characterId: string): boolean {
  if ((world.characterGoals ?? []).some((goal) => goal.characterId === characterId && goal.status === "active")) return true;
  if ((world.characterPlots ?? []).some((plot) => plot.characterId === characterId && (plot.status === "active" || plot.status === "stalled"))) return true;
  return (world.characterPressures ?? []).some((pressure) => pressure.characterId === characterId && pressure.status === "active");
}

/**
 * Whether a selected character gets full candidate generation (up to one
 * primary action) this turn, rather than only advancing an existing coarse
 * plan or being skipped entirely.
 *
 * Continuity tier "principal" is earned over several turns of sustained
 * relevance, so gating agency on it alone left a leader seeded THIS turn
 * (`ensurePolityLeadership`) -- with no continuity history yet -- a
 * character the deterministic selector itself just ranked as this turn's
 * most relevant ("persistent") -- and an ordinary "important"-tier NPC the
 * scenario itself gave a real stake in something (a goal, a plot, a pressure)
 * -- silent for no reason but bookkeeping lag. All three are treated as
 * eligible here, alongside the existing continuity-earned "principal" path.
 * The last one is deliberately data-driven rather than tier-driven: it admits
 * exactly the characters someone gave explicit scenario relevance, not every
 * "important"-tier force commander a selector happens to notice.
 */
export function isEligibleForNpcAgency(
  continuityTier: ContinuityTier | undefined,
  isSeededThisTurn: boolean,
  selectionTier: CharacterSelectionTier,
  hasActiveAgencyStateFlag: boolean,
): boolean {
  return continuityTier === "principal" || isSeededThisTurn || selectionTier === "persistent" || hasActiveAgencyStateFlag;
}

/** A subset match: every key the proposal named must agree; the executed call may carry additional fields the proposal did not constrain. */
function parametersMatch(proposed: Record<string, unknown>, executed: Record<string, unknown>): boolean {
  return Object.entries(proposed).every(([key, value]) => JSON.stringify(executed[key]) === JSON.stringify(value));
}

export interface FormedNpcIntentOutcome {
  readonly status: "executed" | "deferred";
  readonly reason: string;
}

/**
 * Resolve a formed NPC proposal against what the Game Master actually did
 * this turn -- never against what was proposed. Matched on actor, workflow
 * id, and the proposal's own parameters (a subset match: the agent may
 * reasonably have added or adjusted fields the proposal did not constrain).
 *
 * A proposal that was attempted and refused carries the engine's own reason
 * forward rather than a generic one, so a deferral is never silently
 * indistinguishable from continuity-only bookkeeping.
 */
export function resolveFormedNpcIntentOutcome(
  proposal: FormedNpcProposal,
  executedInvocations: readonly ProposedInvocation[],
  auditEntries: readonly WorkflowAuditEntry[],
): FormedNpcIntentOutcome {
  const acted = executedInvocations.some(
    (invocation) =>
      invocation.actorId === proposal.actorCharacterId
      && invocation.actionId === proposal.invocation.actionId
      && parametersMatch(proposal.invocation.parameters, invocation.parameters),
  );
  if (acted) return { status: "executed", reason: "Carried out this turn." };

  const conflictingAudit = auditEntries.find(
    (entry) =>
      entry.requestedInvocation.actorId === proposal.actorCharacterId
      && entry.requestedActionId === proposal.invocation.actionId
      && entry.executionOk === false,
  );
  return {
    status: "deferred",
    reason: conflictingAudit !== undefined
      ? `Attempted but refused: ${conflictingAudit.executionReason ?? "no reason recorded."}`
      : "Formed but not carried out this turn; the Game Master did not invoke the proposed workflow.",
  };
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
