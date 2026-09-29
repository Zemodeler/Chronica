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
]);
export type LessonKind = z.infer<typeof LessonKindSchema>;

export const LessonSchema = z.object({ kind: LessonKindSchema, atStep: ElapsedStepSchema }).strict();
export type Lesson = z.infer<typeof LessonSchema>;

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
};

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
): { readonly mind: CharacterMind; readonly traits: readonly string[]; readonly shed: readonly string[] } {
  if (lessons.length === 0) return { mind, traits, shed: [] };
  const total: Record<string, number> = {};
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
