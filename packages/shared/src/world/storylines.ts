import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";

/** A durable, world-owned thread of history rather than one-off narration. */
export const WorldStorylineSchema = z.object({
  id: EntityIdSchema,
  title: z.string().trim().min(1).max(160),
  participantIds: z.array(EntityIdSchema).max(16),
  provinceId: EntityIdSchema.nullable(),
  phase: z.string().trim().min(1).max(80),
  stakes: z.string().trim().min(1).max(320),
  history: z.array(z.string().trim().min(1).max(480)).max(24),
  nextDevelopment: z.string().trim().min(1).max(320),
  visibility: VisibilitySchema,
  updatedAtStep: ElapsedStepSchema,
}).strict();
export type WorldStoryline = z.infer<typeof WorldStorylineSchema>;
