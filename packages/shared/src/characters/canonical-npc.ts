import type { Character, CharacterSkills } from "./character";
import { deriveDefaultMind } from "./mind";
import { openCharacterAccount } from "../material/character-accounts";
import type { WorldState } from "../world/world-state";

/**
 * The only world-side constructor for a new NPC.  It deliberately creates the
 * purse, location, mind, health and relationship ledger together: a named
 * person which is missing one of those things is not a usable simulation
 * character.
 */
export function createCanonicalNpc(
  world: WorldState,
  input: {
    readonly characterId: string;
    readonly name: string;
    readonly locationProvinceId: string;
    readonly polityId: string | null;
    readonly officeId?: string | null;
    readonly skills?: CharacterSkills;
    readonly startingMoney?: number;
    readonly createdAtStep: number;
    readonly creationReason: string;
  },
): { readonly world: WorldState; readonly character: Character } | null {
  const existing = world.characters.find((character) => character.id === input.characterId);
  if (existing !== undefined) return { world, character: existing };
  if (!world.map.provinces.some((province) => province.id === input.locationProvinceId)) return null;

  const purse = openCharacterAccount(world.material, input.characterId);
  if (purse === null) return null;
  const skills = input.skills ?? {
    martial: 35, intrigue: 45, learning: 45, piety: 35,
    stewardship: 45, diplomacy: 55, body: 45, subSkills: {},
  };
  const officeId = input.officeId ?? null;
  const character: Character = {
    id: input.characterId,
    name: input.name,
    cultureId: "culture-local",
    faithId: null,
    dynastyId: null,
    polityId: input.polityId,
    locationProvinceId: input.locationProvinceId,
    ageYearsAtStart: 35,
    birthStep: null,
    nextLifeReviewAtStep: null,
    officeId,
    personalAccountId: purse.accountId,
    skills,
    traits: [],
    mind: deriveDefaultMind({ officeId, skills, ageYears: 35, cultureId: "culture-local" }),
    alive: true,
    healthBps: 10_000,
    prestigeBps: 3_000,
    relations: [],
    ambitions: [],
    heirCharacterId: null,
    diedAtStep: null,
    createdByDirector: true,
    createdAtStep: input.createdAtStep,
    creationReason: input.creationReason,
    disqualifyingStatuses: [],
  };
  const material = input.startingMoney === undefined ? purse.material : {
    ...purse.material,
    accounts: purse.material.accounts.map((account) => account.id === purse.accountId
      ? { ...account, balance: input.startingMoney! }
      : account),
  };
  return { world: { ...world, characters: [...world.characters, character], material }, character };
}

/**
 * Entity IDs are free text (often slugified from AI-declared names) and can run long, but
 * EntityIdSchema caps every id at 120 chars. Fall back to a short hash so this composite id
 * never breaks that cap regardless of how long the source ids are; nothing reads the id's
 * content (it's a write-only key), so a hash fallback is safe.
 */
function relationCauseId(subjectCharacterId: string, targetCharacterId: string): string {
  const raw = `relation-${subjectCharacterId}-${targetCharacterId}`;
  if (raw.length <= 120) return raw;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `relation-${(hash >>> 0).toString(36)}`;
}

/** Add one permanent, directed source-of-truth relationship without duplicates. */
export function linkCanonicalCharacters(
  world: WorldState,
  subjectCharacterId: string,
  targetCharacterId: string,
  label: string,
  score: number,
  atStep: number,
): WorldState {
  if (!world.characters.some((c) => c.id === subjectCharacterId) || !world.characters.some((c) => c.id === targetCharacterId)) return world;
  return {
    ...world,
    characters: world.characters.map((character) => {
      if (character.id !== subjectCharacterId) return character;
      const existing = character.relations.find((relation) => relation.subjectCharacterId === targetCharacterId);
      if (existing !== undefined) return character;
      return {
        ...character,
        relations: [...character.relations, {
          subjectCharacterId: targetCharacterId,
          causes: [{
            id: relationCauseId(subjectCharacterId, targetCharacterId),
            label,
            score: Math.max(-100, Math.min(100, Math.round(score))),
            occurredAtStep: atStep,
            decayPerYearBps: 0,
            encounterMemoryId: null,
          }],
        }],
      };
    }),
  };
}
