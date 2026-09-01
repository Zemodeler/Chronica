import "server-only";

import { randomUUID } from "node:crypto";
import type { AiAdapter } from "@chronica/ai";
import type {
  ManagerDecision,
  ManagerDecisionBatch,
  NovelActionProposal,
  ProposedInvocation,
  Verdict,
  WorkflowAuditBlob,
  WorkflowAuditEntry,
  WorkflowCandidate,
  WorldState,
} from "@chronica/shared";
import {
  ManagerDecisionBatchSchema,
  applyTemporaryWorkflowPatch,
  validateTemporaryWorkflowPatchReferences,
  executeWorkflow,
  validateAllCandidates,
  validateCandidate,
} from "@chronica/shared";
import { buildWorkflowManagerSystemPrompt } from "./workflow-manager-prompt";

// The single AI review gate before a turn is committed. It receives structured
// workflow candidates only; raw player language never reaches this module.

export interface WorkflowManagerResult {
  readonly acceptedInvocations: ProposedInvocation[];
  readonly temporaryPatches: NovelActionProposal[];
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
): WorldState {
  const policy = validateAllCandidates(candidates, world);
  let preview = world;
  for (const candidate of candidates) {
    if (policy.get(candidate.correlationId) !== null) continue;
    const outcome = executeWorkflow(candidate.requestedInvocation, preview, atStep);
    if (outcome.ok) preview = outcome.world;
  }
  return preview;
}

/**
 * Tries to resolve entity IDs in a temporary patch that don't exist in the
 * world by matching them by name (case-insensitive). The model sometimes
 * writes human-readable names ("Panormus") instead of UUIDs even though
 * the world state is provided; this pass silently corrects those.
 */
function resolveTemporaryPatchIds(
  patch: NovelActionProposal["temporaryPatch"],
  world: WorldState,
): NovelActionProposal["temporaryPatch"] {
  const resolveCharacterId = (id: string) => {
    if (world.characters.some((c) => c.id === id)) return id;
    return world.characters.find((c) => c.name.toLowerCase() === id.toLowerCase())?.id ?? id;
  };
  const resolveProvinceId = (id: string) => {
    if (world.map.provinces.some((p) => p.id === id)) return id;
    return world.map.provinces.find((p) => p.name.toLowerCase() === id.toLowerCase())?.id ?? id;
  };
  const resolvePolityId = (id: string) => {
    if (world.map.polities.some((p) => p.id === id)) return id;
    return world.map.polities.find((p) => p.name.toLowerCase() === id.toLowerCase())?.id ?? id;
  };
  const resolveAccountId = (id: string) => {
    if (world.material.accounts.some((a) => a.id === id)) return id;
    return id;
  };

  return {
    ...patch,
    actorId: resolveCharacterId(patch.actorId),
    operations: patch.operations.map((op) => {
      if (op.kind === "account_delta") {
        return { ...op, accountId: resolveAccountId(op.accountId) };
      }
      if (op.kind === "province_control") {
        return {
          ...op,
          provinceId: resolveProvinceId(op.provinceId),
          controllerPolityId: resolvePolityId(op.controllerPolityId),
        };
      }
      if (op.kind === "character_state") {
        return {
          ...op,
          characterId: resolveCharacterId(op.characterId),
          ...(op.locationProvinceId ? { locationProvinceId: resolveProvinceId(op.locationProvinceId) } : {}),
          ...(op.polityId ? { polityId: resolvePolityId(op.polityId) } : {}),
        };
      }
      if (op.kind === "create_storyline") {
        return {
          ...op,
          ...(op.provinceId ? { provinceId: resolveProvinceId(op.provinceId) } : {}),
          participantIds: op.participantIds.map(resolveCharacterId),
        };
      }
      return op;
    }),
  };
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
    for (const proposal of batch.novelActionProposals) {
      const matchingCandidates = candidates.filter((candidate) => candidate.source === proposal.source && candidate.sourceRef === proposal.sourceRef);
      if (matchingCandidates.length === 0) throw new WorkflowManagerOutputError(`Temporary patch has no matching candidate: ${proposal.source}/${proposal.sourceRef}.`);
      const replacesRejectedCandidate = matchingCandidates.some((candidate) =>
        batch.decisions.find((item) => item.correlationId === candidate.correlationId)?.decision === "reject",
      );
      if (!replacesRejectedCandidate) throw new WorkflowManagerOutputError("A temporary patch must replace a rejected candidate.");
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
): Promise<WorkflowManagerResult> {
  if (candidates.length === 0) {
    return { acceptedInvocations: [], temporaryPatches: [], auditBlob: { candidates: [], novelActionProposals: [], managerFailed: false, atStep } };
  }

  const originalPolicy = validateAllCandidates(candidates, world);
  const diagnostics = candidates.map((candidate) => ({
    correlationId: candidate.correlationId,
    violation: originalPolicy.get(candidate.correlationId) ?? null,
  }));
  const prompt = buildWorkflowManagerSystemPrompt(world, candidates, diagnostics);
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
    };
  }
  const decisions = new Map(managerBatch.decisions.map((decision) => [decision.correlationId, decision]));

  const auditEntries: WorkflowAuditEntry[] = [];
  const acceptedInvocations: ProposedInvocation[] = [];
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
    const policyViolation = validateCandidate(finalCandidate, dryRunWorld);
    const duplicateKey = `${finalInvocation.actionId}:${finalInvocation.actorId}`;
    const duplicateViolation = seen.has(duplicateKey)
      ? { kind: "duplicate", message: `Duplicate final invocation: ${finalInvocation.actionId} by ${finalInvocation.actorId}.` }
      : null;
    if (policyViolation || duplicateViolation) {
      const violation = policyViolation ?? duplicateViolation!;
      auditEntries.push({ ...entry, policyViolation: violation, dryRunOk: false, executionReason: violation.message });
      continue;
    }

    const outcome = executeWorkflow(finalInvocation, dryRunWorld, atStep);
    if (!outcome.ok) {
      auditEntries.push({ ...entry, finalInvocation, dryRunOk: false, executionReason: outcome.message });
      continue;
    }
    seen.add(duplicateKey);
    dryRunWorld = outcome.world;
    acceptedInvocations.push(finalInvocation);
    auditEntries.push({ ...entry, finalInvocation, dryRunOk: true });
  }

  const temporaryPatches: NovelActionProposal[] = [];
  for (const proposal of managerBatch.novelActionProposals) {
    const resolvedPatch = resolveTemporaryPatchIds(proposal.temporaryPatch, dryRunWorld);
    const referenceIssue = validateTemporaryWorkflowPatchReferences(dryRunWorld, resolvedPatch);
    if (referenceIssue !== null) {
      console.warn(`[workflow-manager] Skipping temporary patch "${proposal.intent}": ${referenceIssue}.`);
      continue;
    }
    const patched = applyTemporaryWorkflowPatch(dryRunWorld, resolvedPatch, atStep);
    if (patched === null) {
      console.warn(`[workflow-manager] Skipping temporary patch "${proposal.intent}": it could not be applied safely after reference validation.`);
      continue;
    }
    dryRunWorld = patched.world;
    temporaryPatches.push({ ...proposal, temporaryPatch: resolvedPatch });
  }

  return {
    acceptedInvocations,
    temporaryPatches,
    auditBlob: { candidates: auditEntries, novelActionProposals: temporaryPatches, managerFailed, atStep },
  };
}
