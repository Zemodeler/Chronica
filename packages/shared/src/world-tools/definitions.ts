import { z } from "zod";
import { EntityIdSchema, MoneyAmountSchema } from "../material-state";
import { OrderPartyRefSchema } from "../actions/orders";
import { openReservation } from "../world/money-reservations";
import { ProjectSchema } from "../world/project";
import type { AnyWorldToolDefinition, WorldToolDefinition } from "./types";

// A representative slice of the ~20 spec verbs (docs/32, Part C.1), not the
// full catalog -- enough to prove the dispatch-first pattern against real
// workflows (`transfer_resource`, `change_control`) and a genuinely new
// primitive with no existing workflow equivalent (`reserve_resource`,
// `create_project`). Extending this list with the rest (`create_entity`,
// `create_structure`, `issue_order`, ...) is additive: each is one more
// `WorldToolDefinition`, never a change to this file's existing entries.

const TransferResourceParams = z.object({
  sourceAccountId: EntityIdSchema,
  destinationAccountId: EntityIdSchema,
  amount: z.number().int().positive(),
  reason: z.string().min(1).max(240),
}).strict();

export const transferResourceTool: AnyWorldToolDefinition = {
  id: "transfer_resource",
  description: "Move money from one account to another, never exceeding what the source account can currently spend after its own project reservations.",
  parametersSchema: TransferResourceParams,
  authorityRequirement: (params) => ({ domain: "fiscal", power: "spend", scope: { kind: "account", id: params.sourceAccountId } }),
  dispatch: (_world, params) => ({ workflowId: "transfer_gold", workflowParams: params }),
};

const ChangeControlParams = z.object({
  provinceId: EntityIdSchema,
  newControllerPolityId: EntityIdSchema.nullable(),
  firmnessBps: z.number().int().min(0).max(10_000).default(5_000),
  reason: z.string().min(1).max(240),
}).strict();

export const changeControlTool: AnyWorldToolDefinition = {
  id: "change_control",
  description: "Record a change of control over a province, opening a new active control record without touching any polity's existing claim to it.",
  parametersSchema: ChangeControlParams,
  dispatch: (_world, params) => ({ workflowId: "change_province_control", workflowParams: params }),
};

const ReserveResourceParams = z.object({
  accountId: EntityIdSchema,
  currencyId: EntityIdSchema,
  amount: MoneyAmountSchema.positive(),
  purposeId: EntityIdSchema,
  reason: z.string().min(1).max(240),
}).strict();

export const reserveResourceTool: AnyWorldToolDefinition = {
  id: "reserve_resource",
  description: "Earmark funds against an account for a named project, so an ordinary spend cannot later eat into what the project already committed. No registered workflow does this -- it is the generic primitive.",
  parametersSchema: ReserveResourceParams,
  authorityRequirement: (params) => ({ domain: "fiscal", power: "spend", scope: { kind: "account", id: params.accountId } }),
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    const reservation = openReservation(world.material, {
      id: `reservation:${params.accountId}:${params.purposeId}:${ctx.atStep}:${world.material.reservations.length}`,
      accountId: params.accountId,
      currencyId: params.currencyId,
      amount: params.amount,
      purposeId: params.purposeId,
      atStep: ctx.atStep,
    });
    if (reservation === null) {
      return { ok: false, reason: `Account "${params.accountId}" cannot currently spend ${params.amount}; some or all of its balance is already reserved elsewhere.` };
    }
    return {
      ok: true,
      world: { ...world, material: { ...world.material, reservations: [...world.material.reservations, reservation] } },
      summary: `${params.amount} reserved from ${params.accountId} for ${params.purposeId}. ${params.reason}`,
    };
  },
};

const ProjectMilestoneInputSchema = z.object({
  id: EntityIdSchema,
  label: z.string().trim().min(1).max(160),
  requiredAtElapsedOffset: z.number().int().nonnegative(),
  costAmount: MoneyAmountSchema,
  linkedWorkflowId: EntityIdSchema.nullable().default(null),
  linkedWorkflowParams: z.record(z.string(), z.unknown()).default({}),
}).strict();

const CreateProjectParams = z.object({
  kind: z.string().trim().min(1).max(80),
  sponsorEntityRef: OrderPartyRefSchema,
  label: z.string().trim().min(1).max(160),
  milestones: z.array(ProjectMilestoneInputSchema).min(1).max(20),
  completionWorkflowId: EntityIdSchema.nullable().default(null),
  completionWorkflowParams: z.record(z.string(), z.unknown()).default({}),
  /** When given, opens the reservation that funds every milestone's `costAmount` up front. */
  fundingAccountId: EntityIdSchema.nullable().default(null),
  fundingCurrencyId: EntityIdSchema.nullable().default(null),
}).strict();

export const createProjectTool: WorldToolDefinition<z.infer<typeof CreateProjectParams>> = {
  id: "create_project",
  description: "Start a multi-turn sponsored effort (an academy, a fortress): reserves its funding up front and schedules its milestones, each of which may invoke one registered workflow when it comes due.",
  parametersSchema: CreateProjectParams,
  authorityRequirement: (params) => (params.fundingAccountId === null ? null : { domain: "fiscal", power: "spend", scope: { kind: "account", id: params.fundingAccountId } }),
  dispatch: () => null,
  fallback: (world, params, ctx) => {
    const totalCost = params.milestones.reduce((sum, milestone) => sum + milestone.costAmount, 0);
    let reservationId: string | null = null;
    let material = world.material;
    if (params.fundingAccountId !== null && params.fundingCurrencyId !== null && totalCost > 0) {
      const reservation = openReservation(material, {
        id: `reservation:${params.fundingAccountId}:project:${ctx.atStep}:${material.reservations.length}`,
        accountId: params.fundingAccountId,
        currencyId: params.fundingCurrencyId,
        amount: totalCost,
        purposeId: `project:${params.label}`,
        atStep: ctx.atStep,
      });
      if (reservation === null) {
        return { ok: false, reason: `Account "${params.fundingAccountId}" cannot currently fund this project's total cost of ${totalCost}.` };
      }
      reservationId = reservation.id;
      material = { ...material, reservations: [...material.reservations, reservation] };
    }

    const projectId = `project:${ctx.atStep}:${world.projects.length}`;
    const parsedProject = ProjectSchema.safeParse({
      id: projectId,
      kind: params.kind,
      sponsorEntityRef: params.sponsorEntityRef,
      label: params.label,
      status: reservationId !== null ? "funded" : "proposed",
      reservationId,
      milestones: params.milestones.map((milestone) => ({ ...milestone, status: "pending" as const, completedAtStep: null })),
      completionWorkflowId: params.completionWorkflowId,
      completionWorkflowParams: params.completionWorkflowParams,
      linkedEntityIds: [],
      startedAtStep: ctx.atStep,
      targetCompletionStep: null,
      completedAtStep: null,
      provenanceEventIds: [],
    });
    if (!parsedProject.success) {
      return { ok: false, reason: `A milestone names a workflow that is not registered: ${parsedProject.error.issues.map((issue) => issue.message).join("; ")}.` };
    }
    return {
      ok: true,
      world: { ...world, material, projects: [...world.projects, parsedProject.data] },
      summary: `${params.label} begun, with ${params.milestones.length} milestone(s) scheduled.`,
    };
  },
};

const ChangeOccupationParams = z.object({
  provinceId: EntityIdSchema,
  occupyingPolityId: EntityIdSchema.nullable(),
  forceId: EntityIdSchema.nullable().default(null),
  reason: z.string().min(1).max(240),
}).strict();

export const changeOccupationTool: AnyWorldToolDefinition = {
  id: "change_occupation",
  description: "Record which polity's forces physically occupy a province, independent of who legally controls it or claims it.",
  parametersSchema: ChangeOccupationParams,
  dispatch: (_world, params) => ({ workflowId: "change_occupation", workflowParams: params }),
};

const ChangeAdministrationParams = z.object({
  provinceId: EntityIdSchema,
  administeringPolityId: EntityIdSchema,
  taxCapacityBps: z.number().int().min(0).max(10_000).default(5_000),
  reason: z.string().min(1).max(240),
}).strict();

export const changeAdministrationTool: AnyWorldToolDefinition = {
  id: "change_administration",
  description: "Record who actually administers a province day to day -- may lag behind its formal controller during a contested handover.",
  parametersSchema: ChangeAdministrationParams,
  dispatch: (_world, params) => ({ workflowId: "change_administration", workflowParams: params }),
};

export const REPRESENTATIVE_WORLD_TOOLS: readonly AnyWorldToolDefinition[] = [
  transferResourceTool,
  changeControlTool,
  changeOccupationTool,
  changeAdministrationTool,
  reserveResourceTool,
  createProjectTool,
];
