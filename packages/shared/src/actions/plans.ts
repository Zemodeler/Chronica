import { z } from "zod";
import { EntityIdSchema, ElapsedStepSchema, MoneyAmountSchema } from "../material-state";
import type { WorldState } from "../world/world-state";
import { deriveWorldInstant, type ScenarioClock } from "../world/clock";
import type { WorldInstant } from "../world/instant";
import type { WorldEventPayload } from "../world/event-queue";
import type { OrderDirective } from "./orders";
import { OrderPartyRefSchema } from "./orders";

export const PlanOptionsSchema = z.object({
  method: z.string().trim().max(400).default(""),
  constraints: z.string().trim().max(800).default(""),
  secrecy: z.enum(["public", "discreet", "secret"]).default("public"),
  delegateIds: z.array(EntityIdSchema).max(8).default([]),
  budget: z.object({ accountId: EntityIdSchema, amount: MoneyAmountSchema }).strict().nullable().default(null),
}).strict();

/**
 * Structured order interpretation (docs/32, Phase 2).
 *
 * Every factual assertion a plan's text makes has to be classified before it
 * can be treated as a premise for stages: `world_premise` claims the world
 * already contains something ("my legion"), `actor_belief` and
 * `deliberate_message` describe what someone thinks or says rather than what
 * is true, `preference` is a soft steer, `condition` is an "if" the engine
 * cannot itself evaluate. A `world_premise` marked `contradicted` must never
 * become the basis for a stage -- see `interpretPlan`'s enforcement below.
 */
export const InterpretedClaimKindSchema = z.enum([
  "world_premise",
  "actor_belief",
  "deliberate_message",
  "preference",
  "condition",
]);
export type InterpretedClaimKind = z.infer<typeof InterpretedClaimKindSchema>;

export const InterpretedClaimVerificationSchema = z.enum([
  "confirmed",
  "contradicted",
  "unknown",
  "not_applicable",
]);
export type InterpretedClaimVerification = z.infer<typeof InterpretedClaimVerificationSchema>;

export const InterpretedClaimSchema = z.object({
  text: z.string().trim().min(1).max(400),
  kind: InterpretedClaimKindSchema,
  verification: InterpretedClaimVerificationSchema,
  supportingFactIds: z.array(z.string().max(120)).max(8).default([]),
  contradictionFactIds: z.array(z.string().max(120)).max(8).default([]),
}).strict();
export type InterpretedClaim = z.infer<typeof InterpretedClaimSchema>;

export const PlanStageInputSchema = z.object({
  id: EntityIdSchema,
  objective: z.string().trim().min(1).max(400),
  actorId: EntityIdSchema,
  dependsOn: z.array(EntityIdSchema).max(12).default([]),
  notBeforeStep: ElapsedStepSchema.nullable().default(null),
  provinceId: EntityIdSchema.nullable().default(null),
  repeatEverySteps: z.number().int().min(1).max(100).nullable().default(null),
}).strict();
export const InterpretPlanSchema = z.object({
  planId: EntityIdSchema,
  interpretation: z.string().trim().min(1).max(800),
  stages: z.array(PlanStageInputSchema).max(12).default([]),
  /** Method, conditions, secrecy, delegates and any spending cap, inferred from the plan's own text -- never invented beyond what it actually says. */
  options: PlanOptionsSchema,
  /** Every factual assertion extracted from the plan's own text, classified and checked against known facts. */
  claims: z.array(InterpretedClaimSchema).max(20).default([]),
  /**
   * Questions that must be answered before stages commit -- required only
   * when several interpretations would diverge materially, an actor or
   * target cannot be inferred safely, the order could start a war, spend
   * beyond an unstated amount, surrender territory, kill someone, or abandon
   * a major commitment, or no interpretation preserves every stated
   * constraint (docs/32, Phase 2). Never for a harmless implementation
   * detail the plan's own latitude already covers.
   */
  clarificationQuestions: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
}).strict()
  .superRefine((input, context) => {
    if (input.stages.length === 0 && input.clarificationQuestions.length === 0) {
      context.addIssue({ code: "custom", path: ["stages"], message: "An interpretation must propose at least one stage, or ask a clarification question -- never neither." });
    }
    if (input.stages.length > 0 && input.clarificationQuestions.length > 0) {
      context.addIssue({ code: "custom", path: ["clarificationQuestions"], message: "Ask clarification questions on their own; do not also commit stages the answer could still change." });
    }
  });
export const ExecutePlanStageSchema = z.object({
  planId: EntityIdSchema,
  stageId: EntityIdSchema,
  actionId: EntityIdSchema,
  parameters: z.record(z.string(), z.unknown()).default({}),
  /**
   * The step this stage's own effect should actually take hold at, when the
   * interpreter judges that this specific call's consequence should land
   * later rather than immediately (unified action runtime, "Duration and
   * milestones"). Omitted -- the default -- resolves exactly as before:
   * atomically, right now. This is never inferred from a workflow's own
   * declared duration estimate: several workflows (`start_siege`,
   * `start_battle`, ...) already model a long process as an immediate
   * "begins" fact concluded by a *separate* later call (`end_siege`), and
   * blindly deferring their own effect would delay it from ever truly
   * beginning. Only the interpreter's own judgment that *this* call's
   * result should wait may set this.
   */
  completesAtStep: ElapsedStepSchema.optional(),
}).strict();
export const RespondToAssignmentSchema = z.object({ planId: EntityIdSchema, actorId: EntityIdSchema, accepted: z.boolean(), reason: z.string().trim().min(1).max(400) }).strict();
export const DeferPlanStageSchema = z.object({ planId: EntityIdSchema, stageId: EntityIdSchema, reason: z.string().trim().min(1).max(600) }).strict();

/**
 * Every non-terminal `ActionPlan` status -- draft/active/waiting/blocked/
 * interrupted all still have unfinished work. A plan in one of these counts
 * against a per-owner plan cap and is eligible for revision/cancellation;
 * completed/failed/abandoned/superseded are its closed history.
 */
export function isActionPlanOngoing(plan: Pick<ActionPlan, "status">): boolean {
  return plan.status !== "completed" && plan.status !== "failed" && plan.status !== "abandoned" && plan.status !== "superseded";
}

/** Submitted text is immutable history. Revisions preserve completed stages and require reinterpretation. */
export function preparePlayerPlans(world: WorldState, ownerId: string, atStep: number, directives: readonly { id: string; directive: OrderDirective }[]): WorldState {
  let plans = (world.plans ?? []).map(p => !isActionPlanOngoing(p) || p.ownerCharacterId !== ownerId ? p : { ...p, stages: p.stages.map(s =>
    s.repeatEverySteps !== null && s.completedAtStep !== null && s.completedAtStep + s.repeatEverySteps <= atStep
      ? { ...s, status: "pending" as const } : s) });
  for (const { id, directive } of directives) {
    if (directive.kind === "new") {
      const planId = `plan-${atStep}-${id}`;
      if (plans.some(p => p.id === planId)) continue;
      plans.push({ ...originateActionPlan(planId, { kind: "player", sourceId: ownerId, directiveId: id }, ownerId, directive.text, atStep), status: "active" });
    } else {
      plans = plans.map(p => {
        if (p.id !== directive.actionId || p.ownerCharacterId !== ownerId || !isActionPlanOngoing(p)) return p;
        if (directive.kind === "cancel") return { ...p, status: "abandoned", updatedAtStep: atStep, terminalReason: "The player cancelled this plan." };
        return { ...p, rawText: directive.text, interpretation: "", stages: p.stages.filter(s => s.status === "completed"),
          assignments: [], revisions: [...p.revisions, { atStep, text: directive.text }], updatedAtStep: atStep, status: "active" as const,
          claims: [], clarificationQuestions: [] };
      });
    }
  }
  const cancelled = new Set(plans.filter(p => p.ownerCharacterId === ownerId && p.status === "abandoned").map(p => p.id));
  const stoppedActionIds = new Set(world.actions.filter(a => cancelled.has(a.sourceIntentId) && (a.status === "active" || a.status === "waiting")).map(a => a.id));
  return { ...world,
    actions: world.actions.map(a => stoppedActionIds.has(a.id) ? { ...a, status: "cancelled", terminalReason: "The player cancelled the originating plan.", updatedAtStep: atStep } : a),
    operations: world.operations.map(o => stoppedActionIds.has(o.originatingOrderId) && (o.status === "active" || o.status === "paused") ? { ...o, status: "cancelled", statusReason: "The player cancelled the originating plan.", updatedAtStep: atStep } : o),
    plans: [...plans.filter(isActionPlanOngoing), ...plans.filter(p => !isActionPlanOngoing(p)).sort((a, b) => b.updatedAtStep - a.updatedAtStep).slice(0, 64)] };
}

export function interpretPlan(world: WorldState, ownerId: string, input: z.infer<typeof InterpretPlanSchema>, atStep: number): WorldState | string {
  const plan = world.plans?.find(p => p.id === input.planId && p.ownerCharacterId === ownerId && isActionPlanOngoing(p));
  if (!plan) return "No active plan of yours has that identity.";
  const owner = world.characters.find(c => c.id === ownerId);
  const budget = input.options.budget;
  if (budget) {
    const account = world.material.accounts.find(a => a.id === budget.accountId);
    if (!account || account.owner.kind !== "character" || account.owner.id !== ownerId) return "A plan may only draw on the player's own account.";
  }
  if (plan.spent > 0) {
    if (!budget || budget.amount < plan.spent) return "A plan's spending limit cannot drop below what it has already spent.";
    if (plan.options.budget && budget.accountId !== plan.options.budget.accountId) return "Already-committed spending must keep its original account.";
  }
  for (const delegateId of input.options.delegateIds) {
    if (!world.characters.some(c => c.id === delegateId && c.alive && c.id !== ownerId && (c.locationProvinceId === owner?.locationProvinceId || (owner?.polityId != null && c.polityId === owner.polityId)))) return "A named delegate must be a living contact of the player.";
  }
  // A contradicted world premise is never a fact merely because the plan's own text asserted it.
  if (input.claims.some(c => c.kind === "world_premise" && c.verification === "contradicted")) {
    return "A contradicted world premise cannot be the basis for a stage. Drop or revise that claim before interpreting stages.";
  }
  // Clarification is required on its own (InterpretPlanSchema already forbids also committing stages this same call):
  // record the questions and leave existing stages untouched until the player answers.
  if (input.clarificationQuestions.length > 0) {
    return { ...world, plans: world.plans!.map(p => p.id !== plan.id ? p : { ...p, interpretation: input.interpretation, updatedAtStep: atStep,
      claims: input.claims, clarificationQuestions: input.clarificationQuestions }) };
  }
  const ids = new Set<string>();
  const completed = plan.stages.filter(s => s.status === "completed");
  for (const stage of input.stages) {
    if (ids.has(stage.id)) return "Each stage needs a unique identity.";
    if (stage.dependsOn.some(id => !ids.has(id))) return "Dependencies must name an earlier stage; circular plans cannot proceed.";
    if (stage.actorId !== ownerId && !input.options.delegateIds.includes(stage.actorId)) return "This person was not named as a delegate in the plan's own text.";
    if (!world.characters.some(c => c.id === stage.actorId && c.alive)) return "Every executor must be a living character.";
    if (stage.provinceId !== null && !world.map.provinces.some(p => p.id === stage.provinceId)) return "A stage condition names an unknown province.";
    const old = completed.find(s => s.id === stage.id);
    // Merging `stage` (only the fields the AI supplies) onto `old` (the stage's full stored shape) and
    // comparing against `old` catches any change to an AI-controlled field while leaving every
    // lifecycle field (status/resultFactIds/completedAtStep/...) out of the comparison entirely.
    if (old && JSON.stringify({ ...old, ...stage }) !== JSON.stringify(old)) return "Completed stages cannot be changed or repeated.";
    ids.add(stage.id);
  }
  if (completed.some(s => !ids.has(s.id))) return "Keep completed stages as the plan's history.";
  return { ...world, plans: world.plans!.map(p => p.id !== plan.id ? p : { ...p, interpretation: input.interpretation, options: input.options, updatedAtStep: atStep,
    claims: input.claims, clarificationQuestions: [],
    stages: input.stages.map(s => completed.find(c => c.id === s.id) ?? ActionPlanStageSchema.parse({ ...s, status: "pending" })) }) };
}

/**
 * How much a stage actually debited from the accounts it touched. A stated
 * plan budget is guidance for the Game Master's own judgement, not a
 * deterministic spending cap -- so this only measures the debit, it never
 * refuses one.
 */
export function planSpending(before: WorldState, after: WorldState, plan: ActionPlan): number {
  if (!plan.options.budget) return 0;
  let debit = 0;
  for (const account of before.material.accounts) {
    const remaining = after.material.accounts.find(a => a.id === account.id)?.balance ?? 0;
    debit += Math.max(0, account.balance - remaining);
  }
  return debit;
}

/*
 * Universal plan model.
 *
 * `ActionPlan` is the one plan record for every origin -- player, NPC, or
 * the world itself. `preparePlayerPlans`/`interpretPlan` above and
 * `execute_plan_stage`/`respond_to_plan_assignment` (`gm/session.ts`) all
 * read and write `WorldState.plans`; the player-only `PlayerPlan` this
 * superseded is gone.
 */

export const ActionPlanOriginSchema = z.object({
  kind: z.enum(["player", "npc", "world"]),
  sourceId: EntityIdSchema,
  directiveId: z.string().max(120).nullable(),
}).strict();
export type ActionPlanOrigin = z.infer<typeof ActionPlanOriginSchema>;

/** Nine states, superseding `PlayerPlan`'s three. See docs/32, Phase 1. */
export const ActionPlanStatusSchema = z.enum([
  "draft",
  "active",
  "waiting",
  "blocked",
  "interrupted",
  "completed",
  "failed",
  "abandoned",
  "superseded",
]);
export type ActionPlanStatus = z.infer<typeof ActionPlanStatusSchema>;

export const ActionPlanStageStatusSchema = z.enum([
  "pending",
  "ready",
  "in_progress",
  "blocked",
  "interrupted",
  "completed",
  "failed",
  "superseded",
]);
export type ActionPlanStageStatus = z.infer<typeof ActionPlanStageStatusSchema>;

/** A stage's actual or attempted action. Null while a stage is not yet ready to attempt one. */
export const ActionPlanStageActionSchema = z.object({
  kind: z.enum(["built_in", "invented"]),
  actionId: EntityIdSchema,
  parameters: z.record(z.string(), z.unknown()),
}).strict();

/** A range estimate, never a false single-point promise (docs/32, Phase 5). */
export const ActionPlanDurationEstimateSchema = z.object({
  minimumSteps: z.number().int().nonnegative(),
  likelySteps: z.number().int().nonnegative(),
  maximumSteps: z.number().int().nonnegative(),
  basis: z.array(z.string().max(200)).max(6),
}).strict();

export const ActionPlanStageSchema = z.object({
  id: EntityIdSchema,
  objective: z.string().trim().min(1).max(400),
  actorId: EntityIdSchema,
  action: ActionPlanStageActionSchema.nullable().default(null),
  dependsOn: z.array(EntityIdSchema).max(12).default([]),
  /** Structural stage conditions, e.g. earliest step or province. Free-form prose conditions live in the plan's own text. */
  provinceId: EntityIdSchema.nullable().default(null),
  notBeforeStep: ElapsedStepSchema.nullable().default(null),
  repeatEverySteps: z.number().int().min(1).max(100).nullable().default(null),
  /** Filled once Phase 4 lands; empty by default so this schema needs no companion change to ship. */
  reservationIds: z.array(EntityIdSchema).max(12).default([]),
  durationEstimate: ActionPlanDurationEstimateSchema.nullable().default(null),
  status: ActionPlanStageStatusSchema,
  plannedStartStep: ElapsedStepSchema.nullable().default(null),
  startedAtStep: ElapsedStepSchema.nullable().default(null),
  expectedCompletionStep: ElapsedStepSchema.nullable().default(null),
  completedAtStep: ElapsedStepSchema.nullable().default(null),
  resultFactIds: z.array(z.string().max(120)).default([]),
  statusReason: z.string().max(600).nullable().default(null),
  /** docs/32 Phase 7: the `world_events` row that will advance this stage, once it has one. */
  queuedEventId: EntityIdSchema.optional(),
}).strict();
export type ActionPlanStage = z.infer<typeof ActionPlanStageSchema>;

export const ActionPlanSchema = z.object({
  id: EntityIdSchema,
  origin: ActionPlanOriginSchema,
  ownerCharacterId: EntityIdSchema.nullable(),
  /** Who or what has authority over this plan's objective; reuses the order model's party reference (docs/14). */
  issuingEntityRef: OrderPartyRefSchema.nullable().default(null),
  rawText: z.string().min(1).max(4_000),
  revisions: z.array(z.object({ atStep: ElapsedStepSchema, text: z.string().min(1).max(4_000) }).strict()).min(1),
  options: PlanOptionsSchema,
  interpretation: z.string().max(800),
  /** Every factual assertion extracted from the plan's own text on its last interpretation (docs/32, Phase 2). */
  claims: z.array(InterpretedClaimSchema).max(20).default([]),
  /** Outstanding questions the GM must have the player answer before this plan's stages may commit. */
  clarificationQuestions: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
  /** Filled once Phase 2 lands. */
  standingInstructions: z.array(z.string().max(400)).max(8).default([]),
  priority: z.number().int().nonnegative().default(0),
  /** Bumped whenever priority is recomputed, so a stale ordering decision can be detected (docs/32, Phase 4). */
  priorityEpoch: z.number().int().nonnegative().default(0),
  status: ActionPlanStatusSchema,
  /** Filled once Phase 3 lands; advisory only -- see docs/32's invariants section. */
  feasibility: z.string().max(800).nullable().default(null),
  stages: z.array(ActionPlanStageSchema).max(12),
  assignments: z.array(z.object({ actorId: EntityIdSchema, accepted: z.boolean(), reason: z.string().min(1).max(400) }).strict()).max(8),
  /** Filled once Phase 4 lands. */
  reservationIds: z.array(EntityIdSchema).max(12).default([]),
  spent: MoneyAmountSchema,
  createdAtStep: ElapsedStepSchema,
  updatedAtStep: ElapsedStepSchema,
  terminalReason: z.string().max(600).nullable().default(null),
}).strict();
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

/**
 * A not-yet-persisted `action_phase` event, ready to insert into the event
 * queue (`packages/db/src/schema/events.ts`'s `worldEvents`). Kept as a
 * narrow local shape rather than importing `NewWorldEvent` from
 * `packages/db` -- `packages/shared` does not depend on `packages/db`.
 */
export interface ScheduledEventDraft {
  readonly kind: "action_phase";
  readonly instant: WorldInstant;
  readonly subjectRef: { readonly kind: "character"; readonly id: string };
  readonly payload: WorldEventPayload;
  readonly actionId: string;
  readonly createdAtStep: number;
}

/**
 * Synthesizes `action_phase` events for a plan's in-progress and
 * not-yet-ready-but-scheduled stages, so an `ActionPlan` migrates into the
 * event queue without changing any already-completed historical outcome.
 * Pure and unit-testable -- a one-time backfill script for pre-event-queue
 * plans would call this per active plan and bulk-insert the result.
 *
 * - A stage `in_progress` with a known `expectedCompletionStep` schedules at
 *   that instant (its next tick is due then).
 * - A stage `pending`/`ready` with a `notBeforeStep` schedules at that
 *   instant (it becomes eligible to start then).
 * - Every other stage (no completion/start estimate, or already terminal)
 *   is left alone: it keeps resolving once per player turn exactly as
 *   today, via the pre-event-queue per-turn scan, until it acquires an
 *   estimate of its own.
 */
export function upgradeActionPlanToScheduledEvents(
  plan: ActionPlan,
  createdAtStep: number,
  scenarioClock?: ScenarioClock,
): ScheduledEventDraft[] {
  const drafts: ScheduledEventDraft[] = [];
  for (const stage of plan.stages) {
    let atStep: number | null = null;
    if (stage.status === "in_progress" && stage.expectedCompletionStep !== null) atStep = stage.expectedCompletionStep;
    else if ((stage.status === "pending" || stage.status === "ready") && stage.notBeforeStep !== null) atStep = stage.notBeforeStep;
    if (atStep === null) continue;
    drafts.push({
      kind: "action_phase",
      instant: deriveWorldInstant(atStep, scenarioClock),
      subjectRef: { kind: "character", id: stage.actorId },
      payload: { kind: "action_phase", actionId: stage.id },
      actionId: stage.id,
      createdAtStep,
    });
  }
  return drafts;
}

/*
 * Stage start/completion lifecycle.
 *
 * These operate on a single `ActionPlan` value, the same level `conflicts.ts`
 * and `reservations.ts` already work at -- pure functions, no `WorldState`
 * dependency. `execute_plan_stage` (`gm/session.ts`) still resolves most
 * built-in actions atomically today (`attemptPlanStageAtomically` below);
 * phased `WorldInstant` scheduling for stages with a real duration is a
 * later cutover.
 *
 * An atomic action may still start and complete in one call --
 * `attemptPlanStageAtomically` below does exactly that -- but a stage that
 * genuinely spans time (a siege, a campaign) uses the two calls separately,
 * with a scheduler deciding when the completion call is due.
 */

function planStageOrError(plan: ActionPlan, stageId: string): ActionPlanStage | string {
  const stage = plan.stages.find((s) => s.id === stageId);
  if (!stage) return `No stage named "${stageId}" exists on this plan.`;
  return stage;
}

function unfinishedDependencies(plan: ActionPlan, stage: ActionPlanStage): readonly string[] {
  return stage.dependsOn.filter((depId) => plan.stages.find((s) => s.id === depId)?.status !== "completed");
}

/**
 * Validates feasibility, acquires reservations (both left to the caller --
 * this function only records what it is given), and records the start.
 * Refuses a stage that is not `pending`/`ready`, or that still has an
 * unfinished dependency.
 */
export function startPlanStage(
  plan: ActionPlan,
  stageId: string,
  atStep: number,
  options: { durationEstimate?: ActionPlanStage["durationEstimate"]; reservationIds?: readonly string[]; queuedEventId?: string } = {},
): ActionPlan | string {
  const stage = planStageOrError(plan, stageId);
  if (typeof stage === "string") return stage;
  if (stage.status !== "pending" && stage.status !== "ready") return `Only a pending or ready stage can start; "${stageId}" is ${stage.status}.`;
  const unmet = unfinishedDependencies(plan, stage);
  if (unmet.length > 0) return `"${stageId}" depends on stage(s) not yet completed: ${unmet.join(", ")}.`;
  const durationEstimate = options.durationEstimate ?? stage.durationEstimate;
  const updated: ActionPlanStage = {
    ...stage,
    status: "in_progress",
    startedAtStep: atStep,
    plannedStartStep: stage.plannedStartStep ?? atStep,
    durationEstimate,
    expectedCompletionStep: durationEstimate ? atStep + durationEstimate.likelySteps : stage.expectedCompletionStep,
    reservationIds: options.reservationIds ? [...stage.reservationIds, ...options.reservationIds] : stage.reservationIds,
    queuedEventId: options.queuedEventId ?? stage.queuedEventId,
  };
  return { ...plan, updatedAtStep: atStep, stages: plan.stages.map((s) => (s.id === stageId ? updated : s)) };
}

/** Recomputes plan-level status from its stages once one of them reaches a terminal state (docs/32 rule #8: never reopens a completed/failed stage). */
function derivePlanStatus(plan: ActionPlan): ActionPlan["status"] {
  if (plan.stages.length === 0) return plan.status;
  const nonRecurring = plan.stages.filter((s) => s.repeatEverySteps === null);
  if (nonRecurring.length === 0) return plan.status;
  const allTerminal = nonRecurring.every((s) => s.status === "completed" || s.status === "failed" || s.status === "superseded");
  if (!allTerminal) return plan.status === "draft" ? "active" : plan.status;
  return nonRecurring.some((s) => s.status === "failed") ? "failed" : "completed";
}

/**
 * Re-checks nothing the caller has not already re-checked (feasibility is
 * advisory context the caller consults before calling this, docs/32's
 * invariants section) -- it only records the actual outcome, releases
 * reservations, and unblocks dependents. Refuses a stage that is not
 * `in_progress`.
 */
export function completePlanStage(
  plan: ActionPlan,
  stageId: string,
  atStep: number,
  outcome: { success: boolean; resultFactIds: readonly string[]; statusReason?: string | null },
): ActionPlan | string {
  const stage = planStageOrError(plan, stageId);
  if (typeof stage === "string") return stage;
  if (stage.status !== "in_progress") return `Only an in-progress stage can complete; "${stageId}" is ${stage.status}.`;
  const recurring = stage.repeatEverySteps !== null;
  const updated: ActionPlanStage = {
    ...stage,
    status: recurring ? "pending" : outcome.success ? "completed" : "failed",
    completedAtStep: atStep,
    resultFactIds: [...stage.resultFactIds, ...outcome.resultFactIds],
    statusReason: outcome.statusReason ?? stage.statusReason,
    reservationIds: [],
  };
  const plans = { ...plan, updatedAtStep: atStep, stages: plan.stages.map((s) => (s.id === stageId ? updated : s)) };
  return { ...plans, status: derivePlanStatus(plans) };
}

/** Convenience for a stage whose start and completion are the same instant -- most built-in actions today. */
export function attemptPlanStageAtomically(
  plan: ActionPlan,
  stageId: string,
  atStep: number,
  outcome: { success: boolean; resultFactIds: readonly string[]; statusReason?: string | null },
): ActionPlan | string {
  const started = startPlanStage(plan, stageId, atStep);
  if (typeof started === "string") return started;
  return completePlanStage(started, stageId, atStep, outcome);
}

/*
 * Unifying player, NPC, and world plans.
 *
 * `conflicts.ts` and the stage lifecycle above operate on `ActionPlan` with
 * no branch anywhere on `origin.kind` -- an NPC- or world-authored plan
 * goes through identical conflict detection, preemption, and
 * start/completion as a player's. `preparePlayerPlans` originates the
 * player's own directive-sourced plans; `originateActionPlan` below
 * generalizes the same construction to any origin, so an NPC's
 * self-directed intent or a world/institutional development can become a
 * first-class `ActionPlan` the same way a player's order does.
 *
 * What remains future work: sourcing real NPC intent from goals, pressures,
 * beliefs, and commitments, or real world intent from scheduled
 * developments, into a call to `originateActionPlan` -- today an NPC's
 * declared intent is still carried out atomically by the interpreter
 * (`gm/session.ts`'s `act`), not wrapped in its own tracked `ActionPlan`.
 */

/** Creates a fresh, unfinished `ActionPlan` for any origin -- the same starting shape `preparePlayerPlans` builds for a player's "new" directive, generalized. */
export function originateActionPlan(
  id: string,
  origin: ActionPlanOrigin,
  ownerCharacterId: string | null,
  rawText: string,
  atStep: number,
  options: z.infer<typeof PlanOptionsSchema> = PlanOptionsSchema.parse({}),
): ActionPlan {
  return ActionPlanSchema.parse({
    id,
    origin,
    ownerCharacterId,
    rawText,
    revisions: [{ atStep, text: rawText }],
    options,
    interpretation: "",
    status: "draft",
    stages: [],
    assignments: [],
    spent: 0,
    createdAtStep: atStep,
    updatedAtStep: atStep,
  });
}

/**
 * A named delegate or assignee accepts or declines, regardless of who or
 * what originated the plan -- the same acceptance record `respond_to_plan_
 * assignment` writes for a player's plan today, generalized to any origin.
 * Acceptance grants no resources or authority by itself (unchanged rule).
 */
export function respondToActionPlanAssignment(plan: ActionPlan, actorId: string, accepted: boolean, reason: string): ActionPlan {
  return { ...plan, assignments: [...plan.assignments.filter((a) => a.actorId !== actorId), { actorId, accepted, reason }] };
}
