import "server-only";

import { randomUUID } from "node:crypto";
import type {
  CharacterSuggestion,
  ReactionProposal,
  SimulatorProposal,
  ConsolidatedProposal,
  ConsolidatedProposalPackage,
  ProposedInvocation,
} from "@chronica/shared";

// Consolidator — deterministic deduplication of director proposals.
//
// Sits between the three directors and the World Director. Merges identical
// or overlapping proposals so the World Director sees a clean, ranked package.
// Deterministic: no AI call; fingerprint-based deduplication.

function proposalFingerprint(actionId: string, actorId: string): string {
  return `${actionId}::${actorId}`;
}

/** Translate an approved advisory suggestion into its bounded agency workflow. */
function characterSuggestionWorkflows(suggestion: CharacterSuggestion): ProposedInvocation[] {
  const actorId = suggestion.characterId;
  if (suggestion.suggestionKind === "create_goal" && suggestion.proposedGoal) {
    return [{ actionId: "create_character_goal", actorId, parameters: { characterId: actorId, ...suggestion.proposedGoal } }];
  }
  if (suggestion.suggestionKind === "update_goal" && suggestion.goalId) {
    return [{
      actionId: "update_character_goal",
      actorId,
      parameters: {
        goalId: suggestion.goalId,
        ...(suggestion.goalStatus ? { status: suggestion.goalStatus } : {}),
        ...(suggestion.proposedGoal ? { priority: suggestion.proposedGoal.priority } : {}),
        note: suggestion.rationale.slice(0, 240),
      },
    }];
  }
  if (suggestion.suggestionKind === "create_plot" && suggestion.proposedPlot) {
    return [{
      actionId: "create_character_plot",
      actorId,
      parameters: { characterId: actorId, ...suggestion.proposedPlot, worldStorylineId: suggestion.storylineId },
    }];
  }
  if (suggestion.suggestionKind === "advance_plot" && suggestion.plotId && suggestion.plotStage) {
    return [{
      actionId: "advance_character_plot",
      actorId,
      parameters: {
        plotId: suggestion.plotId,
        newStage: suggestion.plotStage,
        ...(suggestion.proposedPlot ? { obstacle: suggestion.proposedPlot.currentObstacle } : {}),
        note: suggestion.rationale.slice(0, 240),
      },
    }];
  }
  if (suggestion.suggestionKind === "resolve_plot" && suggestion.plotId && suggestion.plotResolutionStatus) {
    return [{
      actionId: "resolve_character_plot",
      actorId,
      parameters: { plotId: suggestion.plotId, status: suggestion.plotResolutionStatus, note: suggestion.rationale.slice(0, 240) },
    }];
  }
  return [];
}

/**
 * Merge proposals from all three directors into a ranked, deduplicated package
 * suitable for the World Director.
 */
export function consolidateProposals(
  characterSuggestions: readonly CharacterSuggestion[],
  reactionProposals: readonly ReactionProposal[],
  simulatorProposals: readonly SimulatorProposal[],
): ConsolidatedProposalPackage {
  const consolidated: ConsolidatedProposal[] = [];
  const conflicts: Array<{ proposalIds: string[]; description: string }> = [];
  const seen = new Map<string, string>(); // fingerprint → proposal id

  // ── Reaction Director proposals (highest priority — NEAR scope, player-caused) ──
  for (const rp of reactionProposals) {
    const id = randomUUID();
    const dedupeKeys: string[] = [];

    for (const wf of rp.proposedWorkflows) {
      const key = proposalFingerprint(wf.actionId, wf.actorId);
      const prior = seen.get(key);
      if (prior) {
        conflicts.push({ proposalIds: [prior, id], description: `Duplicate workflow ${wf.actionId} by ${wf.actorId}` });
      } else {
        seen.set(key, id);
        dedupeKeys.push(key);
      }
    }

    consolidated.push({
      id,
      sources: ["reaction_director"],
      kind: rp.reactionKind,
      mergedRationale: rp.rationale,
      proposedWorkflows: rp.proposedWorkflows,
      salience: rp.salience * 10,
      scopeTag: "near",
      dedupeGroup: rp.causalVerdictId,
    });
  }

  // ── Simulator proposals ───────────────────────────────────────────────────
  for (const sp of simulatorProposals) {
    const id = randomUUID();

    for (const wf of sp.proposedWorkflows) {
      const key = proposalFingerprint(wf.actionId, wf.actorId);
      const prior = seen.get(key);
      if (prior) {
        conflicts.push({ proposalIds: [prior, id], description: `Duplicate workflow ${wf.actionId} by ${wf.actorId}` });
        // Still add to consolidated but flag the conflict
      } else {
        seen.set(key, id);
      }
    }

    consolidated.push({
      id,
      sources: ["simulator"],
      kind: sp.kind,
      mergedRationale: sp.summary,
      proposedWorkflows: sp.proposedWorkflows,
      salience: sp.salience * 10,
      scopeTag: sp.scopeTag,
      dedupeGroup: sp.storylineId ?? undefined,
    });
  }

  // ── Character Director suggestions (translated deterministically to bounded agency workflows) ──
  for (const cs of characterSuggestions) {
    if (cs.salience === 0) continue; // skip background-only suggestions

    const id = randomUUID();
    consolidated.push({
      id,
      sources: ["character_director"],
      kind: cs.suggestionKind,
      mergedRationale: cs.rationale,
      proposedWorkflows: characterSuggestionWorkflows(cs),
      salience: cs.salience * 10,
      scopeTag: "near",
      dedupeGroup: cs.storylineId ?? undefined,
      characterId: cs.characterId,
    });
  }

  // Sort by salience descending
  consolidated.sort((a, b) => b.salience - a.salience);

  return {
    proposals: consolidated.slice(0, 32),
    conflicts: conflicts.slice(0, 8),
    totalSalience: consolidated.reduce((s, p) => s + p.salience, 0),
  };
}
