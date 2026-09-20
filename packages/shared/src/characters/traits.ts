import { z } from "zod";
import { EntityIdSchema } from "../material-state";

// Trait registry (character-sim phase 2).
//
// `Character.traits` stays a plain `EntityId[]` -- a scenario can still author
// a trait id this registry doesn't know, the same forward-compatibility the
// rest of the schema already extends to scenario-defined offices and
// succession rules. This registry is what gives the *known* ids meaning:
// dialogue guidance, bounded decision-context modifiers, and incompatibility.
//
// Traits influence dialogue tone and (in a later phase) decision scoring.
// They never directly create resources, offices, military victories, or
// knowledge -- there is no field here for any such effect.

export const TraitCategorySchema = z.enum(["temperament", "social", "moral", "ambition"]);
export type TraitCategory = z.infer<typeof TraitCategorySchema>;

/** A bounded nudge on a named decision context, e.g. "negotiation": 8. Never resource/knowledge-granting. */
const DecisionModifiersSchema = z.record(z.string(), z.number().int().min(-20).max(20));

export const TraitDefinitionSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    category: TraitCategorySchema,
    dialogueGuidance: z.string().trim().min(1).max(300).optional(),
    decisionModifiers: DecisionModifiersSchema.default({}),
    incompatibleTraitIds: z.array(EntityIdSchema).default([]),
  })
  .strict();
export type TraitDefinition = z.infer<typeof TraitDefinitionSchema>;

function trait(def: z.input<typeof TraitDefinitionSchema>): TraitDefinition {
  return TraitDefinitionSchema.parse(def);
}

export const TRAIT_REGISTRY: Readonly<Record<string, TraitDefinition>> = {
  cautious: trait({
    id: "cautious", label: "Cautious", category: "temperament",
    dialogueGuidance: "Weighs risk before committing; prefers a smaller sure thing to a larger gamble.",
    decisionModifiers: { risk: -10, negotiation: 4 },
    incompatibleTraitIds: ["bold"],
  }),
  bold: trait({
    id: "bold", label: "Bold", category: "temperament",
    dialogueGuidance: "Acts decisively, sometimes before thinking it through.",
    decisionModifiers: { risk: 10, caution: -6 },
    incompatibleTraitIds: ["cautious"],
  }),
  ambitious: trait({
    id: "ambitious", label: "Ambitious", category: "ambition",
    dialogueGuidance: "Measures every opportunity against their own advancement.",
    decisionModifiers: { status: 10 },
  }),
  dutiful: trait({
    id: "dutiful", label: "Dutiful", category: "moral",
    dialogueGuidance: "Honors obligations even at personal cost.",
    decisionModifiers: { obligation: 10, betrayal: -10 },
    incompatibleTraitIds: ["deceitful"],
  }),
  vengeful: trait({
    id: "vengeful", label: "Vengeful", category: "moral",
    dialogueGuidance: "Remembers a wrong and looks for a chance to settle it.",
    decisionModifiers: { revenge: 12 },
    incompatibleTraitIds: ["compassionate"],
  }),
  sociable: trait({
    id: "sociable", label: "Sociable", category: "social",
    dialogueGuidance: "Warms to people quickly and enjoys company.",
    decisionModifiers: { sociability: 10 },
  }),
  disciplined: trait({
    id: "disciplined", label: "Disciplined", category: "temperament",
    dialogueGuidance: "Sticks to a plan and a routine; distrusts impulse.",
    decisionModifiers: { discipline: 10 },
  }),
  deceitful: trait({
    id: "deceitful", label: "Deceitful", category: "moral",
    dialogueGuidance: "Comfortable shading the truth when it serves them.",
    decisionModifiers: { honesty: -12 },
    incompatibleTraitIds: ["dutiful"],
  }),
  compassionate: trait({
    id: "compassionate", label: "Compassionate", category: "moral",
    dialogueGuidance: "Feels for others' hardship and is slow to hold a grudge.",
    decisionModifiers: { cruelty: -12 },
    incompatibleTraitIds: ["vengeful", "cruel"],
  }),
  cruel: trait({
    id: "cruel", label: "Cruel", category: "moral",
    dialogueGuidance: "Indifferent to others' suffering, sometimes drawn to causing it.",
    decisionModifiers: { cruelty: 12 },
    incompatibleTraitIds: ["compassionate"],
  }),
};

/**
 * Somebody's judgment of somebody else, before it is anybody's character
 * (slice 11).
 *
 * `Character.traits` is written once, at creation, and never again: a man
 * declared cautious at the opening is cautious for the rest of his life
 * however boldly he plays. The decision taken at the table was that **the
 * people around you decide** what you are, so a trait arrives as an
 * observation by a named person who has actually dealt with you.
 *
 * One observation is not a character. A trait sticks only once two different
 * people have independently said the same thing -- which is what keeps a
 * single hostile legate from renaming the player "deceitful", and what makes
 * the second observation a real event rather than a duplicate.
 */
export const TraitObservationSchema = z
  .object({
    id: EntityIdSchema,
    /** Whose character is being judged. */
    characterId: EntityIdSchema,
    /** Who is judging. Never the same person: nobody observes themselves into a trait. */
    observerCharacterId: EntityIdSchema,
    traitId: EntityIdSchema,
    /** What they saw, in their own words. */
    note: z.string().trim().min(1).max(200),
    atStep: z.number().int().nonnegative(),
  })
  .strict();
export type TraitObservation = z.infer<typeof TraitObservationSchema>;

/** How many people must independently say it before it is who somebody is. */
export const TRAIT_CORROBORATION = 2;
/** The most traits anybody carries. Past this, the world has said enough about them. */
export const MAX_TRAITS = 8;

export interface TraitObservationOutcome {
  readonly observations: readonly TraitObservation[];
  /** Traits that just reached corroboration, with the people who said so. */
  readonly confirmed: readonly { readonly characterId: string; readonly traitId: string; readonly observerCharacterIds: readonly string[] }[];
  /** Why an observation was not recorded, for the record rather than for a rejection. */
  readonly refused: readonly { readonly traitId: string; readonly reason: string }[];
}

/**
 * Records what people have observed, and says which of it has become true.
 *
 * Pure: the caller owns the world. Refuses an observation rather than the
 * whole event -- an NPC naming a trait that does not exist has simply said
 * something the engine has no word for.
 */
export function observeTraits(
  existing: readonly TraitObservation[],
  proposals: readonly { readonly characterId: string; readonly observerCharacterId: string; readonly traitId: string; readonly note: string }[],
  traitsOf: (characterId: string) => readonly string[],
  atStep: number,
  nextId: (prefix: string) => string,
): TraitObservationOutcome {
  const observations = [...existing];
  const confirmed: { characterId: string; traitId: string; observerCharacterIds: string[] }[] = [];
  const refused: { traitId: string; reason: string }[] = [];

  for (const proposal of proposals) {
    const definition = TRAIT_REGISTRY[proposal.traitId];
    if (definition === undefined) {
      refused.push({ traitId: proposal.traitId, reason: "No such trait." });
      continue;
    }
    if (proposal.observerCharacterId === proposal.characterId) {
      refused.push({ traitId: proposal.traitId, reason: "Nobody observes themselves into a character." });
      continue;
    }
    const already = traitsOf(proposal.characterId);
    if (already.includes(proposal.traitId)) continue;
    if (already.length >= MAX_TRAITS) {
      refused.push({ traitId: proposal.traitId, reason: "The world has said enough about this person." });
      continue;
    }
    // A man is not both cautious and bold. The trait he already has stands:
    // it took two people to put it there, and one person's contrary opinion
    // does not unmake it.
    const clashes = already.some((held) => {
      const heldDefinition = TRAIT_REGISTRY[held];
      return definition.incompatibleTraitIds.includes(held) || heldDefinition?.incompatibleTraitIds.includes(proposal.traitId) === true;
    });
    if (clashes) {
      refused.push({ traitId: proposal.traitId, reason: "It contradicts what they are already known to be." });
      continue;
    }
    const seen = observations.some(
      (observation) => observation.characterId === proposal.characterId
        && observation.traitId === proposal.traitId
        && observation.observerCharacterId === proposal.observerCharacterId,
    );
    if (seen) continue;

    observations.push(TraitObservationSchema.parse({
      id: nextId("trait-seen"),
      characterId: proposal.characterId,
      observerCharacterId: proposal.observerCharacterId,
      traitId: proposal.traitId,
      note: proposal.note,
      atStep,
    }));

    const observers = observations
      .filter((observation) => observation.characterId === proposal.characterId && observation.traitId === proposal.traitId)
      .map((observation) => observation.observerCharacterId);
    if (new Set(observers).size >= TRAIT_CORROBORATION && !confirmed.some((entry) => entry.characterId === proposal.characterId && entry.traitId === proposal.traitId)) {
      confirmed.push({ characterId: proposal.characterId, traitId: proposal.traitId, observerCharacterIds: [...new Set(observers)] });
    }
  }

  return { observations, confirmed, refused };
}

export function getTraitDefinition(id: string): TraitDefinition | undefined {
  return TRAIT_REGISTRY[id];
}

export interface TraitValidationResult {
  readonly valid: readonly string[];
  readonly unknown: readonly string[];
  readonly incompatiblePairs: readonly (readonly [string, string])[];
}

/** Flags unknown trait ids and any mutually-incompatible pair within the same list. */
export function validateTraitIds(ids: readonly string[]): TraitValidationResult {
  const valid: string[] = [];
  const unknown: string[] = [];
  const incompatiblePairs: (readonly [string, string])[] = [];

  for (const id of ids) {
    if (TRAIT_REGISTRY[id] === undefined) unknown.push(id);
    else valid.push(id);
  }

  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i]!;
      const b = valid[j]!;
      const defA = TRAIT_REGISTRY[a]!;
      const defB = TRAIT_REGISTRY[b]!;
      if (defA.incompatibleTraitIds.includes(b) || defB.incompatibleTraitIds.includes(a)) {
        incompatiblePairs.push([a, b]);
      }
    }
  }

  return { valid, unknown, incompatiblePairs };
}

export function resolveTraits(ids: readonly string[]): readonly TraitDefinition[] {
  return ids.map((id) => TRAIT_REGISTRY[id]).filter((def): def is TraitDefinition => def !== undefined);
}
