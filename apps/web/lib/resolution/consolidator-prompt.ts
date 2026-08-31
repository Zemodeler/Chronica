import "server-only";

import { randomUUID } from "node:crypto";
import type {
  CharacterSuggestion,
  ReactionProposal,
  SimulatorProposal,
  ConsolidatedProposal,
  ConsolidatedProposalPackage,
} from "@chronica/shared";

// Consolidator — deterministic deduplication of director proposals.
//
// Sits between the three directors and the World Director. Merges identical
// or overlapping proposals so the World Director sees a clean, ranked package.
// Deterministic: no AI call; fingerprint-based deduplication.

function proposalFingerprint(actionId: string, actorId: string): string {
  return `${actionId}::${actorId}`;
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

  // ── Character Director suggestions (translated to proposals; no workflow invocations) ──
  for (const cs of characterSuggestions) {
    if (cs.salience === 0) continue; // skip background-only suggestions

    const id = randomUUID();
    consolidated.push({
      id,
      sources: ["character_director"],
      kind: cs.suggestionKind,
      mergedRationale: cs.rationale,
      proposedWorkflows: [], // CD suggestions carry no workflow invocations
      salience: cs.salience * 10,
      scopeTag: "near",
      dedupeGroup: cs.storylineId ?? undefined,
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
