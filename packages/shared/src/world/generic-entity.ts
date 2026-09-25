import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { OrderPartyRefSchema } from "./party-ref";
import { MechanicSchema } from "./mechanic";
import { StandingEffectsCarrierShape } from "./standing-effects";

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
    /** Where it stands, when it stands somewhere: the church's seat, the school's town. Null for a law of the whole realm. */
    provinceId: EntityIdSchema.nullable().optional(),
    /**
     * What it goes on doing (see `world/standing-effects.ts`). An arrangement
     * used to be a record whose effects the model was asked to remember to
     * carry out; now it carries them.
     */
    ...StandingEffectsCarrierShape,
    /**
     * The rule behind it, when the world wrote one (`world/mechanic.ts`): what
     * it does each month, to whom, and what stops it. Absent for an arrangement
     * that is only its standing effects.
     */
    mechanic: MechanicSchema.optional(),
  })
  .strict();
export type GenericEntity = z.infer<typeof GenericEntitySchema>;
