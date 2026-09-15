import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { OrderPartyRefSchema } from "./party-ref";

// The true generic fallback (docs/32, Part C.1): used only for a genuinely
// novel composition no typed schema (Force, Institution, Structure, Project,
// ...) fits. Deliberately unopinionated -- `attributes` is a flat bag, not a
// nested document -- so it stays a record of "something the model asked for
// and a developer should look at," never a second schema-less world-state
// mechanism competing with the typed ones.

export const GenericEntitySchema = z
  .object({
    id: EntityIdSchema,
    /** Freeform, e.g. "training_program", "policy" -- not validated against a closed enum, since novelty is the point. */
    kind: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    ownerRef: OrderPartyRefSchema.nullable().default(null),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
    linkedEntityIds: z.array(EntityIdSchema).max(20).default([]),
    createdAtStep: ElapsedStepSchema,
    provenanceEventIds: z.array(z.string().max(120)).max(20).default([]),
  })
  .strict();
export type GenericEntity = z.infer<typeof GenericEntitySchema>;
