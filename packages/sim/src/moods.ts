import { MAX_MOODS, type Character, type LessonKind, type Mood, type MoodKind, type WorldState } from "@chronica/shared";

/**
 * How a man feels, for a few weeks (`mind-drift.ts` has the shape).
 *
 * People were their temperament and nothing else: a ruler whose brother had
 * died yesterday, whose peace had just been refused, or who had just won his
 * greatest battle, weighed his next move as he would on any quiet day. Here
 * what happens to someone puts a feeling on him the same day, and it moves how
 * the rules read him until it fades -- so a king provoked is rasher for a month
 * and a man bereaved is slow and soft for a while, as people are. Nothing here
 * is a lesson: a feeling is gone in a season and changes nobody for good.
 *
 * Deterministic. Strength falls by half every `HALF_LIFE_DAYS`; below
 * `FADED_AT` it is gone.
 */

export const HALF_LIFE_DAYS = 30;
export const FADED_AT = 6;

/** What can make a man feel: a lesson learned, or a thing said to him. */
export type Cause = LessonKind | "yielded" | "won_a_point" | "defied_by" | "refused_peace";

/** What each thing that happens to a man makes him feel, and how hard. */
const FEELS: Readonly<Partial<Record<Cause, readonly (readonly [MoodKind, number])[]>>> = {
  // A demand given way to is a small defeat for the one who gave way, a small triumph for the one who made it;
  // a demand defied is an insult to the one who made it. A peace refused is a smaller one.
  yielded: [["shame", 50]],
  won_a_point: [["elation", 30]],
  defied_by: [["anger", 55]],
  refused_peace: [["anger", 25]],
  bereaved: [["grief", 80]],
  betrayed: [["anger", 70]],
  plotted_against: [["fear", 60], ["anger", 30]],
  convicted: [["shame", 60], ["anger", 40]],
  acquitted: [["elation", 50]],
  honoured: [["elation", 55]],
  disgraced: [["shame", 70]],
  victory: [["elation", 55]],
  defeat: [["shame", 45], ["anger", 35]],
  war_won: [["elation", 70]],
  war_lost: [["shame", 60], ["anger", 30]],
  city_lost: [["anger", 70], ["fear", 40]],
  sacked_a_city: [["elation", 40]],
};

/** What he feels now, each strength worn down by the days since it came. */
export function moodsAt(character: Pick<Character, "moods">, day: number): readonly Mood[] {
  return (character.moods ?? [])
    .map((mood) => ({ ...mood, strength: Math.round(mood.strength * 0.5 ** (Math.max(0, day - mood.atStep) / HALF_LIFE_DAYS)) }))
    .filter((mood) => mood.strength >= FADED_AT);
}

/** The strength of one kind of feeling, 0 to 1: the sum of what he feels of it, never more than all. */
export function feeling(character: Pick<Character, "moods">, day: number, kind: MoodKind): number {
  return Math.min(1, moodsAt(character, day).filter((mood) => mood.kind === kind).reduce((sum, mood) => sum + mood.strength, 0) / 100);
}

/** What happens to a man puts a feeling on him. */
export function feel(world: WorldState, characterId: string, lesson: Cause, atStep: number): WorldState {
  const feels = FEELS[lesson];
  if (feels === undefined || !world.characters.some((character) => character.id === characterId && character.alive)) return world;
  return {
    ...world,
    characters: world.characters.map((character) => {
      if (character.id !== characterId) return character;
      const kept = moodsAt(character, atStep).map((mood) => ({ kind: mood.kind, strength: mood.strength, atStep }));
      const merged = [...kept];
      for (const [kind, strength] of feels) {
        const at = merged.findIndex((mood) => mood.kind === kind);
        // The same feeling again deepens what is left of it, up to the whole of it.
        if (at >= 0) merged[at] = { ...merged[at]!, strength: Math.min(100, merged[at]!.strength + strength), atStep };
        else merged.push({ kind, strength, atStep });
      }
      return { ...character, moods: merged.sort((a, b) => b.strength - a.strength).slice(0, MAX_MOODS) };
    }),
  };
}

/** What a man feels, in a clause for the one who has to write him. Empty for the untroubled. */
export function moodInWords(character: Pick<Character, "moods">, day: number): string[] {
  const words: Record<MoodKind, readonly [string, string]> = {
    anger: ["Just now you are angry", "and want to answer it"],
    grief: ["Just now you are in grief", "and have little heart for anything else"],
    fear: ["Just now you are afraid", "and see danger in everything"],
    elation: ["Just now you are exultant", "and feel you cannot fail"],
    shame: ["Just now you are ashamed", "and need to put it right"],
  };
  return moodsAt(character, day).filter((mood) => mood.strength >= 25).slice(0, 2).map((mood) => `${words[mood.kind][0]} (${mood.strength >= 60 ? "strongly" : "somewhat"}) ${words[mood.kind][1]}.`);
}
