import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { OrderPartyRefSchema } from "./orders";

// Persistent operations (docs/14, Phase 1 of the unified-resolution redesign).
//
// An `OngoingAction` (orders.ts) is one order's own status/history. A
// `PersistentOperation` is the multi-turn effort that order set in motion --
// moving an army, besieging a city, raising recruits -- and it is what makes
// "the operation continues under standing instructions" true without a new
// scheduler: it is checked once per turn, the same way `resolveDueProcedures`
// and `advancePressureLifecycle` already are, and is otherwise left alone.
//
// Concrete stage vocabularies (a siege's investment/assault/consolidation,
// a recruitment drive's levy/training stages) are a Phase 3 concern; `stage`
// here is deliberately a free label so this shape does not have to be
// rewritten once those vocabularies exist.

export const OperationStatusSchema = z.enum([
  "active",
  "completed",
  "failed",
  "paused",
  "cancelled",
  "superseded",
]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const TERMINAL_OPERATION_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "superseded",
] as const satisfies readonly OperationStatus[];

export const isTerminalOperationStatus = (status: OperationStatus): boolean =>
  (TERMINAL_OPERATION_STATUSES as readonly string[]).includes(status);

export const PersistentOperationSchema = z
  .object({
    id: EntityIdSchema,
    /** The `OngoingAction.id` that opened this operation. */
    originatingOrderId: EntityIdSchema,
    ownerRef: OrderPartyRefSchema,
    /** What the operation is trying to accomplish, e.g. "Take Messana". */
    objective: z.string().trim().min(1).max(400),
    /** Free-form current stage label; see module comment. */
    stage: z.string().trim().min(1).max(60),
    /** What the operation keeps doing while unattended, in the owner's own words. */
    standingInstructions: z.string().trim().max(600).default(""),
    risks: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    blockers: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    /** The next step at which this operation expects a decision or event; null if none is scheduled. */
    nextScheduledStep: ElapsedStepSchema.nullable().default(null),
    relatedForceIds: z.array(EntityIdSchema).max(20).default([]),
    /** Reserved for Phase 3's intra-province operational positions; empty until then. */
    relatedPositionIds: z.array(EntityIdSchema).max(20).default([]),
    relatedProcedureId: EntityIdSchema.nullable().default(null),
    relatedOperationIds: z.array(EntityIdSchema).max(10).default([]),
    status: OperationStatusSchema,
    /** Required once status is terminal; explains completion, failure, cancellation, or supersession. */
    statusReason: z.string().trim().min(1).max(300).nullable().default(null),
    startedAtStep: ElapsedStepSchema,
    updatedAtStep: ElapsedStepSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    if (isTerminalOperationStatus(operation.status) && operation.statusReason === null) {
      context.addIssue({
        code: "custom",
        path: ["statusReason"],
        message: "A terminal operation must state why it ended.",
      });
    }
  });
export type PersistentOperation = z.infer<typeof PersistentOperationSchema>;
