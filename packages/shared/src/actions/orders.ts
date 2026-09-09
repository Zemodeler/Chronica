import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { WorldInstantSchema, type WorldInstant } from "../world/instant";

// What a player submits, and what the simulation makes of it (docs/14, ADR-0032).
//
// The promise here is that anything is possible: type what your character
// attempts, in your own words. The funnel that keeps it affordable -- grammar,
// then one batched assessment, then adjudication only for genuine novelty --
// exists to make the common verbs free, never to bound what can be attempted.

export const MAX_DIRECTIVES_PER_BATCH = 32;
export const MAX_BATCH_CODE_POINTS = 4_000;

/**
 * One instruction. Array position in the batch is the player's own priority,
 * and applies only when their directives compete for the same actor or
 * resource -- it never moves their work ahead of another player's.
 */
export const OrderDirectiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new"), text: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal("revise"), actionId: EntityIdSchema, text: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal("cancel"), actionId: EntityIdSchema }).strict(),
]);
export type OrderDirective = z.infer<typeof OrderDirectiveSchema>;

/** Code points, not UTF-16 units: an emoji or a Greek name must not cost double. */
export function batchCodePoints(directives: readonly OrderDirective[]): number {
  return [...directives.map((directive) => ("text" in directive ? directive.text : "")).join("")].length;
}

export const OrderBatchSchema = z
  .object({
    directives: z.array(OrderDirectiveSchema).max(MAX_DIRECTIVES_PER_BATCH),
  })
  .strict()
  .superRefine((batch, context) => {
    const codePoints = batchCodePoints(batch.directives);
    if (codePoints > MAX_BATCH_CODE_POINTS) {
      context.addIssue({
        code: "custom",
        path: ["directives"],
        message: `Order batch is ${codePoints} code points; the limit is ${MAX_BATCH_CODE_POINTS}.`,
      });
    }
  });
export type OrderBatch = z.infer<typeof OrderBatchSchema>;

/**
 * An internal workflow call. Never a player-facing menu item.
 *
 * Grammar, assessment, NPC logic and the Event Director may all *propose* one
 * of these; none executes it. `source` and `sourceRef` are stamped by
 * orchestration after output is accepted -- they are never fields copied from
 * model text, because a model that could name its own source could launder an
 * illegal invocation into a trusted one.
 */
export const InvocationSourceSchema = z.enum([
  // The single tool-using agent that replaced the director committee.
  "game_master",
  "grammar",
  "assessment",
  "npc",
  "event_director",
  "simulation",
]);
export type InvocationSource = z.infer<typeof InvocationSourceSchema>;

/** What a proposer may say. Deliberately missing `source` and `sourceRef`. */
export const ProposedInvocationSchema = z
  .object({
    actionId: EntityIdSchema,
    actorId: EntityIdSchema,
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ProposedInvocation = z.infer<typeof ProposedInvocationSchema>;

export const ActionInvocationSchema = ProposedInvocationSchema.extend({
  source: InvocationSourceSchema,
  sourceRef: z.string().trim().min(1).max(200),
}).strict();
export type ActionInvocation = z.infer<typeof ActionInvocationSchema>;

/** How feasible the assessment thinks an attempt is. The simulation decides. */
export const FeasibilitySchema = z.enum([
  "feasible",
  "conditional",
  "unlawful",
  "impossible",
  "uncertain",
]);
export type Feasibility = z.infer<typeof FeasibilitySchema>;

export const StepRangeSchema = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .strict()
  .refine((range) => range.max >= range.min, {
    message: "A step range's max must be at least its min.",
    path: ["max"],
  });
export type StepRange = z.infer<typeof StepRangeSchema>;

/**
 * A workflow candidate selected by order assessment.
 *
 * The model may name only a registered workflow and its untrusted parameters.
 * The resolver supplies the player actor and stamps the source after the
 * registry has parsed and validated this proposal against the current world.
 */
export const AssessedWorkflowSchema = z
  .object({
    actionId: EntityIdSchema,
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AssessedWorkflow = z.infer<typeof AssessedWorkflowSchema>;

/**
 * The compact result of the one turn-wide Basic assessment (M2).
 *
 * Stored against an immutable action revision and reused without another call.
 * Changing circumstances are simulation inputs, or a reason for the player to
 * submit a new revision -- never a reason to re-assess silently.
 */
export const OrderAssessmentSchema = z
  .object({
    directiveId: EntityIdSchema,
    interpretation: z.string().trim().min(1).max(600),
    feasibility: FeasibilitySchema,
    obstacleIds: z.array(z.string().trim().min(1)),
    dependencyActionIds: z.array(EntityIdSchema),
    estimatedSteps: StepRangeSchema,
    /**
     * Legacy single workflow hint. New assessment responses use `workflows`,
     * because one player order can legitimately require several operations.
     */
    workflow: AssessedWorkflowSchema.nullable().default(null),
    /** Registered workflow hints for the adjudication step; empty when unmappable. */
    workflows: z.array(AssessedWorkflowSchema).max(4).default([]),
    needsAdjudication: z.boolean(),
  })
  .strict();
export type OrderAssessment = z.infer<typeof OrderAssessmentSchema>;

/**
 * One immutable entry in an action's history.
 *
 * A compatible revision preserves the action's identity and earned progress; a
 * materially different objective must replace the action instead. Original text
 * is never modified -- it is the audit trail when a player disputes an
 * interpretation.
 */
export const ActionRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    sourceIntentId: EntityIdSchema,
    submittedTurnIndex: z.number().int().nonnegative(),
    directiveKind: z.enum(["new", "revise"]),
    rawText: z.string().min(1),
    priority: z.number().int().nonnegative(),
    assessment: OrderAssessmentSchema.nullable(),
    preservesProgress: z.boolean(),
  })
  .strict();
export type ActionRevision = z.infer<typeof ActionRevisionSchema>;

export const ActionStatusSchema = z.enum([
  "waiting",
  "active",
  "completed",
  "failed",
  "impossible",
  "cancelled",
  "replaced",
  // docs/32 Phase 7: additive states for the event-queue-driven lifecycle
  // (proposed/scheduled/started/progressing/completed/interrupted/failed/
  // cancelled). "progressing" reuses the existing "active" value rather
  // than adding a synonym; "impossible"/"replaced" are kept, unchanged,
  // with no spec equivalent.
  "proposed",
  "scheduled",
  "started",
  "interrupted",
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

/** The five ways an action ends. Nothing else is terminal. */
export const TERMINAL_ACTION_STATUSES = [
  "completed",
  "failed",
  "impossible",
  "cancelled",
  "replaced",
] as const satisfies readonly ActionStatus[];

export const isTerminalStatus = (status: ActionStatus): boolean =>
  (TERMINAL_ACTION_STATUSES as readonly string[]).includes(status);

export const ActionProgressSchema = z
  .object({
    stepsElapsed: z.number().int().nonnegative(),
    /**
     * Null when the total is genuinely unknown. A range is always presented as
     * an estimate, never a false percentage.
     */
    stepsExpected: StepRangeSchema.nullable(),
  })
  .strict();

/**
 * Who or what issued an order, and who or what it targets (docs/14, Phase 1
 * of the unified-resolution redesign).
 *
 * Kept as one narrow shape reused by both `issuerRef` and `targetRefs` --
 * the order model does not need a richer polymorphic reference system, only
 * enough to say whose authority is in play and what it acts on.
 */
export const OrderPartyRefSchema = z
  .object({
    kind: z.enum([
      "character", "faction", "polity", "institution", "force", "province", "settlement", "account", "office", "procedure",
      // docs/32 Phase 7: the star-context hierarchy's own three levels
      // (person/unit/settlement/province already map onto kinds above);
      // additive, non-breaking (a new discriminated-enum member, not a shape
      // change) -- every existing consumer pattern-matches on known kinds.
      "region", "theatre", "world",
    ]),
    id: EntityIdSchema,
  })
  .strict();
export type OrderPartyRef = z.infer<typeof OrderPartyRefSchema>;

/**
 * Whether the order's issuer actually had standing to make it, and on what
 * basis. Populated from the same authority/policy checks the pipeline
 * already runs (`political-authority.ts`'s `resolveEligibility`, and the
 * Workflow Manager's `validateCandidate` policy violations) -- this is a
 * record of that decision, not a second authority engine.
 */
export const OrderAuthorityBasisSchema = z
  .object({
    /** What kind of standing was claimed: an office, delegation, de facto command, or none. */
    claimedType: z.string().trim().min(1).max(60),
    validated: z.boolean(),
    /** Why validation succeeded or failed, in a form fit for Chronicle grounding. */
    basis: z.string().trim().max(300).optional(),
  })
  .strict();
export type OrderAuthorityBasis = z.infer<typeof OrderAuthorityBasisSchema>;

/** A resource an order draws on: an account, a force, or a free-form other reference. */
export const OrderResourceRefSchema = z
  .object({
    accountId: EntityIdSchema.optional(),
    forceId: EntityIdSchema.optional(),
    other: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type OrderResourceRef = z.infer<typeof OrderResourceRefSchema>;

/**
 * Work already in progress, as authoritative snapshot state (ADR-0030).
 *
 * The identity is stable across compatible revisions and every snapshot, so a
 * salience interruption resumes the same action without another order or model
 * call. Standing orders describe future choices; this is not the same shape.
 *
 * Phase 1 of the unified-resolution redesign (docs/14) adds the universal
 * order fields -- issuer, target, desired outcome, authority basis, required
 * procedure, resources, and a link to a persistent operation -- so this one
 * shape serves player orders, NPC actions, and faction/polity orders alike.
 * All of them are optional so that a pre-Phase-1 snapshot (which never
 * populated any of them) still parses.
 */
export const OngoingActionSchema = z
  .object({
    id: EntityIdSchema,
    actorId: EntityIdSchema,
    sourceIntentId: EntityIdSchema,
    revision: z.number().int().positive(),
    revisions: z.array(ActionRevisionSchema).min(1),
    invocation: ActionInvocationSchema,
    startedTurnIndex: z.number().int().nonnegative(),
    startedAtStep: ElapsedStepSchema,
    priority: z.number().int().nonnegative(),
    dependencyActionIds: z.array(EntityIdSchema),
    progress: ActionProgressSchema,
    continuationPolicy: z.literal("automatic"),
    status: ActionStatusSchema,
    /** Names the blocking action or resource, so waiting is explicable. */
    waitingReason: z.string().trim().min(1).max(300).nullable(),
    terminalReason: z.string().trim().min(1).max(300).nullable(),
    replacedByActionId: EntityIdSchema.nullable(),
    /** Who issued this order. Defaults to the actor when absent (a self-directed action). */
    issuerRef: OrderPartyRefSchema.optional(),
    /** What the order acts on. May be empty for an order with no distinct target. */
    targetRefs: z.array(OrderPartyRefSchema).max(10).optional(),
    /** A short, human-readable statement of what the issuer is trying to achieve. */
    desiredOutcome: z.string().trim().min(1).max(400).optional(),
    /** Free-form method/manner of execution, e.g. "by forced march". */
    method: z.string().trim().max(200).optional(),
    /** Free-form stance, e.g. "avoid battle unless attacked". Warfare-specific postures arrive in Phase 3. */
    posture: z.string().trim().max(60).optional(),
    authorityBasis: OrderAuthorityBasisSchema.optional(),
    /** Set when a political/institutional procedure must run before this order can execute. */
    requiredProcedureId: EntityIdSchema.optional(),
    resourceRefs: z.array(OrderResourceRefSchema).max(10).optional(),
    /** Set when this order is (or becomes) part of a multi-turn `PersistentOperation`. */
    operationId: EntityIdSchema.optional(),
    /** Last step this action's status/progress changed, alongside `startedAtStep`. */
    updatedAtStep: ElapsedStepSchema.optional(),
    /** Links this action's history into a Chronicle causal chain (`world/chronicle-chains.ts`). */
    chronicleChainId: EntityIdSchema.optional(),
    /**
     * docs/32 Phase 7: the `world_events` row (`world/event-queue.ts`) that
     * will start or advance this action, once it has one. Set when status
     * becomes "scheduled"; traces "scheduled" back to a concrete queue row
     * rather than an implicit per-turn scan.
     */
    queuedEventId: EntityIdSchema.optional(),
    /** Which phase of a multi-phase action is active, for event-queue-granularity resolution. */
    currentPhaseIndex: z.number().int().nonnegative().optional(),
    /** When this action's next queued event is due, mirrored here so it reads without a join. */
    scheduledInstant: WorldInstantSchema.nullable().optional(),
    /** Set when status becomes "interrupted", alongside `waitingReason`. */
    interruptedAtStep: ElapsedStepSchema.optional(),
  })
  .strict()
  .superRefine((action, context) => {
    if (action.revisions.length !== action.revision) {
      context.addIssue({
        code: "custom",
        path: ["revisions"],
        message: "An action's revision number must match the length of its immutable history.",
      });
    }
    if ((action.status === "waiting" || action.status === "interrupted") && action.waitingReason === null) {
      context.addIssue({
        code: "custom",
        path: ["waitingReason"],
        message: "Waiting or interrupted work must name what it is waiting for.",
      });
    }
    if (action.status === "interrupted" && action.interruptedAtStep === undefined) {
      context.addIssue({
        code: "custom",
        path: ["interruptedAtStep"],
        message: "An interrupted action must record when it was interrupted.",
      });
    }
    if (action.status === "replaced" && action.replacedByActionId === null) {
      context.addIssue({
        code: "custom",
        path: ["replacedByActionId"],
        message: "A replaced action must name what replaced it.",
      });
    }
    if (action.status !== "replaced" && action.replacedByActionId !== null) {
      context.addIssue({
        code: "custom",
        path: ["replacedByActionId"],
        message: "Only a replaced action names a replacement.",
      });
    }
  });
export type OngoingAction = z.infer<typeof OngoingActionSchema>;

/*
 * docs/32 Phase 7: pure status-transition helpers for the event-queue-driven
 * action lifecycle, in the same style as `actions/plans.ts`'s
 * `startPlanStage`/`completePlanStage` -- no `WorldState` dependency, since
 * these operate on a single `OngoingAction` value.
 */

/** `(no prior status)` -> "proposed": an order issued but not yet assessed/scheduled. */
export function proposeAction(action: OngoingAction): OngoingAction {
  return { ...action, status: "proposed" };
}

/** "proposed" -> "scheduled": accepted, has a queued `action_phase` event, not yet begun. */
export function scheduleAction(
  action: OngoingAction,
  queuedEventId: string,
  scheduledInstant: WorldInstant,
  atStep: number,
): OngoingAction {
  return { ...action, status: "scheduled", queuedEventId, scheduledInstant, updatedAtStep: atStep };
}

/** "scheduled" -> "started": the first phase claimed/began this instant. */
export function startAction(action: OngoingAction, atStep: number): OngoingAction {
  return { ...action, status: "started", startedAtStep: atStep, updatedAtStep: atStep };
}

/** Any non-terminal status -> "interrupted": work paused by a higher-priority event, resumable. */
export function interruptAction(action: OngoingAction, reason: string, atStep: number): OngoingAction {
  return { ...action, status: "interrupted", waitingReason: reason, interruptedAtStep: atStep, updatedAtStep: atStep };
}

/** "interrupted" -> "active": resumes paused work, or "scheduled" if a fresh queue entry is supplied. */
export function resumeAction(action: OngoingAction, atStep: number, queuedEventId?: string): OngoingAction {
  if (queuedEventId !== undefined) {
    return { ...action, status: "scheduled", queuedEventId, waitingReason: null, updatedAtStep: atStep };
  }
  return { ...action, status: "active", waitingReason: null, updatedAtStep: atStep };
}
