import { z } from "zod";
import {
  ElapsedStepSchema,
  EntityIdSchema,
  VisibilitySchema,
} from "../material-state";
import { StateDeltaReferenceSchema } from "../actions/verdict";
import { SalienceSchema } from "../world/scope";
import { RelationCauseSchema } from "../characters/character";

// Character continuity (docs/16, ADR-0023).
//
// Chronica remembers people, not encounter slots. A commander defeated in one
// campaign may return with an injury, a diminished reputation and a better
// reason to be cautious -- never because a narrative director scheduled it, but
// because the same person kept living in the same world and found a legal route
// back into the players' affairs.
//
// The bound matters as much as the memory. Keeping every encountered person at
// full fidelity would quietly recreate the whole-world simulation that ADR-0017
// exists to prevent, so a capped set keeps full agency and the rest keep
// identity and one coarse plan.

/**
 * Distinct from the Focus / Near / Far detail tier.
 *
 * Focus answers how closely a place or person is currently simulated.
 * Continuity answers what must survive when attention leaves.
 */
export const ContinuityTierSchema = z.enum(["ordinary", "remembered", "principal"]);
export type ContinuityTier = z.infer<typeof ContinuityTierSchema>;

export const EncounterKindSchema = z.enum([
  "meeting",
  "battle",
  "capture",
  "ransom",
  "truce",
  "betrayal",
  "rescue",
  "marriage",
  "appointment",
  "debt",
  "scheme",
  "conversation",
  "other",
]);
export type EncounterKind = z.infer<typeof EncounterKindSchema>;

/**
 * A structured fact, not prose.
 *
 * Memory follows knowledge: a character gains a relationship cause only if they
 * experienced the encounter, witnessed it, or later learned it through a valid
 * channel. A secret betrayal does not create a magical grudge in someone who
 * cannot know it happened.
 */
export const EncounterMemorySchema = z
  .object({
    id: EntityIdSchema,
    participantIds: z.array(EntityIdSchema).min(2),
    occurredAtStep: ElapsedStepSchema,
    turnId: EntityIdSchema,
    kind: EncounterKindSchema,
    outcome: z.string().trim().min(1).max(400),
    visibility: VisibilitySchema,
    witnessIds: z.array(EntityIdSchema),
    salience: SalienceSchema,
    /** Every mechanical change this caused points back here. */
    consequences: z.array(StateDeltaReferenceSchema),
    chronicleFactId: EntityIdSchema.nullable(),
  })
  .strict();
export type EncounterMemory = z.infer<typeof EncounterMemorySchema>;

/**
 * One coarse intention, kept for a remembered character outside Focus.
 *
 * Near and Far rules advance this trajectory cheaply. Far-to-Near promotion is
 * a deterministic, free refinement; it does not reroll the character's
 * intervening life.
 */
export const NpcPlanSchema = z
  .object({
    actionId: EntityIdSchema,
    targetIds: z.array(EntityIdSchema),
    originatingAmbitionId: EntityIdSchema.nullable(),
    progressSteps: z.number().int().nonnegative(),
    expectedSteps: z
      .object({ min: z.number().int().positive(), max: z.number().int().positive() })
      .strict()
      .nullable(),
  })
  .strict();
export type NpcPlan = z.infer<typeof NpcPlanSchema>;

export const CharacterContinuitySchema = z
  .object({
    characterId: EntityIdSchema,
    tier: ContinuityTierSchema,
    /** Derived by rule and versioned with the simulation, never edited by a narrator. */
    notability: z.number().int().nonnegative(),
    encounterIds: z.array(EntityIdSchema),
    /** Lasting consequences, each naming the encounter that caused it. */
    lastingChanges: z.array(StateDeltaReferenceSchema),
    plan: NpcPlanSchema.nullable(),
  })
  .strict();
export type CharacterContinuity = z.infer<typeof CharacterContinuitySchema>;

/**
 * The host's pinned continuity allowance.
 *
 * Chosen at match creation and immutable after the first turn opens, so a
 * replay derives the same capacity. The remaining credit balance and current
 * server load never influence it.
 */
export const ContinuityConfigSchema = z
  .object({
    startingSeatCount: z.number().int().positive().max(32),
    extraPrincipalsPerPlayer: z.number().int().min(0).max(3),
    /**
     * The total named characters a running game may ever hold (character-sim
     * phase 5) -- the bound that stops runtime character creation (births,
     * world-director introductions) from becoming an unbounded population
     * simulator. Additive/defaulted so every pre-phase-5 scenario stays valid.
     */
    maxTotalCharacters: z.number().int().positive().max(500).default(64),
  })
  .strict();
export type ContinuityConfig = z.infer<typeof ContinuityConfigSchema>;

/** The hard cap that stops continuity becoming a disguised whole-world simulation. */
export const MAX_PRINCIPALS = 32;

/**
 * Engine-level default population bound, used by any workflow that creates a
 * character (`create_world_character`, `create_child_character`) since a
 * workflow's pure `apply(world, params, context)` does not receive the
 * scenario's `ContinuityConfig` today -- only `WorldState`. A caller with the
 * scenario in hand (e.g. the resolution pipeline) may enforce the scenario's
 * own `maxTotalCharacters` instead; this is the floor every workflow applies
 * regardless.
 */
export const DEFAULT_MAX_TOTAL_CHARACTERS = 64;

/** True if the world may still gain one more named character under the given bound. */
export function canCreateCharacter(characterCount: number, maxTotalCharacters: number = DEFAULT_MAX_TOTAL_CHARACTERS): boolean {
  return characterCount < maxTotalCharacters;
}

/**
 * A relationship an heir inherits, and the reason it carries.
 *
 * Relationships belong to characters, not player accounts, so a successor never
 * receives copied scores. They receive explicit causes for facts the NPC knows
 * and that plausibly carry: kinship, public deeds, inherited debt, a sworn
 * promise, a blood feud.
 */
export const LegacyCauseSchema = z
  .object({
    holderCharacterId: EntityIdSchema,
    successorCharacterId: EntityIdSchema,
    predecessorCharacterId: EntityIdSchema,
    cause: RelationCauseSchema,
  })
  .strict();
export type LegacyCause = z.infer<typeof LegacyCauseSchema>;
