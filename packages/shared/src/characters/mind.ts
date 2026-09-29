import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import type { CharacterSkills } from "./character";

// Canonical character mind (character-sim phase 2).
//
// A character's psychology is authoritative state, not dialogue flavor: it
// lives on `Character` and is read by dialogue and the Character Director
// alike. It is deliberately compact -- drives and temperament, not a full
// psychological model -- so it stays explainable rather than becoming a
// second simulation nobody can audit.
//
// `currentPressures` is a bounded pointer cache into `world.characterPressures`
// (packages/shared/src/characters/pressures.ts), not a duplicate of the
// pressure data itself -- the same "derive/reference, don't duplicate" rule
// `RelationCause` already follows for relationships. The pressure lifecycle
// helpers are the only writer of this list, so it never drifts from the
// canonical pressure records it points at.

const Score0to100 = z.number().int().min(0).max(100);

export const CharacterDrivesSchema = z
  .object({
    security: Score0to100,
    status: Score0to100,
    wealth: Score0to100,
    family: Score0to100,
    faith: Score0to100,
    duty: Score0to100,
    revenge: Score0to100,
  })
  .strict();
export type CharacterDrives = z.infer<typeof CharacterDrivesSchema>;

export const CharacterTemperamentSchema = z
  .object({
    boldness: Score0to100,
    caution: Score0to100,
    honesty: Score0to100,
    sociability: Score0to100,
    discipline: Score0to100,
    cruelty: Score0to100,
  })
  .strict();
export type CharacterTemperament = z.infer<typeof CharacterTemperamentSchema>;

export const CharacterMindSchema = z
  .object({
    drives: CharacterDrivesSchema,
    temperament: CharacterTemperamentSchema,
    riskTolerance: Score0to100,
    /** Trait ids (packages/shared/src/characters/traits.ts) this character actively upholds. */
    values: z.array(EntityIdSchema).max(6),
    /** Trait ids this character actively refuses. */
    taboos: z.array(EntityIdSchema).max(6),
    /** Pointers into `world.characterPressures`, maintained solely by the pressure lifecycle helpers. */
    currentPressures: z.array(EntityIdSchema).max(8),
  })
  .strict();
export type CharacterMind = z.infer<typeof CharacterMindSchema>;

/** Structurally valid, psychologically inert -- the Zod-level default so an old snapshot always parses. */
export const NEUTRAL_MIND: CharacterMind = {
  drives: { security: 50, status: 50, wealth: 50, family: 50, faith: 50, duty: 50, revenge: 50 },
  temperament: { boldness: 50, caution: 50, honesty: 50, sociability: 50, discipline: 50, cruelty: 50 },
  riskTolerance: 50,
  values: [],
  taboos: [],
  currentPressures: [],
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export interface DeriveMindContext {
  /** Who it is, where known: the seed a stable spread of honesty is drawn from. */
  readonly id?: string;
  readonly officeId: string | null;
  readonly skills: CharacterSkills;
  readonly ageYears: number;
  readonly cultureId: string;
}

/**
 * Deterministically derives a conservative mind from role, skills, office, and
 * age -- never from a live AI call. Used at every character-creation site
 * (scenario authoring, dialogue discovery, World-Director-created NPCs, the
 * declared player character) and by the backfill script for characters that
 * predate this field.
 */
export function deriveDefaultMind(context: DeriveMindContext): CharacterMind {
  const { officeId, skills, ageYears } = context;
  const holdsOffice = officeId !== null;

  const drives: CharacterDrives = {
    security: clamp(50 + (ageYears > 45 ? 10 : 0)),
    status: clamp(50 + (holdsOffice ? 15 : 0) + Math.round((skills.diplomacy - 50) / 4)),
    wealth: clamp(50 + Math.round((skills.stewardship - 50) / 4)),
    family: 50,
    faith: clamp(50 + Math.round((skills.piety - 50) / 4)),
    duty: clamp(50 + (holdsOffice ? 10 : 0) + Math.round((skills.stewardship - 50) / 6)),
    revenge: 50,
  };

  const temperament: CharacterTemperament = {
    boldness: clamp(50 + Math.round((skills.martial - 50) / 3) - (ageYears > 50 ? 10 : 0)),
    caution: clamp(50 + (ageYears > 45 ? 10 : 0) + (holdsOffice ? 10 : 0) - Math.round((skills.martial - 50) / 4)),
    honesty: clamp(50 - Math.round((skills.intrigue - 50) / 4) + (context.id === undefined ? 0 : honestySpread(context.id))),
    sociability: clamp(50 + Math.round((skills.diplomacy - 50) / 4)),
    discipline: clamp(50 + Math.round((skills.stewardship - 50) / 6) + (holdsOffice ? 5 : 0)),
    cruelty: 50,
  };

  const riskTolerance = clamp(50 + Math.round((skills.martial - 50) / 4) - (ageYears > 45 ? 10 : 0) - (holdsOffice ? 5 : 0));

  return { drives, temperament, riskTolerance, values: [], taboos: [], currentPressures: [] };
}

/**
 * A man's own honesty, within fifteen of what his gifts suggest, the same every
 * time. Derived minds put nearly everybody between 37 and 62, so that one
 * treasurer was as tempted as the next.
 */
export function honestySpread(id: string): number {
  let hash = 2166136261;
  for (const char of `${id}:honesty`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return (hash % 31) - 15;
}

const isNeutral = (mind: CharacterMind): boolean =>
  Object.values(mind.drives).every((value) => value === 50) && Object.values(mind.temperament).every((value) => value === 50);

/**
 * How honest somebody is. A mind nobody wrote -- a snapshot's neutral default
 * -- is read as the one his gifts and his own nature would have given him,
 * rather than as the exact middle every such man sat at.
 */
export function honestyOf(character: { readonly id: string; readonly mind: CharacterMind; readonly skills: { readonly intrigue: number } }): number {
  if (!isNeutral(character.mind)) return character.mind.temperament.honesty;
  return clamp(50 - Math.round((character.skills.intrigue - 50) / 4) + honestySpread(character.id));
}
