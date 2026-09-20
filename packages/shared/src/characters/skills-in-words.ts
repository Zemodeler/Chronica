import type { CharacterSkills } from "./character";
import { TRAIT_REGISTRY } from "./traits";

/**
 * What a person is good at, said rather than scored (slice 11).
 *
 * The character route has carried a rule at the top of the file since it was
 * written -- "AI-only skill data must never cross this boundary" -- and the
 * panel has shown the player nothing about their own abilities ever since.
 * That rule was protecting the wrong thing. The reason not to show 70/30 is
 * that a number invites optimisation and a person does not have one; it was
 * never that the player should be unable to find out whether they are any
 * good with an army.
 *
 * So the numbers stay behind the boundary and the judgment crosses it. "A
 * capable soldier, a poor administrator" is what a man's contemporaries would
 * say of him, is not arithmetic anybody can play against, and is the same
 * information in the register the rest of this game is written in.
 */

const BANDS: readonly { readonly atLeast: number; readonly word: string }[] = [
  { atLeast: 90, word: "without equal" },
  { atLeast: 78, word: "formidable" },
  { atLeast: 66, word: "capable" },
  { atLeast: 52, word: "sound" },
  { atLeast: 40, word: "unremarkable" },
  { atLeast: 25, word: "poor" },
  { atLeast: 0, word: "hopeless" },
];

/** What a skill is called when somebody is describing a person rather than a sheet. */
const SKILL_NOUNS: Readonly<Record<keyof Omit<CharacterSkills, "subSkills">, string>> = {
  martial: "soldier",
  intrigue: "schemer",
  learning: "scholar",
  piety: "servant of the gods",
  stewardship: "administrator",
  diplomacy: "negotiator",
  body: "man of his hands",
};

export function bandWord(score: number): string {
  return (BANDS.find((band) => score >= band.atLeast) ?? BANDS[BANDS.length - 1]!).word;
}

/**
 * The two or three things worth saying, strongest first.
 *
 * Not all seven: a list of seven is a sheet with the numbers filed off. What a
 * person is known for is their best and their worst, and the middle of the
 * range is what everybody is.
 */
export function skillsInWords(skills: CharacterSkills, howMany = 3): string[] {
  const entries = (Object.keys(SKILL_NOUNS) as (keyof typeof SKILL_NOUNS)[])
    .map((key) => ({ key, score: skills[key], noun: SKILL_NOUNS[key] }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  if (entries.length === 0) return [];

  const said: typeof entries = [];
  const best = entries[0]!;
  const worst = entries[entries.length - 1]!;
  said.push(best);
  // Only worth saying if it is actually a weakness and actually distinct from
  // the strength -- "a sound soldier and a sound administrator" says nothing.
  if (worst.key !== best.key && worst.score < 45 && best.score - worst.score >= 12) said.push(worst);
  for (const entry of entries.slice(1, -1)) {
    if (said.length >= howMany) break;
    if (entry.score >= 78) said.push(entry);
  }

  return said
    .sort((a, b) => b.score - a.score)
    .map((entry) => `${/^[aeiou]/.test(bandWord(entry.score)) ? "an" : "a"} ${bandWord(entry.score)} ${entry.noun}`);
}

/**
 * How the world holds somebody, from prestige in basis points.
 *
 * Reputation is by definition what other people hold, so this is the one
 * number on the panel that is honestly the player's business to see the shape
 * of -- and it is still shown as a standing rather than a score.
 */
export function standingInWords(prestigeBps: number): string {
  if (prestigeBps >= 8_000) return "a name spoken well beyond his own city";
  if (prestigeBps >= 6_000) return "a man of consequence";
  if (prestigeBps >= 4_000) return "known and respected in his own circle";
  if (prestigeBps >= 2_000) return "of no particular standing";
  return "a person of no account at all";
}

/** The traits somebody is known for, as the words others would use. */
export function traitsInWords(traitIds: readonly string[]): string[] {
  return traitIds.map((id) => TRAIT_REGISTRY[id]?.label ?? id);
}
