import { z } from "zod";
import { EntityIdSchema, ElapsedStepSchema } from "../material-state";
import { OrderPartyRefSchema } from "../actions/orders";
import { StarContextLevelSchema } from "../world/facts";

/**
 * Star contexts (docs/32, Phase 7): the dynamic hierarchy
 * person -> unit -> settlement -> province -> region -> theatre -> polity ->
 * world a decision point selects the smallest of, to address an event
 * without needing a rich per-NPC agent for every affected entity. Re-exports
 * `StarContextLevelSchema` from `world/facts.ts` (where it lives so
 * `Fact.eligibleReactionScopes` can use the same enum) rather than defining
 * a second copy.
 */
export { StarContextLevelSchema };
export type { StarContextLevel } from "../world/facts";

export const StarContextSchema = z
  .object({
    id: EntityIdSchema,
    level: StarContextLevelSchema,
    scopeRef: OrderPartyRefSchema,
    label: z.string().trim().min(1).max(160),
    /** Who currently "speaks for" this context, if anyone -- see `resolveRepresentative`. */
    representativeCharacterId: EntityIdSchema.nullable(),
    /** Hierarchy link, e.g. unit -> settlement -> province -> region -> theatre -> polity -> world. */
    parentContextId: EntityIdSchema.nullable(),
    activatedAtStep: ElapsedStepSchema,
    lastAddressedAtStep: ElapsedStepSchema.nullable(),
  })
  .strict();
export type StarContext = z.infer<typeof StarContextSchema>;

/** A named grouping of provinces, either scenario-authored or inferred by contiguous same-controller provinces (`deriveRegions`). */
export const RegionSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(160),
    provinceIds: z.array(EntityIdSchema).min(1),
  })
  .strict();
export type Region = z.infer<typeof RegionSchema>;

/** A war's belligerents and the provinces currently contested between them -- derived on demand, never persisted (front lines move). */
export interface Theatre {
  readonly id: string;
  readonly polityAId: string;
  readonly polityBId: string;
  readonly provinceIds: readonly string[];
}
