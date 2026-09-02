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
