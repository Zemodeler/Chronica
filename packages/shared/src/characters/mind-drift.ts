import { z } from "zod";
import { ElapsedStepSchema } from "../material-state";
import type { CharacterMind } from "./mind";
import { leaning } from "./traits";

/**
 * Who a man becomes (character-sim, the mind that moves).
 *
 * A mind was derived once, at creation, and never touched again: a consul who
 * lost three armies was exactly as bold after the third as before the first,
 * and a man whose own brother sold him to his enemies trusted as freely as the
 * day he was born. What happens to a person is written down as a lesson when
 * it happens -- a battle won, a plot against him found out, an order he
 * refused and got away with -- and each life review reads what he has learned
 * since the last and moves him a little. A little: a lifetime changes a man,
 * a season barely does.
 */
export const LessonKindSchema = z.enum([
  "victory",
  "defeat",
  "betrayed",
  "plotted_against",
  "defied",
  "convicted",
  "acquitted",
  "honoured",
  "disgraced",
  "bereaved",
  // What a state's life teaches the man who holds it (a-living-world.md).
  "war_won",
  "war_lost",
  "city_lost",
  "sacked_a_city",
  "oath_broken",
  "ruled_long",
]);
export type LessonKind = z.infer<typeof LessonKindSchema>;

export const LessonSchema = z.object({ kind: LessonKindSchema, atStep: ElapsedStepSchema }).strict();
export type Lesson = z.infer<typeof LessonSchema>;

/**
 * What a man feels just now, as against what he is.
 *
 * A lesson changes a man a little, over seasons. A feeling changes how he acts
 * for a few weeks and then goes: the anger of a refused peace, the grief of a
 * death, the fear of a plot found out, the elation of a victory, the shame of
 * a humiliation. It is put on him the day it happens (`sim/moods.ts`), halves
 * every thirty days, and while it lasts it moves how the rules read him
 * (`sim/disposition.ts`) and how he writes.
 */
export const MoodKindSchema = z.enum(["anger", "grief", "fear", "elation", "shame"]);
export type MoodKind = z.infer<typeof MoodKindSchema>;
export const MoodSchema = z.object({ kind: MoodKindSchema, strength: z.number().int().min(1).max(100), atStep: ElapsedStepSchema }).strict();
export type Mood = z.infer<typeof MoodSchema>;
/** The most feelings a man carries at once; the weakest go first. */
export const MAX_MOODS = 6;

/** The most lessons a man carries between reviews; past this the oldest go unlearned. */
export const MAX_LESSONS = 16;
/** The most any one review moves any one part of him. */
export const MAX_DRIFT_PER_REVIEW = 6;

type Nudge = Partial<Record<keyof CharacterMind["temperament"] | keyof CharacterMind["drives"] | "riskTolerance", number>>;

/** What each thing that happens to a man teaches him. */
const TAUGHT: Readonly<Record<LessonKind, Nudge>> = {
  victory: { boldness: 2, caution: -1, riskTolerance: 2, status: 1 },
  defeat: { caution: 2, boldness: -1, riskTolerance: -2, security: 1 },
  betrayed: { sociability: -2, caution: 1, revenge: 2 },
  plotted_against: { caution: 2, security: 2, revenge: 1 },
  defied: { boldness: 2, duty: -1 },
  convicted: { security: 2, revenge: 2, status: -1 },
  acquitted: { boldness: 1 },
  honoured: { status: 1, duty: 1 },
  disgraced: { revenge: 2, duty: -1 },
  bereaved: { revenge: 3, family: 1 },
  // Winning a war feeds the hunger it was fought for; losing one teaches the opposite.
  war_won: { boldness: 2, status: 2, riskTolerance: 2, caution: -1, wealth: 1 },
  war_lost: { caution: 3, boldness: -2, riskTolerance: -3, security: 2, revenge: 1, status: -1 },
  // A city lost is a wound that is not forgiven and a lesson in what is not safe.
  city_lost: { security: 3, revenge: 2, caution: 1, duty: 1 },
  // Putting a city to the sword and keeping what it held makes a man greedier and harder, and no more honest.
  sacked_a_city: { wealth: 2, cruelty: 2, boldness: 1, honesty: -1 },
  // A man who breaks his word finds the next breaking easier, and trusts nobody else to keep theirs.
  oath_broken: { honesty: -2, duty: -2, sociability: -1, security: 1 },
  // Years of rule: certainty of his place, a wish to keep what he has, and the duty of a man who has held it.
  ruled_long: { status: 1, duty: 1, caution: 1, security: 1, boldness: -1 },
};

/** A fixed number in [0, 1) for this person and this question; the same every time it is asked. */
function personalRoll(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash / 4294967296;
}

/**
 * How far the years move one part of one particular person.
 *
 * Ageing is not a rule. Some people mellow with age and some do not; a few
 * harden and grow bolder or angrier as they go. So each person has their own
 * response to each part of themselves, fixed for life: about three in ten are
 * untouched by the years in that part, the rest are moved by up to half again
 * the usual amount, and about one in seven moves the *other* way. Nothing
 * says an old man is timid.
 */
export function ageSusceptibility(id: string, part: string): number {
  const u = personalRoll(`${id}:ages:${part}`);
  if (u < 0.3) return 0;
  if (u < 0.86) return 0.4 + ((u - 0.3) / 0.56) * 1.1;
  return -(0.2 + ((u - 0.86) / 0.14) * 0.6);
}

/** What age tends to do to each part, and from when, as a chance per birthday for the typical person. */
const AGEING: readonly { readonly part: string; readonly from: number; readonly to: number; readonly step: 1 | -1; readonly chance: number }[] = [
  { part: "discipline", from: 18, to: 34, step: 1, chance: 0.33 },
  { part: "caution", from: 18, to: 34, step: 1, chance: 0.2 },
  { part: "security", from: 40, to: 200, step: 1, chance: 0.25 },
  { part: "boldness", from: 45, to: 200, step: -1, chance: 0.5 },
  { part: "riskTolerance", from: 45, to: 200, step: -1, chance: 0.5 },
  { part: "caution", from: 45, to: 200, step: 1, chance: 0.33 },
  { part: "status", from: 55, to: 200, step: -1, chance: 0.25 },
  { part: "revenge", from: 55, to: 200, step: -1, chance: 0.25 },
  { part: "duty", from: 55, to: 200, step: 1, chance: 0.2 },
  { part: "faith", from: 55, to: 200, step: 1, chance: 0.33 },
];

/**
 * What the years alone do to this person, birthday by birthday since the last
 * review. Each birthday is rolled for each part, on the person's own id and
 * the year, weighted by how much that part of them is moved by age at all
 * (`ageSusceptibility`) -- so it is deterministic, the same however finely the
 * clock is stepped, and different for everybody.
 */
export function ageNudge(id: string, ageBefore: number, ageNow: number): Nudge {
  const total: Record<string, number> = {};
  for (let year = Math.floor(ageBefore) + 1; year <= Math.floor(ageNow); year += 1) {
    for (const rule of AGEING) {
      if (year < rule.from || year > rule.to) continue;
      const feel = ageSusceptibility(id, rule.part);
      if (feel === 0) continue;
      if (personalRoll(`${id}:birthday:${rule.part}:${rule.from}:${year}`) < Math.min(1, rule.chance * Math.abs(feel))) {
        total[rule.part] = (total[rule.part] ?? 0) + rule.step * Math.sign(feel);
      }
    }
  }
  return total as Nudge;
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

/** Traits a mind that has moved this far no longer bears out: a "bold" man grown timid is not bold. */
const BORNE_OUT_BY: Readonly<Record<string, { readonly by: keyof CharacterMind["temperament"] | keyof CharacterMind["drives"]; readonly below: number }>> = {
  bold: { by: "boldness", below: 30 },
  cautious: { by: "caution", below: 30 },
  sociable: { by: "sociability", below: 30 },
  dutiful: { by: "duty", below: 30 },
  vengeful: { by: "revenge", below: 30 },
};

/**
 * A mind moved by what he has learned, and the traits that no longer fit it.
 *
 * Pure. Each part moves at most `MAX_DRIFT_PER_REVIEW` a review whatever he
 * went through, so no single bad season remakes anybody.
 */
export function driftMind(
  mind: CharacterMind,
  traits: readonly string[],
  lessons: readonly Lesson[],
  years: Nudge = {},
): { readonly mind: CharacterMind; readonly traits: readonly string[]; readonly shed: readonly string[] } {
  if (lessons.length === 0 && Object.keys(years).length === 0) return { mind, traits, shed: [] };
  const total: Record<string, number> = { ...(years as Record<string, number>) };
  for (const lesson of lessons) {
    for (const [part, amount] of Object.entries(TAUGHT[lesson.kind])) total[part] = (total[part] ?? 0) + (amount ?? 0);
  }
  const bounded = (part: string): number => Math.max(-MAX_DRIFT_PER_REVIEW, Math.min(MAX_DRIFT_PER_REVIEW, total[part] ?? 0));
  const temperament = Object.fromEntries(
    Object.entries(mind.temperament).map(([part, value]) => [part, clamp(value + bounded(part))]),
  ) as CharacterMind["temperament"];
  const drives = Object.fromEntries(
    Object.entries(mind.drives).map(([part, value]) => [part, clamp(value + bounded(part))]),
  ) as CharacterMind["drives"];
  const moved: CharacterMind = { ...mind, temperament, drives, riskTolerance: clamp(mind.riskTolerance + bounded("riskTolerance")) };
  const read = (part: string): number => (moved.temperament as Record<string, number>)[part] ?? (moved.drives as Record<string, number>)[part] ?? 50;
  // Only what these lessons moved can unmake a trait: a man written timid at
  // creation beside a "bold" name keeps it until something happens to him.
  const shed = traits.filter((trait) => {
    const rule = BORNE_OUT_BY[trait];
    return rule !== undefined && bounded(rule.by) < 0 && read(rule.by) < rule.below;
  });
  return { mind: moved, traits: traits.filter((trait) => !shed.includes(trait)), shed };
}

/** A lesson written on a man, the newest kept. */
export function withLesson<C extends { readonly lessons?: readonly Lesson[] | undefined }>(character: C, kind: LessonKind, atStep: number): C {
  return { ...character, lessons: [...(character.lessons ?? []), { kind, atStep }].slice(-MAX_LESSONS) };
}

/** Which part of a mind each kind of decision a trait leans on belongs to. */
const LEANING_SHAPES: Readonly<Record<string, readonly (keyof CharacterMind["temperament"] | keyof CharacterMind["drives"] | "riskTolerance")[]>> = {
  risk: ["boldness", "riskTolerance"],
  caution: ["caution"],
  honesty: ["honesty"],
  cruelty: ["cruelty"],
  sociability: ["sociability"],
  discipline: ["discipline"],
  obligation: ["duty"],
  status: ["status"],
  revenge: ["revenge"],
};

/**
 * A mind derived from a man's gifts, moved the way what is said of him says:
 * a man described as bold is bolder than his skills alone would make him, a
 * cruel one crueller. Used where a person arrives described rather than
 * lived -- a player's declaration -- so the words on him and the mind under
 * them agree.
 */
export function mindShapedBy(mind: CharacterMind, traits: readonly string[]): CharacterMind {
  const temperament: Record<string, number> = { ...mind.temperament };
  const drives: Record<string, number> = { ...mind.drives };
  let riskTolerance = mind.riskTolerance;
  for (const [context, parts] of Object.entries(LEANING_SHAPES)) {
    const amount = leaning({ traits }, context);
    if (amount === 0) continue;
    for (const part of parts) {
      if (part === "riskTolerance") riskTolerance = clamp(riskTolerance + amount);
      else if (part in temperament) temperament[part] = clamp(temperament[part]! + amount);
      else drives[part] = clamp((drives[part] ?? 50) + amount);
    }
  }
  return { ...mind, temperament: temperament as CharacterMind["temperament"], drives: drives as CharacterMind["drives"], riskTolerance };
}
