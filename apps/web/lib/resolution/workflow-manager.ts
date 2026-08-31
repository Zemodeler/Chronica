import "server-only";

import { randomUUID } from "node:crypto";
import type {
  WorldState,
  WorkflowCandidate,
  WorkflowAuditEntry,
  WorkflowAuditBlob,
  ProposedInvocation,
  Verdict,
} from "@chronica/shared";
import {
  executeWorkflow,
  validateAllCandidates,
} from "@chronica/shared";

// Workflow Manager — validation and dry-run execution layer.
//
// The AI decision step has been moved to the World Director. This module now
// only validates candidates against policy and dry-runs them to verify they
// are applicable to the current world state before executing for real.

export interface WorkflowManagerResult {
  readonly acceptedInvocations: ProposedInvocation[];
  readonly auditBlob: WorkflowAuditBlob;
  readonly managerFailed: boolean;
}

const SOURCE_PRIORITY: Record<string, number> = {
  player_directive: 0,
  reaction_director: 1,
  world_director_synthesis: 2,
  simulator: 3,
  near_event: 4,
  far_event: 5,
  coarse_event: 6,
  character_director: 7,
};

/** Collect player-directive-only candidates (execute_player step). */
export function collectPlayerCandidates(verdicts: readonly Verdict[]): WorkflowCandidate[] {
  const candidates: WorkflowCandidate[] = [];
  for (const verdict of verdicts) {
    for (const delta of verdict.deltas) {
      if (delta.kind === "workflow") {
        candidates.push({
          correlationId: randomUUID(),
          source: "player_directive",
          sourceRef: verdict.directiveId,
          sourceRationale: verdict.rationale.slice(0, 400),
          requestedInvocation: delta.invocation,
        });
      }
    }
  }
  return candidates;
}

/** Collect world-director and reaction-director candidates (execute_world step). */
export function collectWorldCandidates(invocations: ProposedInvocation[], source: WorkflowCandidate["source"]): WorkflowCandidate[] {
  return invocations.map((inv) => ({
    correlationId: randomUUID(),
    source,
    sourceRef: source,
    sourceRationale: `${source} decision`,
    requestedInvocation: inv,
  }));
}

/** Legacy: collect candidates from scope-separated arrays. Kept for any callers that remain. */
export function collectScopedCandidates(
  verdicts: readonly Verdict[],
  nearEvents: readonly { actions: ProposedInvocation[]; triggerId: string; summary?: string }[],
  farEvents: readonly { actions: ProposedInvocation[]; triggerId: string; summary?: string }[],
  coarseEvents: readonly { actions: ProposedInvocation[]; triggerId: string; summary?: string }[],
): WorkflowCandidate[] {
  const candidates = collectPlayerCandidates(verdicts);

  const scopedEvents: Array<[typeof nearEvents, WorkflowCandidate["source"]]> = [
    [nearEvents, "near_event"],
    [farEvents, "far_event"],
    [coarseEvents, "coarse_event"],
  ];
  for (const [evts, source] of scopedEvents) {
    for (const event of evts) {
      for (const action of event.actions) {
        candidates.push({
          correlationId: randomUUID(),
          source,
          sourceRef: event.triggerId,
          sourceRationale: event.summary ?? action.actionId,
          requestedInvocation: action,
        });
      }
    }
  }

  return candidates;
}

/**
 * Validate and dry-run candidates. No AI call — just policy + dry-run.
 * Returns accepted invocations in source-priority order.
 */
export async function runWorkflowManager(
  _adapter: unknown,
  world: WorldState,
  candidates: WorkflowCandidate[],
  atStep: number,
): Promise<WorkflowManagerResult> {
  const auditEntries: WorkflowAuditEntry[] = [];

  if (candidates.length === 0) {
    return {
      acceptedInvocations: [],
      auditBlob: { candidates: [], novelActionProposals: [], managerFailed: false, atStep },
      managerFailed: false,
    };
  }

  // Policy pre-check
  const policyResults = validateAllCandidates(candidates, world);

  // Record policy rejections
  for (const candidate of candidates) {
    const violation = policyResults.get(candidate.correlationId);
    if (violation) {
      auditEntries.push({
        correlationId: candidate.correlationId,
        source: candidate.source,
        sourceRef: candidate.sourceRef,
        requestedActionId: candidate.requestedInvocation.actionId,
        policyViolation: { kind: violation.kind, message: violation.message },
      });
      console.warn(`[workflow-manager] policy reject ${candidate.correlationId}: ${violation.message}`);
    }
  }

  const validCandidates = candidates.filter((c) => policyResults.get(c.correlationId) === null);

  // Sort by source priority
  validCandidates.sort(
    (a, b) => (SOURCE_PRIORITY[a.source] ?? 99) - (SOURCE_PRIORITY[b.source] ?? 99),
  );

  // Dry-run accepted candidates
  const acceptedInvocations: ProposedInvocation[] = [];
  let dryRunWorld = world;

  for (const candidate of validCandidates) {
    auditEntries.push({
      correlationId: candidate.correlationId,
      source: candidate.source,
      sourceRef: candidate.sourceRef,
      requestedActionId: candidate.requestedInvocation.actionId,
      managerDecision: "approve",
      managerReason: "Passed policy checks",
    });

    const outcome = executeWorkflow(candidate.requestedInvocation, dryRunWorld, atStep);
    const entry = auditEntries.at(-1)!;
    if (outcome.ok) {
      acceptedInvocations.push(candidate.requestedInvocation);
      dryRunWorld = outcome.world;
      (entry as unknown as Record<string, unknown>)["dryRunOk"] = true;
    } else {
      (entry as unknown as Record<string, unknown>)["dryRunOk"] = false;
      (entry as unknown as Record<string, unknown>)["executionReason"] = outcome.message;
      console.warn(`[workflow-manager] dry-run rejected ${candidate.correlationId}: ${outcome.message}`);
    }
  }

  return {
    acceptedInvocations,
    auditBlob: { candidates: auditEntries, novelActionProposals: [], managerFailed: false, atStep },
    managerFailed: false,
  };
}
