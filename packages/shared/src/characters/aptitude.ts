import type { Character, CharacterSubSkills } from "./character";

export type SubSkill = keyof CharacterSubSkills;

/** Which skill each finer skill belongs to, and falls back to where a person has none written. */
export const SUBSKILL_OF: Readonly<Record<SubSkill, Exclude<keyof Character["skills"], "subSkills">>> = {
  strategist: "martial",
  authority: "martial",
  espionage: "intrigue",
  manipulation: "intrigue",
  rhetoric: "diplomacy",
  arbitration: "diplomacy",
  logistics: "stewardship",
  taxation: "stewardship",
  theology: "learning",
  scholarship: "learning",
  devotion: "piety",
  rites: "piety",
  endurance: "body",
  prowess: "body",
};

/**
 * How good a person is at one particular thing.
 *
 * The seven skills were read in six places and the fourteen finer skills in
 * none: a Fabricius and a Postumius spoke to the Senate with the same weight,
 * a legate who could feed an army marched as slowly as one who could not, and
 * a quaestor's gift for the tax roll changed nothing in the treasury. A finer
 * skill is read where one is written, and its skill where not, so everybody
 * the world ever made has one.
 */
export function aptitude(character: Pick<Character, "skills">, skill: SubSkill): number {
  return character.skills.subSkills?.[skill] ?? character.skills[SUBSKILL_OF[skill]];
}

/**
 * The share a skill moves something by, around the middling man at 50: at 100
 * it is `+reach`, at 0 `-reach`. `reach` 0.2 is a fifth better or worse.
 */
export const skillShare = (value: number, reach: number): number => ((value - 50) / 50) * reach;

/** The skill a finer skill improves along with, for a man who practises it. */
export const SKILL_CEILING_BY_PRACTICE = 90;

/**
 * A man better at a thing for having done it. Skills changed only when the
 * world thought to write that they had, so a consul who fought six battles
 * came out of them exactly the general he went in. Doing the work raises its
 * finer skill a little, and never past `SKILL_CEILING_BY_PRACTICE`: practice
 * makes a man good, not the best the world has seen.
 */
export function practise<C extends Pick<Character, "skills">>(character: C, skill: SubSkill, amount: number): C {
  const now = aptitude(character, skill);
  if (now >= SKILL_CEILING_BY_PRACTICE) return character;
  return { ...character, skills: { ...character.skills, subSkills: { ...character.skills.subSkills, [skill]: Math.min(SKILL_CEILING_BY_PRACTICE, now + amount) } } };
}

/**
 * A person's finer skills, where nobody wrote them: each within fifteen of the
 * skill it belongs to, the same every time for the same person. Without this
 * every man was exactly as good at the tax roll as at feeding an army, and the
 * finer skills could only ever say what the skill already had.
 */
export function spreadSubSkills(id: string, skills: Omit<Character["skills"], "subSkills">, written: CharacterSubSkills = {}): CharacterSubSkills {
  const spread: Record<string, number> = {};
  for (const [skill, parent] of Object.entries(SUBSKILL_OF) as [SubSkill, keyof typeof skills][]) {
    const written_ = written[skill];
    if (written_ !== undefined) { spread[skill] = written_; continue; }
    let hash = 2166136261;
    for (const char of `${id}:${skill}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    spread[skill] = Math.max(0, Math.min(100, skills[parent] + (hash % 31) - 15));
  }
  return spread;
}
