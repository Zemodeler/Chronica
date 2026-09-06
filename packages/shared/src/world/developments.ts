import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

/** Scheduled causes, not generated stories. One durable record per source. */
export const WorldDevelopmentSchema = z.object({
  id: z.string().min(1).max(400),
  kind: z.enum(["scarcity", "reconstruction", "civic", "war_burden", "household"]),
  sourceId: EntityIdSchema,
  actorId: EntityIdSchema,
  provinceId: EntityIdSchema.nullable(),
  summary: z.string().min(1).max(600),
  status: z.enum(["active", "resolved"]),
  intensity: z.number().int().min(0).max(100),
  reviews: z.number().int().nonnegative(),
  createdAtStep: ElapsedStepSchema,
  lastReviewedStep: ElapsedStepSchema,
  nextReviewStep: ElapsedStepSchema,
}).strict();

export type WorldDevelopment = z.infer<typeof WorldDevelopmentSchema>;
