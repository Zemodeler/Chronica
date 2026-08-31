import { z } from "zod";
import { ProposedInvocationSchema } from "../actions/orders";

// Workflow Manager types (Issue #6).
//
// Workflows are the skills the AI may invoke to effect changes in the world.
// The Workflow Manager reviews every AI-proposed skill invocation before
// world mutation, approves/rejects/replaces each, and flags novel actions
// that no skill currently covers for developer review.

export const WorkflowCandidateSourceSchema = z.enum([
  "player_directive",
  "character_director",
  "near_event",
  "far_event",
  "coarse_event",
]);
export type WorkflowCandidateSource = z.infer<typeof WorkflowCandidateSourceSchema>;

/** A source-stamped workflow proposal produced by the pipeline before the manager runs. */
export const WorkflowCandidateSchema = z
  .object({
    /** Assigned by the pipeline; stable across retry. */
    correlationId: z.string().uuid(),
    source: WorkflowCandidateSourceSchema,
    /** directiveId / characterId / triggerId — what produced this proposal. */
    sourceRef: z.string().trim().min(1).max(200),
    /** The AI's stated reason for this proposal, carried as-is for manager context. */
    sourceRationale: z.string().trim().max(400),
    requestedInvocation: ProposedInvocationSchema,
  })
  .strict();
export type WorkflowCandidate = z.infer<typeof WorkflowCandidateSchema>;

/** The manager's decision on a single candidate. */
export const ManagerDecisionSchema = z
  .object({
    correlationId: z.string().uuid(),
    decision: z.enum(["approve", "reject", "replace", "no_action"]),
    /** Required; must state why. */
    reason: z.string().trim().min(1).max(400),
    /** Populated only when decision === "replace". */
    replacementInvocation: ProposedInvocationSchema.nullable().default(null),
  })
  .strict();
export type ManagerDecision = z.infer<typeof ManagerDecisionSchema>;

/**
 * A novel action the manager needs but no registered skill covers.
 * Persisted to pending_workflow_proposals for developer review.
 * Never applied to world state directly.
 */
export const NovelActionProposalSchema = z
  .object({
    intent: z.string().trim().min(1).max(600),
    targetEntityIds: z.array(z.string().trim().min(1)).max(10),
    estimatedMutationDescription: z.string().trim().max(600),
    source: WorkflowCandidateSourceSchema,
    sourceRef: z.string().trim().max(200),
  })
  .strict();
export type NovelActionProposal = z.infer<typeof NovelActionProposalSchema>;

/** The full response the workflow_manager operation must return. */
export const ManagerDecisionBatchSchema = z
  .object({
    decisions: z.array(ManagerDecisionSchema),
    novelActionProposals: z.array(NovelActionProposalSchema).default([]),
  })
  .strict();
export type ManagerDecisionBatch = z.infer<typeof ManagerDecisionBatchSchema>;

/** Per-candidate audit entry stored on the turn row. */
export interface WorkflowAuditEntry {
  readonly correlationId: string;
  readonly source: WorkflowCandidateSource;
  readonly sourceRef: string;
  readonly requestedActionId: string;
  readonly policyViolation?: { kind: string; message: string };
  readonly managerDecision?: "approve" | "reject" | "replace" | "no_action";
  readonly managerReason?: string;
  readonly replacedActionId?: string;
  readonly dryRunOk?: boolean;
  readonly executionOk?: boolean;
  readonly executionReason?: string;
}

/** Full audit blob stored as JSONB on the turns row. */
export interface WorkflowAuditBlob {
  readonly candidates: WorkflowAuditEntry[];
  readonly novelActionProposals: NovelActionProposal[];
  readonly managerFailed: boolean;
  readonly atStep: number;
}
