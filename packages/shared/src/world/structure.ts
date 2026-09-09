import { z } from "zod";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema } from "../material-state";

// A built, standing structure (docs/32, Part C.2's fortress worked example):
// distinct from a `Settlement` (a populated place) and from map-authority
// records (who holds ground) -- this is what garrisons a location and what
// existing siege/battle workflows read for a defensive bonus.

export const StructureSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum(["fortress", "wall", "watchtower", "depot", "academy_building", "other"]),
    name: z.string().trim().min(1).max(120),
    provinceId: EntityIdSchema,
    settlementId: EntityIdSchema.nullable().default(null),
    ownerPolityId: EntityIdSchema.nullable().default(null),
    garrisonCapacity: z.number().int().nonnegative().default(0),
    defensiveEffectsBps: BasisPointsSchema.default(0),
    /** How far this structure projects logistics support, in province hops. 0 = this location only. */
    supplyRadius: z.number().int().nonnegative().default(0),
    builtAtStep: ElapsedStepSchema,
    /** The project this structure was raised by, when it came from one (docs/32, Part C.2). */
    provenanceProjectId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type Structure = z.infer<typeof StructureSchema>;
