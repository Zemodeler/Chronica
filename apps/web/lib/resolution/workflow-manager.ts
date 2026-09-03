import "server-only";

import { randomUUID } from "node:crypto";
import type { AiAdapter } from "@chronica/ai";
import type {
  ManagerDecision,
  ManagerDecisionBatch,
  ProposedInvocation,
  RuntimeInventedWorkflow,
  Verdict,
  WorkflowAuditBlob,
  WorkflowAuditEntry,
  WorkflowCandidate,
  WorldState,
} from "@chronica/shared";
import {
  ManagerDecisionBatchSchema,
  executeWorkflow,
  validateAllCandidates,
  validateCandidate,
  WORKFLOW_REGISTRY,
} from "@chronica/shared";
import { buildWorkflowManagerSystemPrompt } from "./workflow-manager-prompt";

// The single AI review gate before a turn is committed. It receives structured
// workflow candidates only; raw player language never reaches this module.

export interface WorkflowManagerResult {
  readonly acceptedInvocations: ProposedInvocation[];
  /** Active templates required to execute the accepted invocations this turn. */
  readonly runtimeInventedWorkflows: RuntimeInventedWorkflow[];
  /** Newly created templates to persist only after the turn commits successfully. */
  readonly createdInventedWorkflows: RuntimeInventedWorkflow[];
  readonly auditBlob: WorkflowAuditBlob;
}

export class WorkflowManagerOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowManagerOutputError";
  }
}

export function collectPlayerCandidates(verdicts: readonly Verdict[]): WorkflowCandidate[] {
  const candidates: WorkflowCandidate[] = [];
  for (const verdict of verdicts) {
    for (const delta of verdict.deltas) {
      if (delta.kind !== "workflow") continue;
      candidates.push({
        correlationId: randomUUID(),
        source: "player_directive",
        sourceRef: verdict.directiveId,
        sourceRationale: verdict.rationale.slice(0, 400),
        requestedInvocation: delta.invocation,
      });
    }
  }
  return candidates;
}

/**
 * Character-sim phase 3: workflow invocations chosen by the character agency
 * system (goal/plot bookkeeping from an approved `CharacterSuggestion`, or a
 * material action from a scored, conflict-resolved `CharacterIntent`).
 * Tagged with the correct `"character_director"` source so policy, audit,
 * and diagnostics attribute them to the character who chose them rather than
 * to the World Director.
 */
export function collectCharacterAgencyCandidates(
  invocations: readonly { invocation: ProposedInvocation; sourceRef: string; sourceRationale: string }[],
): WorkflowCandidate[] {
  return invocations.map(({ invocation, sourceRef, sourceRationale }) => ({
    correlationId: randomUUID(),
    source: "character_director",
    sourceRef,
    sourceRationale: sourceRationale.slice(0, 400),
    requestedInvocation: invocation,
  }));
}

/** Retain World Director proposal provenance for the final review. */
export function collectWorldCandidates(
  invocations: readonly { invocation: ProposedInvocation; sourceRef: string; sourceRationale: string }[],
): WorkflowCandidate[] {
  return invocations.map(({ invocation, sourceRef, sourceRationale }) => ({
    correlationId: randomUUID(),
    source: "world_director_synthesis",
    sourceRef,
    sourceRationale: sourceRationale.slice(0, 400),
    requestedInvocation: invocation,
  }));
}

/**
 * Non-persistent, conservative preview for directors. The final Manager still
 * receives every candidate and is the only authority that permits a commit.
 */
export function previewPlayerWorkflows(
  world: WorldState,
  candidates: readonly WorkflowCandidate[],
  atStep: number,
  inventedWorkflows: readonly RuntimeInventedWorkflow[] = [],
): WorldState {
  const policy = validateAllCandidates(candidates, world, inventedWorkflows);
  let preview = world;
  for (const candidate of candidates) {
    if (policy.get(candidate.correlationId) !== null) continue;
    const outcome = executeWorkflow(candidate.requestedInvocation, preview, atStep, inventedWorkflows);
    if (outcome.ok) preview = outcome.world;
  }
  return preview;
}

function parseManagerOutput(text: string): ManagerDecisionBatch {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim());
  } catch (error) {
    throw new WorkflowManagerOutputError(`Workflow Manager returned invalid JSON: ${String(error)}`);
  }
  const parsed = ManagerDecisionBatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkflowManagerOutputError(`Workflow Manager response failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

function assertCompleteDecisionSet(
  candidates: readonly WorkflowCandidate[],
  decisions: readonly ManagerDecision[],
): Map<string, ManagerDecision> {
  if (decisions.length !== candidates.length) {
    throw new WorkflowManagerOutputError(`Workflow Manager returned ${decisions.length} decisions for ${candidates.length} candidates.`);
  }
  const expected = new Set(candidates.map((candidate) => candidate.correlationId));
  const byCorrelation = new Map<string, ManagerDecision>();
  for (const decision of decisions) {
    if (!expected.has(decision.correlationId)) throw new WorkflowManagerOutputError(`Unknown correlationId: ${decision.correlationId}.`);
    if (byCorrelation.has(decision.correlationId)) throw new WorkflowManagerOutputError(`Duplicate decision for ${decision.correlationId}.`);
    if (decision.decision === "replace" && decision.replacementInvocation === null) {
      throw new WorkflowManagerOutputError(`Replacement for ${decision.correlationId} is missing an invocation.`);
    }
    if (decision.decision !== "replace" && decision.replacementInvocation !== null) {
      throw new WorkflowManagerOutputError(`Non-replacement decision ${decision.correlationId} supplied a replacement.`);
    }
    byCorrelation.set(decision.correlationId, decision);
  }
  if (byCorrelation.size !== expected.size) throw new WorkflowManagerOutputError("A candidate is missing a decision.");
  return byCorrelation;
}

function auditBase(candidate: WorkflowCandidate): WorkflowAuditEntry {
  return {
    correlationId: candidate.correlationId,
    source: candidate.source,
    sourceRef: candidate.sourceRef,
    requestedActionId: candidate.requestedInvocation.actionId,
    requestedInvocation: candidate.requestedInvocation,
  };
}

async function requestCompleteDecisions(
  adapter: AiAdapter,
  prompt: string,
  candidates: readonly WorkflowCandidate[],
  atStep: number,
): Promise<ManagerDecisionBatch> {
  const initialMessage = `Step ${atStep}: review and repair the proposed workflow sequence.`;
  const parse = (content: string) => {
    const batch = parseManagerOutput(content);
    assertCompleteDecisionSet(candidates, batch.decisions);
    if (batch.novelActionProposals.length > 0) throw new WorkflowManagerOutputError("One-turn temporary patches are retired; use inventedWorkflowProposals.");
    for (const proposal of batch.inventedWorkflowProposals) {
      const matchingCandidates = candidates.filter((candidate) => candidate.source === proposal.source && candidate.sourceRef === proposal.sourceRef);
      const replacesRejectedCandidate = matchingCandidates.some((candidate) =>
        batch.decisions.find((item) => item.correlationId === candidate.correlationId)?.decision === "reject",
      );
      if (!replacesRejectedCandidate) throw new WorkflowManagerOutputError("An invented workflow must replace a rejected candidate.");
      if (proposal.initialInvocation.actionId !== proposal.workflow.actionId) throw new WorkflowManagerOutputError("Invented workflow initial invocation must use its actionId.");
    }
    return batch;
  };

  try {
    const response = await adapter.call("workflow_manager", prompt, initialMessage);
    return parse(response.content);
  } catch (error) {
    if (!(error instanceof WorkflowManagerOutputError)) throw error;

    // Models occasionally copy or fabricate a UUID. A single correction pass
    // is safe because nothing has been dry-run or committed at this point.
    const allowedIds = candidates.map((candidate) => candidate.correlationId).join(", ");
    const retryMessage = `Your previous Workflow Manager response was invalid: ${error.message}\nReturn the complete JSON again. Use exactly one of these correlationIds for each decision, with no others: ${allowedIds}`;
    const retry = await adapter.call("workflow_manager", prompt, retryMessage);
    return parse(retry.content);
  }
}

/** Ask AI to repair candidates, then enforce its result deterministically. */
export async function runWorkflowManager(
  adapter: AiAdapter,
  world: WorldState,
  candidates: WorkflowCandidate[],
  atStep: number,
  gameId = "",
  activeInventedWorkflows: readonly RuntimeInventedWorkflow[] = [],
): Promise<WorkflowManagerResult> {
  if (candidates.length === 0) {
    return { acceptedInvocations: [], runtimeInventedWorkflows: [...activeInventedWorkflows], createdInventedWorkflows: [], auditBlob: { candidates: [], novelActionProposals: [], managerFailed: false, atStep } };
  }

  const originalPolicy = validateAllCandidates(candidates, world, activeInventedWorkflows);
  const diagnostics = candidates.map((candidate) => ({
    correlationId: candidate.correlationId,
    violation: originalPolicy.get(candidate.correlationId) ?? null,
  }));
  const prompt = buildWorkflowManagerSystemPrompt(world, candidates, diagnostics, activeInventedWorkflows);
  let managerBatch: ManagerDecisionBatch;
  let managerFailed = false;
  try {
    managerBatch = await requestCompleteDecisions(adapter, prompt, candidates, atStep);
  } catch (error) {
    if (!(error instanceof WorkflowManagerOutputError)) throw error;
    console.error(`[workflow-manager] AI review failed after retry — auto-approving policy-valid candidates: ${error.message}`);
    managerFailed = true;
    managerBatch = {
      decisions: candidates.map((candidate) => ({
        correlationId: candidate.correlationId,
        decision: "approve" as const,
        reason: "Workflow Manager unavailable — approved by policy validation.",
        replacementInvocation: null,
      })),
      novelActionProposals: [],
      inventedWorkflowProposals: [],
    };
  }
  const decisions = new Map(managerBatch.decisions.map((decision) => [decision.correlationId, decision]));

  const auditEntries: WorkflowAuditEntry[] = [];
  const acceptedInvocations: ProposedInvocation[] = [];
  const runtimeInventedWorkflows = [...activeInventedWorkflows];
  const createdInventedWorkflows: RuntimeInventedWorkflow[] = [];
  const seen = new Set<string>();
  let dryRunWorld = world;

  for (const candidate of candidates) {
    const decision = decisions.get(candidate.correlationId)!;
    const entry: WorkflowAuditEntry = {
      ...auditBase(candidate),
      managerDecision: decision.decision,
      managerReason: decision.reason,
      ...(decision.replacementInvocation
        ? { replacedActionId: decision.replacementInvocation.actionId, replacementInvocation: decision.replacementInvocation }
        : {}),
    };
    if (decision.decision === "reject" || decision.decision === "no_action") {
      auditEntries.push(entry);
      continue;
    }

    const finalInvocation = decision.decision === "replace" ? decision.replacementInvocation! : candidate.requestedInvocation;
    const finalCandidate: WorkflowCandidate = { ...candidate, requestedInvocation: finalInvocation };
    const policyViolation = validateCandidate(finalCandidate, dryRunWorld, runtimeInventedWorkflows);
    const duplicateKey = `${finalInvocation.actionId}:${finalInvocation.actorId}`;
    const duplicateViolation = seen.has(duplicateKey)
      ? { kind: "duplicate", message: `Duplicate final invocation: ${finalInvocation.actionId} by ${finalInvocation.actorId}.` }
      : null;
    if (policyViolation || duplicateViolation) {
      const violation = policyViolation ?? duplicateViolation!;
      auditEntries.push({ ...entry, policyViolation: violation, dryRunOk: false, executionReason: violation.message });
      continue;
    }

    const outcome = executeWorkflow(finalInvocation, dryRunWorld, atStep, runtimeInventedWorkflows);
    if (!outcome.ok) {
      auditEntries.push({ ...entry, finalInvocation, dryRunOk: false, executionReason: outcome.message });
      continue;
    }
    seen.add(duplicateKey);
    dryRunWorld = outcome.world;
    acceptedInvocations.push(finalInvocation);
    auditEntries.push({ ...entry, finalInvocation, dryRunOk: true });
  }

  // Newly invented workflows are valid only when they replace a rejected
  // candidate and their first, parameterised invocation dry-runs successfully.
  for (const proposal of managerBatch.inventedWorkflowProposals) {
    const matchingCandidates = candidates.filter((candidate) => candidate.source === proposal.source && candidate.sourceRef === proposal.sourceRef);
    const replacesRejectedCandidate = matchingCandidates.some((candidate) => decisions.get(candidate.correlationId)?.decision === "reject");
    const actionTaken = runtimeInventedWorkflows.some((workflow) => workflow.definition.actionId === proposal.workflow.actionId)
      || WORKFLOW_REGISTRY.has(proposal.workflow.actionId);
    if (!replacesRejectedCandidate || actionTaken || proposal.initialInvocation.actionId !== proposal.workflow.actionId || !gameId) continue;
    const runtime: RuntimeInventedWorkflow = {
      id: randomUUID(), gameId, definition: proposal.workflow, status: "active",
    };
    const initialCandidate: WorkflowCandidate = {
      correlationId: randomUUID(), source: proposal.source, sourceRef: proposal.sourceRef,
      sourceRationale: proposal.workflow.intent, requestedInvocation: proposal.initialInvocation,
    };
    const violation = validateCandidate(initialCandidate, dryRunWorld, [...runtimeInventedWorkflows, runtime]);
    const duplicateKey = `${proposal.initialInvocation.actionId}:${proposal.initialInvocation.actorId}`;
    if (violation || seen.has(duplicateKey)) continue;
    const outcome = executeWorkflow(proposal.initialInvocation, dryRunWorld, atStep, [...runtimeInventedWorkflows, runtime]);
    if (!outcome.ok) continue;
    seen.add(duplicateKey);
    dryRunWorld = outcome.world;
    runtimeInventedWorkflows.push(runtime);
    createdInventedWorkflows.push(runtime);
    acceptedInvocations.push(proposal.initialInvocation);
    auditEntries.push({
      ...auditBase(initialCandidate),
      managerDecision: "replace",
      managerReason: `Created reusable invented workflow ${proposal.workflow.actionId}.`,
      replacedActionId: proposal.workflow.actionId,
      replacementInvocation: proposal.initialInvocation,
      finalInvocation: proposal.initialInvocation,
      dryRunOk: true,
    });
  }

  return {
    acceptedInvocations,
    runtimeInventedWorkflows,
    createdInventedWorkflows,
    auditBlob: { candidates: auditEntries, novelActionProposals: [], managerFailed, atStep },
  };
}
