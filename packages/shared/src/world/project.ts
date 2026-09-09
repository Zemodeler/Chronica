import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, MoneyAmountSchema } from "../material-state";
import { OrderPartyRefSchema } from "../actions/orders";
import { WORKFLOW_REGISTRY } from "../workflows/registry";

// Generalizes `PoliticalProcedure.linkedWorkflowId` (docs/32, Part C.2): a
// multi-turn sponsored effort -- an academy, a fortress -- reserves funds up
// front and, at each milestone, spends from that reservation and invokes one
// already-registered, already-validated workflow. Every `linkedWorkflowId`/
// `completionWorkflowId` is checked against `WORKFLOW_REGISTRY` at creation,
// the same discipline `sponsor_procedure` already applies -- this is not a
// new kind of unrestricted patch, only a schedule for calling real workflows.

export const ProjectMilestoneStatusSchema = z.enum(["pending", "completed", "skipped"]);
export type ProjectMilestoneStatus = z.infer<typeof ProjectMilestoneStatusSchema>;

export const ProjectMilestoneSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(160),
    /** Elapsed steps after the project starts that this milestone becomes due. */
    requiredAtElapsedOffset: z.number().int().nonnegative(),
    costAmount: MoneyAmountSchema,
    status: ProjectMilestoneStatusSchema,
    /** The registered workflow this milestone invokes on completion, if any -- purely bookkeeping milestones (e.g. "funding secured") may have none. */
    linkedWorkflowId: EntityIdSchema.nullable().default(null),
    linkedWorkflowParams: z.record(z.string(), z.unknown()).default({}),
    completedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type ProjectMilestone = z.infer<typeof ProjectMilestoneSchema>;

export const ProjectStatusSchema = z.enum(["proposed", "funded", "in_progress", "completed", "cancelled", "failed"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.string().trim().min(1).max(80),
    sponsorEntityRef: OrderPartyRefSchema,
    label: z.string().trim().min(1).max(160),
    status: ProjectStatusSchema,
    /** The `MoneyReservation` funding this project, once one has been opened. */
    reservationId: EntityIdSchema.nullable().default(null),
    milestones: z.array(ProjectMilestoneSchema).min(1).max(20),
    /** Invoked once, on the final milestone's completion -- the project's one authorized final effect. */
    completionWorkflowId: EntityIdSchema.nullable().default(null),
    completionWorkflowParams: z.record(z.string(), z.unknown()).default({}),
    /** Entities this project has already produced (a founded institution, a raised structure). */
    linkedEntityIds: z.array(EntityIdSchema).max(20).default([]),
    startedAtStep: ElapsedStepSchema,
    targetCompletionStep: ElapsedStepSchema.nullable().default(null),
    completedAtStep: ElapsedStepSchema.nullable().default(null),
    /** So an entity this project later produces can point back at why it exists. */
    provenanceEventIds: z.array(z.string().max(120)).max(20).default([]),
  })
  .strict()
  .superRefine((project, context) => {
    project.milestones.forEach((milestone, index) => {
      if (milestone.linkedWorkflowId !== null && !WORKFLOW_REGISTRY.has(milestone.linkedWorkflowId)) {
        context.addIssue({ code: "custom", path: ["milestones", index, "linkedWorkflowId"], message: `"${milestone.linkedWorkflowId}" is not a registered workflow.` });
      }
    });
    if (project.completionWorkflowId !== null && !WORKFLOW_REGISTRY.has(project.completionWorkflowId)) {
      context.addIssue({ code: "custom", path: ["completionWorkflowId"], message: `"${project.completionWorkflowId}" is not a registered workflow.` });
    }
  });
export type Project = z.infer<typeof ProjectSchema>;

/** The earliest pending milestone due by `atStep`, if any -- what `advance_project` (Part A's event queue) would act on next. */
export function nextDueMilestone(project: Project, atStep: number): ProjectMilestone | undefined {
  return project.milestones.find(
    (milestone) => milestone.status === "pending" && project.startedAtStep + milestone.requiredAtElapsedOffset <= atStep,
  );
}

/** Marks one milestone completed and, if it was the last one, completes the project. Pure -- the caller still spends the reservation and invokes the linked workflow. */
export function completeMilestone(project: Project, milestoneId: string, atStep: number): Project {
  const milestones = project.milestones.map((milestone) =>
    milestone.id === milestoneId ? { ...milestone, status: "completed" as const, completedAtStep: atStep } : milestone,
  );
  const allDone = milestones.every((milestone) => milestone.status !== "pending");
  return {
    ...project,
    milestones,
    status: allDone ? "completed" : "in_progress",
    completedAtStep: allDone ? atStep : project.completedAtStep,
  };
}
