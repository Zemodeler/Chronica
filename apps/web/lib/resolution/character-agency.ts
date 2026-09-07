import "server-only";

import type {
  CandidateAction,
  CharacterSelectionTier,
  ContinuityTier,
  ProposedInvocation,
  WorkflowAuditEntry,
  WorldState,
} from "@chronica/shared";

// Character agency execution helpers (character-sim phase 3).
//
// A chosen candidate never mutates anything directly: it becomes a
// `ProposedInvocation` for a real, registered workflow, offered to the Game
// Master as a formed intention (docs/30). This module only ever builds that
// proposal; it never executes it.
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
    // docs/30: these three used to be executed directly by the pipeline
    // (character-agency/commitments.ts's plain functions); they are now
    // registered workflows (packages/shared/.../npc-agency.ts) the Game
    // Master must actually invoke, like every other formed intention.
    case "fulfill_commitment":
    case "defer_commitment":
    case "break_commitment": {
      if (candidate.sourceCommitmentId === null) return null;
      return {
        actionId: candidate.actionType,
        actorId: candidate.actorCharacterId,
        parameters: candidate.actionType === "fulfill_commitment"
          ? { commitmentId: candidate.sourceCommitmentId }
          : { commitmentId: candidate.sourceCommitmentId, reason: candidate.rationale.slice(0, 240) },
      };
    }
    // docs/32: the promisor no longer controls what was originally promised;
    // proposes new terms instead of only fulfilling, deferring, or breaking.
    case "renegotiate_commitment": {
      if (candidate.sourceCommitmentId === null) return null;
      return {
        actionId: "renegotiate_commitment",
        actorId: candidate.actorCharacterId,
        parameters: {
          commitmentId: candidate.sourceCommitmentId,
          description: candidate.rationale.slice(0, 400),
          requiredResource: candidate.requiredResource,
          requiredOfficeId: candidate.requiredOfficeId,
        },
      };
    }
    // docs/30: these used to be applied immediately via buildIntentSocialEvent
    // the instant a candidate scored highest; they are now offered as a
    // formed intention through the registered record_character_social_action
    // workflow instead, so the target, kind, and reason are the Game
    // Master's call, not a pre-computed effect. docs/32 adds two more kinds
    // to the same fixed-magnitude table (npc-agency.ts's SOCIAL_ACTION_EFFECT).
    case "threaten":
    case "reconcile":
    case "offer_favour":
    case "negotiate":
    case "publicly_oppose":
    case "seek_support":
    case "request_assistance": {
      const targetCharacterId = candidate.targetIds[0];
      if (targetCharacterId === undefined) return null;
      return {
        actionId: "record_character_social_action",
        actorId: candidate.actorCharacterId,
        parameters: { targetCharacterId, kind: candidate.actionType, reasonLabel: candidate.rationale.slice(0, 200) },
      };
    }
    // docs/32: relocates to a province an active plot already names.
    case "travel": {
      const destinationProvinceId = candidate.targetIds[0];
      if (destinationProvinceId === undefined) return null;
      return {
        actionId: "move_character",
        actorId: candidate.actorCharacterId,
        parameters: { characterId: candidate.actorCharacterId, destinationProvinceId },
      };
    }
    // docs/32: opens the political procedure `candidates.ts` identified as
    // missing (an appointment prerequisite, or a removal against a rival)
    // -- everything the candidate itself could not know (institution,
    // eligibility requirements, participants) is left null/empty for the
    // Game Master's own live read-tool judgement, not invented here.
    case "sponsor_procedure": {
      const subjectId = candidate.targetIds[0];
      if (subjectId === undefined || candidate.proposedProcedure === undefined) return null;
      return {
        actionId: "sponsor_procedure",
        actorId: candidate.actorCharacterId,
        parameters: {
          procedureId: `procedure-${candidate.actorCharacterId}-${subjectId}`,
          type: candidate.proposedProcedure.type,
          institutionId: null,
          sponsorCharacterId: candidate.actorCharacterId,
          subjectKind: candidate.proposedProcedure.subjectKind,
          subjectId,
          linkedWorkflowId: candidate.proposedProcedure.linkedWorkflowId,
          linkedWorkflowParams: {},
          eligibilityRequirementIds: [],
          eligibleParticipantIds: [],
          resolutionMechanism: candidate.proposedProcedure.resolutionMechanism,
          visibility: "polity",
          deadlineStep: null,
          sourceEventIds: [],
        },
      };
    }
    // docs/32: raises confidence on a suspicion the actor already holds --
    // self-targeted, no recipient.
    case "investigate": {
      if (candidate.sourceBeliefId === undefined) return null;
      return {
        actionId: "investigate",
        actorId: candidate.actorCharacterId,
        parameters: { beliefId: candidate.sourceBeliefId },
      };
    }
    // docs/32: shares a claim the actor already holds with another character,
    // reading the belief's own canonical subject/kind rather than
    // reconstructing them, the same way `advance_plot` reads its plot.
    case "spread_belief": {
      const targetCharacterId = candidate.targetIds[0];
      const belief = candidate.sourceBeliefId === undefined
        ? undefined
        : world.characterBeliefs.find((b) => b.id === candidate.sourceBeliefId);
      if (targetCharacterId === undefined || belief === undefined) return null;
      return {
        actionId: "spread_belief",
        actorId: candidate.actorCharacterId,
        parameters: {
          targetCharacterId,
          subjectEntityId: belief.subjectEntityId,
          claim: belief.claim,
          kind: belief.kind,
        },
      };
    }
    // docs/32: gives battle to an enemy force sharing the same ground.
    case "military_action": {
      const enemyForceId = candidate.targetIds[0];
      const ownForce = world.material.forces.find((f) => f.commanderCharacterId === candidate.actorCharacterId);
      if (enemyForceId === undefined || ownForce === undefined) return null;
      return {
        actionId: "start_battle",
        actorId: candidate.actorCharacterId,
        parameters: {
          battleId: `battle-${candidate.actorCharacterId}-${ownForce.locationId}`,
          attackingForceIds: [ownForce.id],
          defendingForceIds: [enemyForceId],
        },
      };
    }
    default:
      return null;
  }
}
