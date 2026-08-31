import { z } from "zod";
import { EntityIdSchema } from "../material-state";

export const DirectConsequenceSchema = z
  .object({
    kind: z.enum(["material", "political", "social", "knowledge"]),
    label: z.string().trim().min(1).max(120),
    entityId: EntityIdSchema.nullable().default(null),
    quantified: z.boolean().default(false),
  })
  .strict();
export type DirectConsequence = z.infer<typeof DirectConsequenceSchema>;
