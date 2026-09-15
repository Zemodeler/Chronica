import { z } from "zod";
import { EntityIdSchema } from "../material-state";

// Relocated from the removed `actions/verdict.ts` (see
// docs/plans/delete-chronicle-orders-turns.md) -- battle/warfare's own
// tactical-modifier shapes, self-contained aside from `EntityIdSchema`.

export const BattlePhaseSchema = z.enum([
  "contact",
  "engagement",
  "cohesion",
  "withdrawal",
  "aftermath",
]);
export type BattlePhase = z.infer<typeof BattlePhaseSchema>;

export const TacticalPreconditionSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    subjectId: EntityIdSchema.nullable(),
  })
  .strict();

export const ResourceCostSchema = z
  .object({
    resourceId: EntityIdSchema,
    amount: z.number().int().positive().safe(),
  })
  .strict();

/**
 * A bounded interpretation of a genuinely novel tactic (docs/19).
 *
 * There is no `decisive` magnitude and no casualty, retreat, control or victory
 * field, because the warfare engine alone decides those. The warfare rules
 * verify and cap this in Phase 5; the shape is fixed here so nothing can grow a
 * field that would let a model write battle state.
 */
export const TacticalModifierProposalSchema = z
  .object({
    battleId: EntityIdSchema,
    actorId: EntityIdSchema,
    factor: z.enum([
      "deployment",
      "surprise",
      "effective_strength",
      "cohesion",
      "morale",
      "withdrawal",
    ]),
    magnitude: z.enum(["minor", "meaningful"]),
    phases: z.array(BattlePhaseSchema).min(1),
    preconditions: z.array(TacticalPreconditionSchema).min(1),
    costs: z.array(ResourceCostSchema),
    rationale: z.string().trim().min(1).max(600),
  })
  .strict();
export type TacticalModifierProposal = z.infer<typeof TacticalModifierProposalSchema>;
