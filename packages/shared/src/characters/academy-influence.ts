import type { CharacterSkills } from "./character";
import type { WorldState } from "../world/world-state";

// docs/32 corrective pass, requirement 5: an academy is not a note. A
// `Structure` of kind `academy_building` standing in a province is durable
// provenance a newly generated NPC's own martial training actually reflects
// -- a bounded, typed skill bias plus a description referencing the academy
// by name, not an open-ended effect a scenario author has to guess at.

const ACADEMY_MARTIAL_BIAS = 15;
const ACADEMY_LEARNING_BIAS = 10;

export interface AcademyInfluence {
  /** Added directly to the generated character's base skills, then clamped to the schema's own [0,100] range. */
  readonly skillBias: Partial<Pick<CharacterSkills, "martial" | "learning">>;
  /** A human-readable provenance note, meant to be folded into the new character's `creationReason`. */
  readonly note: string;
}

/**
 * Every academy structure standing in `provinceId`, biasing new-character
 * generation there. Multiple academies stack (a province that has invested
 * repeatedly in training produces correspondingly better-trained recruits),
 * but each academy's contribution is small and bounded -- this is a
 * plausible training-ground effect, not a way to mint elite characters on
 * demand.
 */
export function academyInfluenceFor(world: Pick<WorldState, "structures">, provinceId: string): AcademyInfluence | null {
  const academies = world.structures.filter((structure) => structure.kind === "academy_building" && structure.provinceId === provinceId);
  if (academies.length === 0) return null;
  return {
    skillBias: { martial: ACADEMY_MARTIAL_BIAS * academies.length, learning: ACADEMY_LEARNING_BIAS * academies.length },
    note: academies.length === 1
      ? `Trained in the martial tradition of ${academies[0]!.name}.`
      : `Trained across ${academies.length} local military academies, including ${academies[0]!.name}.`,
  };
}

/** Applies an `AcademyInfluence`'s bias to a base skill set, clamped to the schema's [0,100] range. */
export function applyAcademyInfluence(skills: CharacterSkills, influence: AcademyInfluence): CharacterSkills {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  return {
    ...skills,
    martial: influence.skillBias.martial === undefined ? skills.martial : clamp(skills.martial + influence.skillBias.martial),
    learning: influence.skillBias.learning === undefined ? skills.learning : clamp(skills.learning + influence.skillBias.learning),
  };
}
