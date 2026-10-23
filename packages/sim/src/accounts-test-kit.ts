import type { Character, WorldState } from "@chronica/shared";
import { atDay, government, opening } from "./competence-test-kit";
import { createIdFactory } from "./ports";
import type { AccountsInput } from "./close-of-office";

/**
 * A kit for the tests of accountability (docs/plans/government.md, "H4 as built"): the opening world at a day, a man whose term ends, a theft written
 * in the books, and the input the tick gives the accounts.
 */
export { atDay, government, opening };

export const holderOf = (world: WorldState, officeId: string, index = 0): Character => {
  const seat = world.material.officeSeats.filter((candidate) => candidate.officeId === officeId && candidate.holderCharacterId !== null)[index]!;
  return world.characters.find((character) => character.id === seat.holderCharacterId)!;
};

export const seatOf = (world: WorldState, officeId: string, characterId: string) =>
  world.material.officeSeats.find((candidate) => candidate.officeId === officeId && candidate.holderCharacterId === characterId)!;

/** What the tick hands the accounts when a man's term ends on `day`. */
export function ending(world: WorldState, officeId: string, man: Character, day = 365): AccountsInput {
  const seat = seatOf(world, officeId, man.id);
  return { world: atDay(world, day), offices: government.offices, toDay: day, ids: createIdFactory("accounts"), endedTerms: [{ characterId: man.id, officeId, seatId: seat.id, endedAtStep: day }] };
}

/** Skills set: the man who looks at the books and the man who kept them. */
export function withSkills(world: WorldState, skills: Readonly<Record<string, Partial<Character["skills"]>>>): WorldState {
  return { ...world, characters: world.characters.map((character) => (skills[character.id] === undefined ? character : { ...character, skills: { ...character.skills, ...skills[character.id] } })) };
}

/** Rows of what a man kept back from a power's chest, none yet found. */
export function withTheft(world: WorldState, manId: string, polityId: string, rows = 6, amount = 3_000, lastAt = 300): WorldState {
  const account = world.material.accounts.find((candidate) => candidate.owner.kind === "polity" && candidate.owner.id === polityId) ?? world.material.accounts.find((candidate) => candidate.owner.kind === "character" && candidate.owner.id === manId)!;
  return {
    ...world,
    diversions: [...world.diversions, ...Array.from({ length: rows }, (_, n) => ({
      id: `diversion-${manId}-${n}`, byCharacterId: manId, scope: { kind: "polity" as const, id: polityId }, departmentId: null, amount, toAccountId: account.id, firstAtStep: 100 + n, lastAtStep: lastAt, foundAtStep: null,
    }))],
  };
}
