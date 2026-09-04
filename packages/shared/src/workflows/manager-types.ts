import { z } from "zod";
import { ProposedInvocationSchema, type ProposedInvocation } from "../actions/orders";
import { EntityIdSchema } from "../material-state";
import { TemporaryWorkflowPatchSchema } from "./temporary-patch";
import { InventedWorkflowDefinitionSchema } from "./invented-workflow";

// Workflow Manager types (Issue #6).
//
// Workflows are the skills the AI may invoke to effect changes in the world.
// The Workflow Manager reviews every AI-proposed skill invocation before
// world mutation, approves/rejects/replaces each, and flags novel actions
// that no skill currently covers for developer review.

export const WorkflowCandidateSourceSchema = z.enum([
  // The single agent that replaced the director committee (GM refactor).
  // Every other member is kept so archived audit blobs stay readable.
  "game_master",
  "player_directive",
  "character_director",
  "near_event",
  "far_event",
  "coarse_event",
  "reaction_director",
  "simulator",
  "world_director_synthesis",
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
    /**
     * Echoed back by the AI; matched primarily by array position against the
     * candidate list (decisions must come back "in the supplied order"), so
     * this is a secondary sanity check rather than the join key. Not required
     * to be a well-formed UUID — models occasionally mistranscribe it.
     */
    correlationId: z.string().trim().min(1).max(100),
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
 * It has a bounded temporary patch for this turn and a downloadable developer
 * report. The generated TypeScript is never executed as code.
 */
export const NovelActionProposalSchema = z
  .object({
    intent: z.string().trim().min(1).max(600),
    targetEntityIds: z.array(z.string().trim().min(1)).max(10),
    estimatedMutationDescription: z.string().trim().max(600),
    temporaryPatch: TemporaryWorkflowPatchSchema,
    implementationReport: z.string().trim().min(1).max(4_000),
    source: WorkflowCandidateSourceSchema,
    sourceRef: z.string().trim().max(200),
  })
  .strict();
export type NovelActionProposal = z.infer<typeof NovelActionProposalSchema>;

/** A reusable game-local workflow created only when no catalog entry fits. */
export const InventedWorkflowProposalSchema = z.object({
  workflow: InventedWorkflowDefinitionSchema,
  initialInvocation: ProposedInvocationSchema,
  source: WorkflowCandidateSourceSchema,
  sourceRef: z.string().trim().max(200),
  implementationReport: z.string().trim().max(4_000).default(""),
}).strict();
export type InventedWorkflowProposal = z.infer<typeof InventedWorkflowProposalSchema>;

/** The full response the workflow_manager operation must return. */
export const ManagerDecisionBatchSchema = z
  .object({
    decisions: z.array(ManagerDecisionSchema),
    novelActionProposals: z.array(NovelActionProposalSchema).default([]),
    inventedWorkflowProposals: z.array(InventedWorkflowProposalSchema).default([]),
  })
  .strict();
export type ManagerDecisionBatch = z.infer<typeof ManagerDecisionBatchSchema>;

/** Per-candidate audit entry stored on the turn row. */
export interface WorkflowAuditEntry {
  readonly correlationId: string;
  readonly source: WorkflowCandidateSource;
  readonly sourceRef: string;
  readonly requestedActionId: string;
  /** The complete untrusted request, retained so a repair can be audited. */
  readonly requestedInvocation: ProposedInvocation;
  readonly policyViolation?: { kind: string; message: string };
  readonly managerDecision?: "approve" | "reject" | "replace" | "no_action";
  readonly managerReason?: string;
  readonly replacedActionId?: string;
  /** Present when the manager repaired the original request. */
  readonly replacementInvocation?: ProposedInvocation;
  /** The invocation that passed dry-run and was sent to the executor. */
  readonly finalInvocation?: ProposedInvocation;
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

// ── Director proposal schemas ─────────────────────────────────────────────────

/** A reaction proposed by the Reaction Director after player execution. */
export const ReactionProposalSchema = z
  .object({
    reactorId: z.string().trim().min(1).max(120),
    reactionKind: z.enum(["military", "political", "economic", "diplomatic", "social"]),
    proposedWorkflows: z.array(ProposedInvocationSchema).max(3),
    rationale: z.string().trim().max(400),
    visibility: z.enum(["public", "polity", "private"]),
    salience: z.number().int().min(0).max(10),
    causalVerdictId: z.string().trim().max(120),
  })
  .strict();
export type ReactionProposal = z.infer<typeof ReactionProposalSchema>;

export const ReactionProposalBatchSchema = z
  .object({
    proposals: z.array(ReactionProposalSchema).max(8),
  })
  .strict();
export type ReactionProposalBatch = z.infer<typeof ReactionProposalBatchSchema>;

/** A simulator event/storyline proposal. */
export const SimulatorProposalSchema = z
  .object({
    kind: z.enum(["new_event", "advance_storyline", "create_storyline", "resolve_storyline"]),
    storylineId: z.string().trim().max(120).nullable().default(null),
    proposedStorylineTitle: z.string().trim().max(160).nullable().default(null),
    proposedWorkflows: z.array(ProposedInvocationSchema).max(4),
    scopeTag: z.enum(["star", "near", "far", "coarse"]),
    summary: z.string().trim().max(480),
    visibility: z.enum(["public", "polity", "private"]),
    salience: z.number().int().min(0).max(10),
  })
  .strict();
export type SimulatorProposal = z.infer<typeof SimulatorProposalSchema>;

export const SimulatorProposalBatchSchema = z
  .object({
    proposals: z.array(SimulatorProposalSchema).max(16),
  })
  .strict();
export type SimulatorProposalBatch = z.infer<typeof SimulatorProposalBatchSchema>;

/** A consolidated proposal (deduped, ranked) for the World Director. */
export const ConsolidatedProposalSchema = z
  .object({
    id: z.string().uuid(),
    sources: z.array(z.enum(["character_director", "reaction_director", "simulator"])),
    kind: z.string().trim().max(80),
    mergedRationale: z.string().trim().max(600),
    proposedWorkflows: z.array(ProposedInvocationSchema).max(4),
    salience: z.number().int().min(0).max(100),
    scopeTag: z.enum(["star", "near", "far", "coarse"]),
    dedupeGroup: z.string().trim().max(120).optional(),
    /** Present only for a Character Director proposal, for approval and Chronicle routing. */
    characterId: EntityIdSchema.optional(),
  })
  .strict();
export type ConsolidatedProposal = z.infer<typeof ConsolidatedProposalSchema>;

export const ConsolidatedProposalPackageSchema = z
  .object({
    proposals: z.array(ConsolidatedProposalSchema).max(32),
    conflicts: z
      .array(
        z.object({
          proposalIds: z.array(z.string()).max(4),
          description: z.string().trim().max(240),
        }),
      )
      .max(8),
    totalSalience: z.number().int().min(0),
  })
  .strict();
export type ConsolidatedProposalPackage = z.infer<typeof ConsolidatedProposalPackageSchema>;

/** The named NPC who carries an approved political event into Chronicle prose. */
export const ChronicleCastRoleSchema = z.enum([
  "supporter",
  "opponent",
  "spokesperson",
  "presiding_official",
  "witness",
  "negotiator",
  /** A newly-cast local leader whose first act commands a military response (e.g. raising a defending force against an invasion or blockade). */
  "commander",
]);
export type ChronicleCastRole = z.infer<typeof ChronicleCastRoleSchema>;

const NewChronicleCharacterSchema = z
  .object({
    /** A proper name, never a generic title such as \"a senator\". */
    name: z.string().trim().min(2).max(120),
    polityId: EntityIdSchema.nullable(),
    locationProvinceId: EntityIdSchema,
    officeId: EntityIdSchema.nullable().default(null),
  })
  .strict();

/**
 * A World Director-selected cast member for an event. It may name an existing
 * character, or introduce exactly one new, grounded NPC through the registered
 * create_world_character workflow.
 */
export const ChronicleCastSchema = z
  .object({
    role: ChronicleCastRoleSchema,
    characterId: EntityIdSchema.optional(),
    newCharacter: NewChronicleCharacterSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.characterId) === Boolean(value.newCharacter)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Chronicle cast must specify exactly one of characterId or newCharacter.",
      });
    }
  });
export type ChronicleCast = z.infer<typeof ChronicleCastSchema>;

/** World Director decision on a consolidated proposal. */
export const WorldDirectorDecisionSchema = z
  .object({
    proposalId: z.string().trim().max(120),
    decision: z.enum(["approve", "modify", "defer", "reject"]),
    rationale: z.string().trim().max(400),
    finalWorkflows: z.array(ProposedInvocationSchema).max(4),
    /** Required for approved political/institutional events; null otherwise. */
    chronicleCast: ChronicleCastSchema.nullable().default(null),
  })
  .strict();
export type WorldDirectorDecision = z.infer<typeof WorldDirectorDecisionSchema>;

export const WorldDirectorDecisionBatchSchema = z
  .object({
    decisions: z.array(WorldDirectorDecisionSchema).max(24),
  })
  .strict();
export type WorldDirectorDecisionBatch = z.infer<typeof WorldDirectorDecisionBatchSchema>;
