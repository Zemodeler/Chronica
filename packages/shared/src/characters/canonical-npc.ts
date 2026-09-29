import { spreadSubSkills } from "./aptitude";
import type { Character, CharacterSkills } from "./character";
import { deriveDefaultMind } from "./mind";
import { stableHash } from "../determinism";
import { DAYS_PER_YEAR } from "../world/clock";
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
    /** How old they are. Everyone was thirty-five: the world's invented greybeards and the player's own children alike. */
    readonly ageYearsAtStart?: number;
    /** A wife or a daughter. Everybody was a man, so a declared wife could never bear a child. */
    readonly gender?: Character["gender"];
    /** Who they are born of: a child takes the culture, faith and house of the family it is born into. */
    readonly cultureId?: string;
    readonly faithId?: string | null;
    readonly dynastyId?: string | null;
    readonly prestigeBps?: number;
  },
): { readonly world: WorldState; readonly character: Character } | null {
  const existing = world.characters.find((character) => character.id === input.characterId);
  if (existing !== undefined) return { world, character: existing };
  if (!world.map.provinces.some((province) => province.id === input.locationProvinceId)) return null;

  const purse = openCharacterAccount(world.material, input.characterId);
  if (purse === null) return null;
  const given = input.skills ?? {
    martial: 35, intrigue: 45, learning: 45, piety: 35,
    stewardship: 45, diplomacy: 55, body: 45, subSkills: {},
  };
  // Everybody made has finer skills of their own (`spreadSubSkills`).
  const skills = { ...given, subSkills: spreadSubSkills(input.characterId, given, given.subSkills) };
  const officeId = input.officeId ?? null;
  const age = Math.max(0, Math.min(120, Math.round(input.ageYearsAtStart ?? 35)));
  const cultureId = input.cultureId ?? "culture-local";
  const character: Character = {
    id: input.characterId,
    name: input.name,
    cultureId,
    faithId: input.faithId ?? null,
    dynastyId: input.dynastyId ?? null,
    polityId: input.polityId,
    locationProvinceId: input.locationProvinceId,
    ageYearsAtStart: age,
    // Made mid-reign, a man of forty is forty now and not forty plus the
    // years since the scenario opened.
    birthStep: input.createdAtStep > 0 ? input.createdAtStep - age * DAYS_PER_YEAR : null,
    nextLifeReviewAtStep: null,
    officeId,
    personalAccountId: purse.accountId,
    skills,
    traits: [],
    mind: deriveDefaultMind({ id: input.characterId, officeId, skills, ageYears: age, cultureId }),
    alive: true,
    healthBps: 10_000,
    prestigeBps: input.prestigeBps ?? 3_000,
    relations: [],
    ambitions: [],
    heirCharacterId: null,
    diedAtStep: null,
    createdByDirector: true,
    createdAtStep: input.createdAtStep,
    creationReason: input.creationReason,
    disqualifyingStatuses: [],
    officesHeld: [],
    eligibilityWaivers: [],
    legalStatus: "free",
    gender: input.gender ?? "male",
    ownerCharacterId: null,
    peculium: false,
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
