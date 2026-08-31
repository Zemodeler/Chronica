import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";

export const ChronicleChainSchema = z
  .object({
    id: EntityIdSchema,
    rootCause: z.string().trim().min(1).max(320),
    storylineId: EntityIdSchema.nullable().default(null),
    entryIds: z.array(EntityIdSchema).max(8),
    resolved: z.boolean().default(false),
    openPressure: z.string().trim().max(320).nullable().default(null),
    createdAtStep: ElapsedStepSchema,
  })
  .strict();
export type ChronicleChain = z.infer<typeof ChronicleChainSchema>;
