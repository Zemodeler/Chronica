import { z } from "zod";
import { PolityAgreementKindSchema } from "./agreements";
import { StandingEffectSchema, StandingUpkeepSchema } from "./standing-effects";
import { StructureKindSchema } from "./structure";
import { ElapsedStepSchema, EntityIdSchema, MoneyAmountSchema } from "../material-state";
import { OrderPartyRefSchema } from "./party-ref";

// A multi-turn sponsored effort -- an academy, a fleet, an invasion -- that
// spends at each milestone and finally produces something.
//
// It used to name registered workflows to invoke, and the engine that ran them
// was removed with the turn system. For a while that left a project able to
// complete and yield nothing at all: VISION §8's naval expansion was marked
// finished and not one ship existed. `completionOutcome` replaces those dead
// references with the thing the project is actually for, declared at the moment
// the project is invented and applied by the tick when the last milestone falls.

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
    completedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type ProjectMilestone = z.infer<typeof ProjectMilestoneSchema>;

/**
 * What a finished project leaves behind.
 *
 * Deliberately a short closed list rather than an open effect language: the
 * model already has the whole delta union for anything else it wants to do, and
 * an arbitrary effect the tick had to interpret would be a second, weaker way of
 * changing the world. These are the things that can only be produced *later*,
 * by a clock, with nobody in the room to propose them.
 */
export const ProjectCompletionOutcomeSchema = z
  .object({
    kind: z.enum(["force", "structure", "income_source", "force_move", "agreement", "transfer", "none"]),
    label: z.string().trim().min(1).max(160),
    /** Men for a force, garrison capacity for a structure, revenue per period for an income source. */
    amount: z.number().int().nonnegative().max(10_000_000).default(0),
    provinceId: EntityIdSchema.nullable().default(null),
    polityId: EntityIdSchema.nullable().default(null),
    commanderCharacterId: EntityIdSchema.nullable().default(null),
    /** For "force_move": the army that arrives somewhere when the journey ends. */
    forceId: EntityIdSchema.nullable().default(null),
    /** For "force": the kind of troops raised -- "warship" for a fleet. Absent is infantry. */
    categoryId: EntityIdSchema.optional(),
    beneficiaryAccountId: EntityIdSchema.nullable().default(null),
    cadenceDays: z.number().int().positive().max(36_600).nullable().default(null),
    /** For "agreement": what the two powers end up standing in, and with whom. */
    agreementKind: PolityAgreementKindSchema.nullable().default(null),
    withPolityId: EntityIdSchema.nullable().default(null),
    /** For "structure": what kind of building it is, what it goes on doing, and who pays to keep it. */
    structureKind: StructureKindSchema.optional(),
    effects: z.array(StandingEffectSchema).max(6).optional(),
    upkeep: StandingUpkeepSchema.nullable().optional(),
  })
  .strict();
export type ProjectCompletionOutcome = z.infer<typeof ProjectCompletionOutcomeSchema>;

export const ProjectStatusSchema = z.enum(["proposed", "funded", "in_progress", "completed", "cancelled", "failed"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.string().trim().min(1).max(80),
    sponsorEntityRef: OrderPartyRefSchema,
    label: z.string().trim().min(1).max(160),
    status: ProjectStatusSchema,
    /** Who pays each stage. Null falls back to the sponsor's own account. */
    fundingAccountId: EntityIdSchema.nullable().optional(),
    /**
     * Who has charge of the work. Named by the engine when the order named
     * nobody (`chooseOverseer`), so a ruler does not have to put a man over
     * every fleet and granary himself; the men a finished force produces
     * answer to him when the outcome names no commander.
     */
    overseerCharacterId: EntityIdSchema.nullable().optional(),
    /** The `MoneyReservation` funding this project, once one has been opened. */
    reservationId: EntityIdSchema.nullable().default(null),
    milestones: z.array(ProjectMilestoneSchema).min(1).max(20),
    /** What exists once the last milestone falls. Null for an effort whose only product is that it happened. */
    completionOutcome: ProjectCompletionOutcomeSchema.nullable().default(null),
    /** Entities this project has already produced (a founded institution, a raised structure). */
    linkedEntityIds: z.array(EntityIdSchema).max(20).default([]),
    startedAtStep: ElapsedStepSchema,
    targetCompletionStep: ElapsedStepSchema.nullable().default(null),
    completedAtStep: ElapsedStepSchema.nullable().default(null),
    /** So an entity this project later produces can point back at why it exists. */
    provenanceEventIds: z.array(z.string().max(120)).max(20).default([]),
  })
  .strict();
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
