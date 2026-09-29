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

/**
 * What a battle plan says it rests on, each of which the engine can check.
 *
 * A tactic used to be granted on its rationale alone, and the magnitude was
 * whatever its author asked for: four paragraphs of maniples and hidden Gauls
 * earned exactly what "I attack cleverly" earned, and that one word -- minor or
 * meaningful -- moved a battle further than the commander, the ground and the
 * odds together. Now a plan names what it depends on, the engine looks at the
 * field, and only what is actually true there counts.
 *
 * - `scouted_ground`: the attackers have taken up known ground in the province.
 * - `prepared_position`: that ground is worth something (a pass, a ford, a wall).
 * - `rough_ground`: the province is broken country, and the attackers move
 *   faster than the defenders -- which is what rough ground does to a phalanx.
 * - `superior_horse`: the attackers have more fast troops than the defenders.
 * - `second_force`: more than one army is coming in on the attacking side.
 * - `numbers`: the attackers bring at least a quarter as many men again.
 */
export const TacticalPremiseSchema = z.enum([
  "scouted_ground",
  "prepared_position",
  "rough_ground",
  "superior_horse",
  "second_force",
  "numbers",
]);
export type TacticalPremise = z.infer<typeof TacticalPremiseSchema>;
