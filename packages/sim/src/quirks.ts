import { stableHash, type Character } from "@chronica/shared";

/**
 * What is particular about a man (docs/plans/a-living-world.md).
 *
 * Two rulers with the same drives and temperament were interchangeable: they
 * weighed a letter and a war alike, month after month. People are not like
 * that. Everyone has a few settled habits of mind that are not a trait or a
 * drive: a man who distrusts every offer, one who cannot refuse a friend, one
 * who puts off any decision in a month the omens are against, one who has
 * never forgiven a particular neighbour and one who is fond of another, one who
 * writes long and one who cannot help a proverb.
 *
 * They are given at the start from the man's own id, two to a man, fixed for
 * life, small in effect and always the same -- the sort of thing a person's
 * letters and choices keep turning up, not a type.
 */

export type QuirkId =
  | "suspicious" | "generous" | "superstitious" | "stubborn" | "tender_hearted"
  | "long_winded" | "proverbial" | "devout" | "grudge_bearer" | "loyal_friend";

export interface Quirk {
  readonly id: QuirkId;
  readonly label: string;
  /** For the one who has to write him: how it shows. */
  readonly words: string;
}

const QUIRKS: readonly Quirk[] = [
  { id: "suspicious", label: "distrusts every offer", words: "You distrust every offer made to you, and look for the trick in it." },
  { id: "generous", label: "cannot refuse a friend", words: "You find it hard to refuse a friend who asks for help." },
  { id: "superstitious", label: "reads omens", words: "You put off any decision in a month the omens are against it." },
  { id: "stubborn", label: "will not be seen to give way", words: "You will not be seen to give way, even when you are wrong." },
  { id: "tender_hearted", label: "cannot bear the sight of war's cost", words: "You cannot bear to prolong a war whose cost you have seen." },
  { id: "long_winded", label: "writes at length", words: "You write long, and cannot help explaining yourself." },
  { id: "proverbial", label: "speaks in sayings", words: "You cannot write without a saying for the occasion." },
  { id: "devout", label: "calls on the gods in all things", words: "You call on the gods in everything you write and decide." },
  { id: "grudge_bearer", label: "has never forgiven one neighbour", words: "There is one neighbour you have never forgiven, and everything about it counts against it." },
  { id: "loyal_friend", label: "is fond of one neighbour", words: "There is one neighbour you are fond of, and you give it the benefit of every doubt." },
];

/** Two quirks to a man, from his own id: always the same two. */
export function quirksOf(character: Pick<Character, "id">): readonly Quirk[] {
  const first = stableHash([character.id, "quirk", "a"]) % QUIRKS.length;
  let second = stableHash([character.id, "quirk", "b"]) % (QUIRKS.length - 1);
  if (second >= first) second += 1;
  return [QUIRKS[first]!, QUIRKS[second]!];
}

export const hasQuirk = (character: Pick<Character, "id">, id: QuirkId): boolean => quirksOf(character).some((quirk) => quirk.id === id);

/**
 * Which neighbour a grudge-bearer will not forgive, or a loyal friend is fond
 * of: one of the powers near him, picked by his own id, so it is the same
 * neighbour every time and a different one for a different man.
 */
export function favouredNeighbour(character: Pick<Character, "id">, neighbourIds: readonly string[], kind: "grudge_bearer" | "loyal_friend"): string | null {
  if (!hasQuirk(character, kind) || neighbourIds.length === 0) return null;
  const sorted = [...neighbourIds].sort();
  return sorted[stableHash([character.id, kind, "who"]) % sorted.length] ?? null;
}

/** What his quirks add to a letter: a saying, a long explanation, or the gods called on. Empty for most letters of most men. */
export function flourishOf(character: Pick<Character, "id">, intent: string): string {
  const day = stableHash([character.id, intent, "flourish"]);
  if (hasQuirk(character, "proverbial")) {
    return ["A hasty word is a stone thrown, and cannot be called back.", "The wise man waits for the harvest, and the fool eats the seed.", "He who has a friend in need has two friends, or none.", "What is begun in anger ends in shame."][day % 4]!;
  }
  if (hasQuirk(character, "devout")) return ["May the gods keep us both from folly.", "Let the gods be witness to what is written here.", "We say this under heaven, and leave the rest to the gods."][day % 3]!;
  if (hasQuirk(character, "long_winded")) return ["We have said this at length because it is not a thing to be said shortly, and we would be understood in every part of it.", "We would have this well understood, for much hangs on it, and a letter that is brief is too often a letter misread."][day % 2]!;
  return "";
}
