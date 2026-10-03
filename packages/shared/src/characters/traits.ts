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
  // The vices (docs/plans/a-living-world.md §6). Two hand runs found 280
  // people with one cruel and one deceitful trait between them; a world of the
  // honourable is a world nothing goes wrong in.
  greedy: trait({
    id: "greedy", label: "Greedy", category: "moral",
    dialogueGuidance: "Thinks first of what a thing is worth to him; takes what passes through his hands.",
    decisionModifiers: { wealth: 12, honesty: -6 },
    incompatibleTraitIds: ["compassionate"],
  }),
  treacherous: trait({
    id: "treacherous", label: "Treacherous", category: "moral",
    dialogueGuidance: "Keeps his word only while it pays; changes sides when the other side looks stronger.",
    decisionModifiers: { betrayal: 14, honesty: -10 },
    incompatibleTraitIds: ["dutiful"],
  }),
  cowardly: trait({
    id: "cowardly", label: "Cowardly", category: "temperament",
    dialogueGuidance: "Avoids danger to himself; finds reasons to be elsewhere when it comes.",
    decisionModifiers: { risk: -14 },
    incompatibleTraitIds: ["bold"],
  }),
  paranoid: trait({
    id: "paranoid", label: "Paranoid", category: "temperament",
    dialogueGuidance: "Sees plots everywhere, trusts no one near him, and strikes first.",
    decisionModifiers: { trust: -12, caution: 6 },
  }),
  envious: trait({
    id: "envious", label: "Envious", category: "moral",
    dialogueGuidance: "Resents those who rise above him and works to bring them down.",
    decisionModifiers: { status: 8, revenge: 6 },
  }),
  wrathful: trait({
    id: "wrathful", label: "Wrathful", category: "temperament",
    dialogueGuidance: "Quick to anger and slow to cool; answers a slight with force.",
    decisionModifiers: { revenge: 10, risk: 6 },
  }),
  zealous: trait({
    id: "zealous", label: "Zealous", category: "moral",
    dialogueGuidance: "Certain the gods are on his side, and harsh to those who are not.",
    decisionModifiers: { faith: 14 },
  }),
  content: trait({
    id: "content", label: "Content", category: "ambition",
    dialogueGuidance: "Wants no more than he has, and is wary of those who do.",
    decisionModifiers: { status: -8, risk: -4 },
    incompatibleTraitIds: ["ambitious"],
  }),
};

/**
 * The registry's own words for what somebody was described as.
 *
 * `character_create` takes free text and wrote it straight onto the character,
 * so a live world ended up holding "hellenistic_governor", "protective of
 * tribal autonomy", "cavalry leader" and "anti-roman" as traits. None of them
 * mean anything to anything: `TRAIT_REGISTRY` supplies the dialogue guidance
 * NPC prompts read and the incompatibilities the observation rule checks, and
 * a trait outside it silently confers neither. The registry has had
 * `validateTraitIds` since it was written and `character_create` never called
 * it.
 *
 * So a description is mapped to the nearest word the engine actually has, by
 * the words in it, and anything that maps to nothing is dropped rather than
 * stored as furniture. The scenario-authored forward compatibility the header
 * of this file promises is preserved: an id that *is* in the registry passes
 * through untouched, whoever put it there.
 */
const TRAIT_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  cautious: ["cautious", "careful", "prudent", "wary", "watchful", "guarded", "circumspect", "hesitant", "conservative"],
  bold: ["bold", "brave", "daring", "fearless", "aggressive", "rash", "reckless", "audacious", "martial", "warlike", "courageous"],
  ambitious: ["ambitious", "aspiring", "climbing", "calculating", "opportunistic"],
  dutiful: ["dutiful", "loyal", "faithful", "honourable", "honorable", "steadfast", "reliable", "principled", "devoted"],
  vengeful: ["vengeful", "vindictive", "unforgiving", "spiteful", "bitter", "resentful"],
  sociable: ["sociable", "charismatic", "affable", "gregarious", "popular", "persuasive", "charming", "genial"],
  disciplined: ["disciplined", "methodical", "organised", "organized", "orderly", "systematic", "meticulous", "rigorous", "pragmatic", "administrative"],
  deceitful: ["deceitful", "duplicitous", "scheming", "cunning", "devious", "secretive", "discreet", "sly"],
  treacherous: ["treacherous", "faithless", "perfidious", "disloyal", "turncoat", "oathbreaker"],
  greedy: ["greedy", "avaricious", "venal", "corrupt", "rapacious", "covetous", "grasping"],
  cowardly: ["cowardly", "craven", "timid", "fearful"],
  paranoid: ["paranoid", "suspicious", "distrustful", "mistrustful", "jealous"],
  envious: ["envious", "resentful of rivals"],
  wrathful: ["wrathful", "irascible", "hot-tempered", "violent", "furious", "choleric"],
  zealous: ["zealous", "fanatical", "fervent", "bigoted"],
  content: ["content", "unambitious", "placid", "easygoing"],
  compassionate: ["compassionate", "merciful", "kind", "generous", "humane", "protective", "gentle"],
  cruel: ["cruel", "ruthless", "brutal", "harsh", "merciless", "savage", "callous"],
};

/**
 * Every description reduced to the traits the engine has words for.
 *
 * Order-stable and deduplicated, so two identically-described people carry
 * identical traits. Drops what it cannot place: a trait that confers nothing
 * and means nothing is not worth storing.
 */
export function canonicalTraitIds(described: readonly string[], limit = MAX_TRAITS): string[] {
  const found = new Set<string>();
  for (const description of described) {
    const raw = description.trim().toLowerCase();
    if (TRAIT_REGISTRY[raw] !== undefined) {
      found.add(raw);
      continue;
    }
    const words = new Set(raw.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2));
    for (const [id, synonyms] of Object.entries(TRAIT_SYNONYMS)) {
      if (synonyms.some((synonym) => words.has(synonym))) found.add(id);
    }
  }
  // Incompatible pairs cannot both be true of one person. Where a description
  // produced both, neither is kept: the engine has no basis to pick.
  const kept = [...found].filter((id) => {
    const definition = TRAIT_REGISTRY[id];
    return definition === undefined || !definition.incompatibleTraitIds.some((other) => found.has(other));
  });
  return Object.keys(TRAIT_REGISTRY).filter((id) => kept.includes(id)).slice(0, limit);
}

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
  /** Traits two people have now seen the opposite of: no longer who somebody is. */
  readonly lost: readonly { readonly characterId: string; readonly traitId: string; readonly contradictedBy: string; readonly observerCharacterIds: readonly string[] }[];
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
  let observations = [...existing];
  const confirmed: { characterId: string; traitId: string; observerCharacterIds: string[] }[] = [];
  const lost: { characterId: string; traitId: string; contradictedBy: string; observerCharacterIds: string[] }[] = [];
  const refused: { traitId: string; reason: string }[] = [];
  const shed = new Map<string, Set<string>>();
  const heldNow = (characterId: string): readonly string[] => traitsOf(characterId).filter((held) => !shed.get(characterId)?.has(held));

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
    const already = heldNow(proposal.characterId);
    if (already.includes(proposal.traitId)) continue;
    // A man is not both cautious and bold. The trait he already has stands
    // against one person's contrary opinion -- it took two people to put it
    // there -- and falls to two, the same as it came: a "cautious" man two
    // people have seen charge is no longer known for caution.
    const contradicted = already.filter((held) => {
      const heldDefinition = TRAIT_REGISTRY[held];
      return definition.incompatibleTraitIds.includes(held) || heldDefinition?.incompatibleTraitIds.includes(proposal.traitId) === true;
    });
    if (contradicted.length === 0 && already.length >= MAX_TRAITS) {
      refused.push({ traitId: proposal.traitId, reason: "The world has said enough about this person." });
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

    if (contradicted.length > 0) {
      for (const held of contradicted) {
        // Only what was seen since he was last seen to be it counts against it.
        const since = Math.max(-1, ...observations
          .filter((observation) => observation.characterId === proposal.characterId && observation.traitId === held)
          .map((observation) => observation.atStep));
        const opposes = (traitId: string): boolean => TRAIT_REGISTRY[held]?.incompatibleTraitIds.includes(traitId) === true
          || TRAIT_REGISTRY[traitId]?.incompatibleTraitIds.includes(held) === true;
        const against = new Set(observations
          .filter((observation) => observation.characterId === proposal.characterId && observation.atStep >= since && opposes(observation.traitId))
          .map((observation) => observation.observerCharacterId));
        if (against.size < TRAIT_CORROBORATION) {
          refused.push({ traitId: proposal.traitId, reason: "It contradicts what they are already known to be; one voice does not unmake it." });
          continue;
        }
        lost.push({ characterId: proposal.characterId, traitId: held, contradictedBy: proposal.traitId, observerCharacterIds: [...against] });
        shed.set(proposal.characterId, new Set([...(shed.get(proposal.characterId) ?? []), held]));
        // What was said of him before is spent: it has to be seen again by two
        // new people before it is who he is again.
        observations = observations.filter((observation) => !(observation.characterId === proposal.characterId && observation.traitId === held));
      }
      // The opposite is not who he is yet. It is on record, and the next
      // person to see it makes it so.
      continue;
    }

    const observers = observations
      .filter((observation) => observation.characterId === proposal.characterId && observation.traitId === proposal.traitId)
      .map((observation) => observation.observerCharacterId);
    if (new Set(observers).size >= TRAIT_CORROBORATION && !confirmed.some((entry) => entry.characterId === proposal.characterId && entry.traitId === proposal.traitId)) {
      confirmed.push({ characterId: proposal.characterId, traitId: proposal.traitId, observerCharacterIds: [...new Set(observers)] });
    }
  }

  return { observations, confirmed, lost, refused };
}

/**
 * Which way somebody's character pulls on one kind of decision: the sum of
 * what his traits say about it, within ±20 for each. `leaning(man, "risk")`
 * is +10 for a bold man, -10 for a cautious one, 0 for anybody the world has
 * said nothing about. Every deterministic choice a trait should colour reads
 * through this, so a trait means the same thing everywhere.
 */
export function leaning(character: { readonly traits: readonly string[] }, context: string): number {
  return character.traits.reduce((sum, id) => sum + (TRAIT_REGISTRY[id]?.decisionModifiers[context] ?? 0), 0);
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
