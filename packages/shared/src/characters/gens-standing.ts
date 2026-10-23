import { currentAgeYears } from "./age";
import type { Character } from "./character";
import type { Gens } from "../world/gentes";

/** A gens's dignitas: half its first man's standing and a quarter of each other living man's, and a hundred and fifty for each consulship, a hundred for each censorship. */
const DIGNITAS_OTHERS_SHARE = 0.25;
const DIGNITAS_PER_CONSULSHIP = 150;
const DIGNITAS_PER_CENSORSHIP = 100;

/** What a gens weighs, 0-10 000. */
export function dignitasOfGens(gens: Gens, living: readonly Pick<Character, "prestigeBps">[]): number {
  const standings = living.map((member) => member.prestigeBps).sort((a, b) => b - a);
  const men = (standings[0] ?? 0) + DIGNITAS_OTHERS_SHARE * standings.slice(1).reduce((sum, value) => sum + value, 0);
  const consulships = gens.honours.filter((honour) => honour.kind === "consul" || honour.kind === "dictator").length;
  const censorships = gens.honours.filter((honour) => honour.kind === "censor").length;
  return Math.max(0, Math.min(10_000, Math.round(men * 0.5 + consulships * DIGNITAS_PER_CONSULSHIP + censorships * DIGNITAS_PER_CENSORSHIP)));
}

/** The first man of a gens: the one with most of the curule chair among the living, then the more honoured, the elder. */
export function princepsOf(gens: Gens, living: readonly Character[], atStep: number): Character | undefined {
  const own = (member: Character): number => gens.honours.filter((honour) => honour.characterId === member.id).length;
  return living
    .filter((member) => member.alive && member.gender === "male" && currentAgeYears(member, atStep) >= 14)
    .sort((a, b) => own(b) - own(a) || b.prestigeBps - a.prestigeBps || currentAgeYears(b, atStep) - currentAgeYears(a, atStep) || a.id.localeCompare(b.id))[0];
}
