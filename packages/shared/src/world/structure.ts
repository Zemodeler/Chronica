import { z } from "zod";
import { BasisPointsSchema, ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { StandingEffectsCarrierShape } from "./standing-effects";

// A built, standing structure (docs/32, Part C.2's fortress worked example):
// distinct from a `Settlement` (a populated place) and from map-authority
// records (who holds ground) -- this is what garrisons a location and what
// existing siege/battle workflows read for a defensive bonus.

/** The kinds a building can be. A kind nobody listed is "other", named by its name and made to matter by its effects. */
export const StructureKindSchema = z.enum(["fortress", "wall", "watchtower", "depot", "academy_building", "temple", "market", "monument", "other"]);
export type StructureKind = z.infer<typeof StructureKindSchema>;

export const StructureSchema = z
  .object({
    id: EntityIdSchema,
    kind: StructureKindSchema,
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
    /** What it goes on doing, and who pays to keep it (see `world/standing-effects.ts`). */
    ...StandingEffectsCarrierShape,
  })
  .strict();
export type Structure = z.infer<typeof StructureSchema>;
