import { z } from "zod";
import { EntityIdSchema, ElapsedStepSchema, MoneyAmountSchema } from "../material-state";
import type { WorldState } from "../world/world-state";
import type { OrderDirective } from "./orders";

export const PlanOptionsSchema = z.object({
  method: z.string().trim().max(400).default(""),
  constraints: z.string().trim().max(800).default(""),
  secrecy: z.enum(["public", "discreet", "secret"]).default("public"),
  delegateIds: z.array(EntityIdSchema).max(8).default([]),
  budget: z.object({ accountId: EntityIdSchema, amount: MoneyAmountSchema }).strict().nullable().default(null),
}).strict();

export const PlanStageInputSchema = z.object({
  id: EntityIdSchema,
  objective: z.string().trim().min(1).max(400),
  actorId: EntityIdSchema,
  dependsOn: z.array(EntityIdSchema).max(12).default([]),
  notBeforeStep: ElapsedStepSchema.nullable().default(null),
  provinceId: EntityIdSchema.nullable().default(null),
  repeatEverySteps: z.number().int().min(1).max(100).nullable().default(null),
}).strict();
export const PlayerPlanSchema = z.object({
  id: EntityIdSchema,
  ownerId: EntityIdSchema,
  sourceDirectiveId: z.string().min(1).max(120),
  rawText: z.string().min(1).max(4_000),
  revisions: z.array(z.object({ atStep: ElapsedStepSchema, text: z.string().min(1).max(4_000) }).strict()).min(1),
  options: PlanOptionsSchema,
  interpretation: z.string().max(800),
  status: z.enum(["active", "completed", "cancelled"]),
  stages: z.array(PlanStageInputSchema.extend({
    status: z.enum(["pending", "blocked", "completed"]),
    reason: z.string().max(600).nullable(),
    factRefs: z.array(z.string().max(120)),
    lastCompletedStep: ElapsedStepSchema.nullable().default(null),
  }).strict()).max(12),
  assignments: z.array(z.object({ actorId: EntityIdSchema, accepted: z.boolean(), reason: z.string().min(1).max(400) }).strict()).max(8),
  spent: MoneyAmountSchema,
  createdAtStep: ElapsedStepSchema,
  updatedAtStep: ElapsedStepSchema,
}).strict();
export type PlayerPlan = z.infer<typeof PlayerPlanSchema>;

export const InterpretPlanSchema = z.object({
  planId: EntityIdSchema,
  interpretation: z.string().trim().min(1).max(800),
  stages: z.array(PlanStageInputSchema).min(1).max(12),
  /** Method, conditions, secrecy, delegates and any spending cap, inferred from the plan's own text -- never invented beyond what it actually says. */
  options: PlanOptionsSchema,
}).strict();
export const ExecutePlanStageSchema = z.object({ planId: EntityIdSchema, stageId: EntityIdSchema, actionId: EntityIdSchema, parameters: z.record(z.string(), z.unknown()).default({}) }).strict();
export const RespondToAssignmentSchema = z.object({ planId: EntityIdSchema, actorId: EntityIdSchema, accepted: z.boolean(), reason: z.string().trim().min(1).max(400) }).strict();
export const DeferPlanStageSchema = z.object({ planId: EntityIdSchema, stageId: EntityIdSchema, reason: z.string().trim().min(1).max(600) }).strict();

/** Submitted text is immutable history. Revisions preserve completed stages and require reinterpretation. */
export function preparePlayerPlans(world: WorldState, ownerId: string, atStep: number, directives: readonly { id: string; directive: OrderDirective }[]): WorldState {
  let plans = (world.playerPlans ?? []).map(p => p.status !== "active" || p.ownerId !== ownerId ? p : { ...p, stages: p.stages.map(s =>
    s.repeatEverySteps !== null && s.lastCompletedStep !== null && s.lastCompletedStep + s.repeatEverySteps <= atStep
      ? { ...s, status: "pending" as const } : s) });
  for (const { id, directive } of directives) {
    if (directive.kind === "new") {
      const planId = `plan-${atStep}-${id}`;
      if (plans.some(p => p.id === planId)) continue;
      plans.push({ id: planId, ownerId, sourceDirectiveId: id, rawText: directive.text, revisions: [{ atStep, text: directive.text }],
        options: PlanOptionsSchema.parse({}), interpretation: "", status: "active", stages: [], assignments: [], spent: 0, createdAtStep: atStep, updatedAtStep: atStep });
    } else {
      plans = plans.map(p => {
        if (p.id !== directive.actionId || p.ownerId !== ownerId || p.status !== "active") return p;
        if (directive.kind === "cancel") return { ...p, status: "cancelled", updatedAtStep: atStep };
        return { ...p, rawText: directive.text, interpretation: "", stages: p.stages.filter(s => s.status === "completed"),
          assignments: [], revisions: [...p.revisions, { atStep, text: directive.text }], updatedAtStep: atStep };
      });
    }
  }
  const cancelled = new Set(plans.filter(p => p.ownerId === ownerId && p.status === "cancelled").map(p => p.id));
  const stoppedActionIds = new Set(world.actions.filter(a => cancelled.has(a.sourceIntentId) && (a.status === "active" || a.status === "waiting")).map(a => a.id));
  return { ...world,
    actions: world.actions.map(a => stoppedActionIds.has(a.id) ? { ...a, status: "cancelled", terminalReason: "The player cancelled the originating plan.", updatedAtStep: atStep } : a),
    operations: world.operations.map(o => stoppedActionIds.has(o.originatingOrderId) && (o.status === "active" || o.status === "paused") ? { ...o, status: "cancelled", statusReason: "The player cancelled the originating plan.", updatedAtStep: atStep } : o),
    playerPlans: [...plans.filter(p => p.status === "active"), ...plans.filter(p => p.status !== "active").sort((a, b) => b.updatedAtStep - a.updatedAtStep).slice(0, 64)] };
}

export function interpretPlan(world: WorldState, ownerId: string, input: z.infer<typeof InterpretPlanSchema>, atStep: number): WorldState | string {
  const plan = world.playerPlans?.find(p => p.id === input.planId && p.ownerId === ownerId && p.status === "active");
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
  const ids = new Set<string>();
  const completed = plan.stages.filter(s => s.status === "completed");
  for (const stage of input.stages) {
    if (ids.has(stage.id)) return "Each stage needs a unique identity.";
    if (stage.dependsOn.some(id => !ids.has(id))) return "Dependencies must name an earlier stage; circular plans cannot proceed.";
    if (stage.actorId !== ownerId && !input.options.delegateIds.includes(stage.actorId)) return "This person was not named as a delegate in the plan's own text.";
    if (!world.characters.some(c => c.id === stage.actorId && c.alive)) return "Every executor must be a living character.";
    if (stage.provinceId !== null && !world.map.provinces.some(p => p.id === stage.provinceId)) return "A stage condition names an unknown province.";
    const old = completed.find(s => s.id === stage.id);
    if (old && JSON.stringify({ ...stage, status: old.status, reason: old.reason, factRefs: old.factRefs, lastCompletedStep: old.lastCompletedStep }) !== JSON.stringify(old)) return "Completed stages cannot be changed or repeated.";
    ids.add(stage.id);
  }
  if (completed.some(s => !ids.has(s.id))) return "Keep completed stages as the plan's history.";
  return { ...world, playerPlans: world.playerPlans!.map(p => p.id !== plan.id ? p : { ...p, interpretation: input.interpretation, options: input.options, updatedAtStep: atStep,
    stages: input.stages.map(s => completed.find(c => c.id === s.id) ?? { ...s, status: "pending", reason: null, factRefs: [], lastCompletedStep: null }) }) };
}

/**
 * How much a stage actually debited from the accounts it touched. A stated
 * plan budget is guidance for the Game Master's own judgement, not a
 * deterministic spending cap -- so this only measures the debit, it never
 * refuses one.
 */
export function planSpending(before: WorldState, after: WorldState, plan: PlayerPlan): number {
  if (!plan.options.budget) return 0;
  let debit = 0;
  for (const account of before.material.accounts) {
    const remaining = after.material.accounts.find(a => a.id === account.id)?.balance ?? 0;
    debit += Math.max(0, account.balance - remaining);
  }
  return debit;
}
