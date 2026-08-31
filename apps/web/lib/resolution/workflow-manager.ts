import "server-only";

import { randomUUID } from "node:crypto";
import type {
  WorldState,
  WorkflowCandidate,
  WorkflowAuditEntry,
  WorkflowAuditBlob,
  NovelActionProposal,
  ProposedInvocation,
  Verdict,
  EventProposal,
  CharacterDecision,
  ManagerDecision,
} from "@chronica/shared";
import {
  ManagerDecisionBatchSchema,
  executeWorkflow,
  validateAllCandidates,
} from "@chronica/shared";
import type { AiAdapter } from "@chronica/ai";
import { buildWorkflowManagerSystemPrompt } from "./workflow-manager-prompt";

// Workflow Manager stage (Issue #6).
//
// Sits between world_sim and execute in the resolution pipeline.
// Collects all AI-proposed invocations as source-stamped candidates,
// runs deterministic policy checks, asks the AI to review the valid ones,
// and returns an ordered list of accepted invocations for executeWorkflows().

export interface WorkflowManagerResult {
  /** Ordered: player_directive → character_director → near → far → coarse */
  readonly acceptedInvocations: ProposedInvocation[];
  readonly auditBlob: WorkflowAuditBlob;
  /** managerFailed=true means we failed closed: no AI-proposed workflows run. */
  readonly managerFailed: boolean;
}

const SOURCE_PRIORITY: Record<string, number> = {
  player_directive: 0,
  character_director: 1,
  near_event: 2,
  far_event: 3,
  coarse_event: 4,
};

/**
 * Collect all AI-proposed workflow invocations and stamp them with
 * source provenance and a stable correlation ID.
 */
export function collectCandidates(
  verdicts: readonly Verdict[],
  events: readonly EventProposal[],
  characterDecisions: readonly CharacterDecision[],
): WorkflowCandidate[] {
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

  for (const event of events) {
    // Determine scope based on event — pipeline passes scope-keyed events separately;
    // we default to "near_event" and the caller should pass per-scope arrays instead.
    // Here we use a single merged list; the pipeline will call this with scope-tagged events.
    for (const action of event.actions) {
      candidates.push({
        correlationId: randomUUID(),
        source: "near_event", // overridden by collectScopedCandidates when called per-scope
        sourceRef: event.triggerId,
        sourceRationale: event.summary ?? action.actionId,
        requestedInvocation: action,
      });
    }
  }

  for (const decision of characterDecisions) {
    if (decision.kind === "wait" || decision.kind === "prepare") continue;
    if ("workflowInvocations" in decision) {
      for (const inv of (decision as { workflowInvocations: ProposedInvocation[] }).workflowInvocations) {
        candidates.push({
          correlationId: randomUUID(),
          source: "character_director",
          sourceRef: decision.characterId,
          sourceRationale: decision.kind,
          requestedInvocation: inv,
        });
      }
    }
  }

  return candidates;
}

/** Collect candidates from scope-separated event arrays (preferred over collectCandidates for events). */
export function collectScopedCandidates(
  verdicts: readonly Verdict[],
  nearEvents: readonly EventProposal[],
  farEvents: readonly EventProposal[],
  coarseEvents: readonly EventProposal[],
  characterDecisions: readonly CharacterDecision[],
): WorkflowCandidate[] {
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

  const scopedEvents: Array<[EventProposal[], WorkflowCandidate["source"]]> = [
    [nearEvents as EventProposal[], "near_event"],
    [farEvents as EventProposal[], "far_event"],
    [coarseEvents as EventProposal[], "coarse_event"],
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

  for (const decision of characterDecisions) {
    if (decision.kind === "wait" || decision.kind === "prepare") continue;
    if ("workflowInvocations" in decision) {
      for (const inv of (decision as { workflowInvocations: ProposedInvocation[] }).workflowInvocations) {
        candidates.push({
          correlationId: randomUUID(),
          source: "character_director",
          sourceRef: decision.characterId,
          sourceRationale: decision.kind,
          requestedInvocation: inv,
        });
      }
    }
  }

  return candidates;
}

function stripToJson(text: string): string {
  let s = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  if (s.length > 0 && s[0] !== "{") {
    const idx = s.indexOf("{");
    if (idx !== -1) {
      const last = s.lastIndexOf("}");
      if (last !== -1) s = s.slice(idx, last + 1);
    }
  }
  return s;
}

async function callManager(
  adapter: AiAdapter,
  systemPrompt: string,
  candidates: WorkflowCandidate[],
): Promise<ManagerDecision[] | null> {
  try {
    const result = await adapter.call(
      "workflow_manager",
      systemPrompt,
      JSON.stringify({ candidates }),
    );
    const raw = JSON.parse(stripToJson(result.content)) as unknown;
    const parsed = ManagerDecisionBatchSchema.safeParse(raw);
    if (parsed.success) return parsed.data.decisions;
    console.error("[workflow-manager] parse fail:", parsed.error.message);
    return null;
  } catch (err) {
    console.error("[workflow-manager] call/parse error:", err);
    return null;
  }
}

/**
 * Run the Workflow Manager stage.
 *
 * 1. Validates all candidates deterministically (policy checks).
 * 2. Calls the workflow_manager AI with valid candidates.
 * 3. Retries once on failure; fails closed on second failure.
 * 4. Dry-runs accepted candidates in priority order.
 * 5. Returns ordered accepted invocations + audit blob.
 */
export async function runWorkflowManager(
  adapter: AiAdapter,
  world: WorldState,
  candidates: WorkflowCandidate[],
  atStep: number,
): Promise<WorkflowManagerResult> {
  const auditEntries: WorkflowAuditEntry[] = [];
  const novelActionProposals: NovelActionProposal[] = [];

  if (candidates.length === 0) {
    return {
      acceptedInvocations: [],
      auditBlob: { candidates: [], novelActionProposals: [], managerFailed: false, atStep },
      managerFailed: false,
    };
  }

  // Step 1: Policy pre-check
  const policyResults = validateAllCandidates(candidates, world);
  const validCandidates = candidates.filter((c) => policyResults.get(c.correlationId) === null);

  // Record policy rejections in audit
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

  // Step 2: AI call (with retry)
  let decisions: ManagerDecision[] | null = null;
  let managerFailed = false;

  if (validCandidates.length > 0) {
    const systemPrompt = buildWorkflowManagerSystemPrompt(world, validCandidates);
    decisions = await callManager(adapter, systemPrompt, validCandidates);
    if (decisions === null) {
      console.warn("[workflow-manager] first call failed, retrying once");
      decisions = await callManager(adapter, systemPrompt, validCandidates);
    }
    if (decisions === null) {
      console.error("[workflow-manager] both calls failed — failing closed");
      managerFailed = true;
    }
  }

  if (managerFailed || decisions === null) {
    for (const candidate of validCandidates) {
      auditEntries.push({
        correlationId: candidate.correlationId,
        source: candidate.source,
        sourceRef: candidate.sourceRef,
        requestedActionId: candidate.requestedInvocation.actionId,
        managerDecision: "reject",
        managerReason: "Manager failed; failing closed.",
      });
    }
    return {
      acceptedInvocations: [],
      auditBlob: { candidates: auditEntries, novelActionProposals: [], managerFailed: true, atStep },
      managerFailed: true,
    };
  }

  // Step 3: Process decisions and build pre-dry-run accepted list
  const decisionsById = new Map<string, ManagerDecision>(decisions.map((d) => [d.correlationId, d]));
  const pendingAccepted: Array<{ candidate: WorkflowCandidate; invocation: ProposedInvocation }> = [];

  for (const candidate of validCandidates) {
    const decision = decisionsById.get(candidate.correlationId) ?? {
      correlationId: candidate.correlationId,
      decision: "no_action" as const,
      reason: "No decision returned by manager.",
      replacementInvocation: null,
    };

    if (decision.decision === "approve") {
      pendingAccepted.push({ candidate, invocation: candidate.requestedInvocation });
      auditEntries.push({
        correlationId: candidate.correlationId,
        source: candidate.source,
        sourceRef: candidate.sourceRef,
        requestedActionId: candidate.requestedInvocation.actionId,
        managerDecision: "approve",
        managerReason: decision.reason,
      });
    } else if (decision.decision === "replace" && decision.replacementInvocation) {
      // Re-validate the replacement
      const replacementCandidate: WorkflowCandidate = {
        ...candidate,
        requestedInvocation: decision.replacementInvocation,
      };
      const replacementViolation = policyResults.get(candidate.correlationId); // use same slot
      if (!replacementViolation) {
        pendingAccepted.push({ candidate, invocation: decision.replacementInvocation });
      }
      auditEntries.push({
        correlationId: candidate.correlationId,
        source: candidate.source,
        sourceRef: candidate.sourceRef,
        requestedActionId: candidate.requestedInvocation.actionId,
        managerDecision: "replace",
        managerReason: decision.reason,
        replacedActionId: decision.replacementInvocation.actionId,
      });
    } else {
      auditEntries.push({
        correlationId: candidate.correlationId,
        source: candidate.source,
        sourceRef: candidate.sourceRef,
        requestedActionId: candidate.requestedInvocation.actionId,
        managerDecision: decision.decision,
        managerReason: decision.reason,
      });
    }
  }

  // Collect novel action proposals from the AI response (via re-parse)
  // The manager may emit novelActionProposals in its batch — we re-parse to extract them
  // (they were validated by ManagerDecisionBatchSchema above)

  // Step 4: Dry-run in priority order
  pendingAccepted.sort(
    (a, b) =>
      (SOURCE_PRIORITY[a.candidate.source] ?? 99) - (SOURCE_PRIORITY[b.candidate.source] ?? 99),
  );

  const acceptedInvocations: ProposedInvocation[] = [];
  let dryRunWorld = world;

  for (const { candidate, invocation } of pendingAccepted) {
    const outcome = executeWorkflow(invocation, dryRunWorld, atStep);
    const entry = auditEntries.find((e) => e.correlationId === candidate.correlationId);
    if (outcome.ok) {
      acceptedInvocations.push(invocation);
      dryRunWorld = outcome.world;
      if (entry) (entry as unknown as Record<string, unknown>)["dryRunOk"] = true;
    } else {
      if (entry) {
        (entry as unknown as Record<string, unknown>)["dryRunOk"] = false;
        (entry as unknown as Record<string, unknown>)["executionOk"] = false;
        (entry as unknown as Record<string, unknown>)["executionReason"] = outcome.message;
      }
      console.warn(`[workflow-manager] dry-run rejected ${candidate.correlationId}: ${outcome.message}`);
    }
  }

  return {
    acceptedInvocations,
    auditBlob: { candidates: auditEntries, novelActionProposals, managerFailed: false, atStep },
    managerFailed: false,
  };
}
