import type { Character, CharacterSkills } from "./character";
import { deriveDefaultMind } from "./mind";
import { stableHash } from "../determinism";
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
            // Two character ids do not fit in one entity id: an NPC id already
            // carries a name and the player's uuid, so the pair overran the
            // 120-character ceiling and the saved world would no longer parse.
            // A digest of the ordered pair stays deterministic and directed.
            id: `relation-${stableHash([subjectCharacterId, targetCharacterId]).toString(36)}`,
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
