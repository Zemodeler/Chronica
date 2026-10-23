import { feudBetween, gensById, type Character, type WorldState } from "@chronica/shared";

/**
 * A feud between gentes colours the letters between their men (docs/plans/gentes.md).
 *
 * The Fabii and the Claudii quarrelled over the freedmen's enrolment of 304; Rufinus never forgave Fabricius for striking his name from the
 * roll. A quarrel of that kind outlives the men who began it (`gentes.ts` stokes it from the living and cools it by the month), and it is
 * in the voice of a man who writes to the other side. Words only, and bounded:
 *
 * - a man's liking for one of the hated gens is lowered by at most `FEUD_LIKING_SHIFT` points, which is counsel the rules give him
 *   (`letter-verdict.ts`: the same liking moves a peace, a pact, an alliance by a few points either way) and never an answer;
 * - the counsel names the quarrel, so the model that answers for him knows it, and may go against it;
 * - a letter the rules write between the two is cooler, and says so in a line; and the model that words a letter for the player is told of
 *   it, for the voice and not for the substance.
 */

/** The most a feud moves a man's liking for one of the other gens, in the points of `computeOpinion`. */
export const FEUD_LIKING_SHIFT = 15;
/** Heat (of 10 000) at which a feud is noticed in a letter at all, and the heat at which it is at its worst for the purpose. */
export const FEUD_NOTICED_AT = 800;
export const FEUD_FULL_AT = 6_000;
/** The most a feud adds to the coldness of the tone, as a share of one point of the scores that choose it. */
export const FEUD_COLDER_BY = 0.25;

/** The quarrel between two men's gentes, as a letter would speak of it. */
export interface Quarrel {
  readonly heat: number;
  /** The writer's gens and the reader's, in the plural ("the Fabii", "the Claudii"). */
  readonly ours: string;
  readonly theirs: string;
  /** What it is about, in a short phrase, as the record has it. */
  readonly over: string;
}

/** The feud between the gentes of two living men, if it is hot enough to be heard in a letter; null otherwise. */
export function quarrelBetween(world: WorldState, a: string | null | undefined, b: string | null | undefined): Quarrel | null {
  if (a == null || b == null || a === b) return null;
  const one = world.characters.find((character) => character.id === a);
  const other = world.characters.find((character) => character.id === b);
  if (one?.dynastyId == null || other?.dynastyId == null || one.dynastyId === other.dynastyId) return null;
  const heat = feudBetween(world, one.dynastyId, other.dynastyId);
  if (heat < FEUD_NOTICED_AT) return null;
  const ours = gensById(world, one.dynastyId);
  const theirs = gensById(world, other.dynastyId);
  if (ours === undefined || theirs === undefined) return null;
  const record = ours.feuds.find((feud) => feud.againstGensId === theirs.id) ?? theirs.feuds.find((feud) => feud.againstGensId === ours.id);
  return { heat, ours: ours.plural, theirs: theirs.plural, over: (record?.reason ?? "an old wrong").replace(/\.$/, "") };
}

/** How many points the quarrel takes off a man's liking for the other, never more than `FEUD_LIKING_SHIFT`. */
export const feudLikingShift = (quarrel: Quarrel | null): number => (quarrel === null ? 0 : -Math.round(Math.min(1, quarrel.heat / FEUD_FULL_AT) * FEUD_LIKING_SHIFT));

/** The coldness a quarrel adds to a writer's tone score: nothing without one, at most `FEUD_COLDER_BY`. */
export const feudColdness = (quarrel: Quarrel | null): number => (quarrel === null ? 0 : Math.min(1, quarrel.heat / FEUD_FULL_AT) * FEUD_COLDER_BY);

/** What is said to the man who answers, as counsel: the quarrel, and what it does to his liking; his answer is his. */
export function feudCounsel(quarrel: Quarrel): string {
  return `      ${quarrel.theirs} and ${quarrel.ours} are at feud (${quarrel.over}), and it sours his liking for the man who wrote: so much the more reason to doubt his good faith, or to answer him coldly. It is counsel only; you may let the quarrel lie.`;
}

/** What the model that words a letter for the player is told of the quarrel between the writer's gens and the reader's: for the voice, not the substance. */
export function feudForTheVoice(world: WorldState, writer: Character | undefined, readerId: string | null): string | null {
  if (writer === undefined) return null;
  const quarrel = quarrelBetween(world, writer.id, readerId);
  if (quarrel === null) return null;
  return `His gens, ${quarrel.ours}, is at feud with the reader's, ${quarrel.theirs} (${quarrel.over}): let it colour the words, as a man writes to one of a house he does not love; do not change what is asked or offered.`;
}

/** One line a rule-written letter between the two gentes carries, by how hard the writer is. */
const LINES: Readonly<Record<"soft" | "firm" | "hard", readonly string[]>> = {
  soft: ["The quarrel between {ours} and {theirs} is old, and we would not have it spoil this.", "We do not forget that {ours} and {theirs} have had their quarrel; let it not stand here."],
  firm: ["Nor is the quarrel between {ours} and {theirs} forgotten.", "The old quarrel between {ours} and {theirs} is in our mind as we write."],
  hard: ["Let {theirs} remember that {ours} has not forgotten {over}.", "{ours} do not forget {over}, and we write with it in mind."],
};

export function feudLine(quarrel: Quarrel, firmness: "soft" | "firm" | "hard", seed: number): string {
  const options = LINES[firmness];
  return options[seed % options.length]!
    .replaceAll("{ours}", quarrel.ours).replaceAll("{theirs}", quarrel.theirs).replaceAll("{over}", quarrel.over.replace(/^[A-Z]/, (c) => c.toLowerCase()));
}
