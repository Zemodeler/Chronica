import { feudBetween, nobilitasBps, type Character, type PoliticalProcedure, type WorldState } from "@chronica/shared";

/**
 * A gens in the house.
 *
 * Its men were not a faction -- they voted as they thought -- but a man leaned toward his gens's line, and
 * toward its first man's above all, and he did not like to be seen with the man whose family had a grudge
 * against his own. Two small, bounded effects on a division, read from the gentes and nothing else:
 *
 * - the seats of one gens, in one bloc, are drawn a quarter of the way toward the weighted mean of their
 *   leans, the princeps's counting double;
 * - a seat of a gens at feud with the man who moved the question leans against it, by a twelfth of the
 *   feud's heat, at most twelve points of a hundred.
 */

/** How far a gens's seats are drawn together: the share of the distance to their mean. */
export const GENS_PULL = 0.25;
/** The most a feud turns a seat against the other side's motion. */
export const FEUD_VOTE_MAX = 12;
export const FEUD_VOTE_DIVISOR_BPS = 800;
/** What a gens's first man weighs in its mean, against another man's one. */
export const PRINCEPS_WEIGHT = 2;

/**
 * The clients a great name brings to a man's word in the house, beside those of his clientele: a thousand points of nobilitas is one
 * more man who votes as he does. A new man's name brings none.
 */
export function clientsFromName(world: WorldState, character: Character): number {
  return world.gentes.length === 0 ? 0 : Math.max(0, Math.floor(nobilitasBps(world, character) / 1_000));
}

export interface Kin {
  /** The gens of the man who moved the question, if he has one. */
  readonly sponsorGensId: string | null;
  readonly feudOf: (gensId: string, otherGensId: string) => number;
}

/** What a division needs to know of the gentes: who moved it, and how hot each feud with him runs. */
export function kinOf(world: WorldState, procedure: Pick<PoliticalProcedure, "sponsorCharacterId">): Kin | undefined {
  if (world.gentes.length === 0) return undefined;
  const sponsor = procedure.sponsorCharacterId === null ? undefined : world.characters.find((character) => character.id === procedure.sponsorCharacterId);
  return { sponsorGensId: sponsor?.dynastyId ?? null, feudOf: (gensId, otherGensId) => feudBetween(world, gensId, otherGensId) };
}

export interface KinSeat {
  readonly gensId?: string | null | undefined;
  /** The first man of his gens. */
  readonly leader?: boolean | undefined;
}

/**
 * The leans of a bloc's seats once their gentes have drawn them together and their feuds have turned them.
 * Pure: the same seats and leans give the same answer, in the same order.
 */
export function leanAsAGens(seats: readonly KinSeat[], leans: readonly number[], kin: Kin | undefined): number[] {
  if (kin === undefined) return [...leans];
  const mean = new Map<string, { sum: number; weight: number; count: number }>();
  seats.forEach((seat, index) => {
    if (seat.gensId == null) return;
    const weight = seat.leader === true ? PRINCEPS_WEIGHT : 1;
    const entry = mean.get(seat.gensId) ?? { sum: 0, weight: 0, count: 0 };
    entry.sum += leans[index]! * weight;
    entry.weight += weight;
    entry.count += 1;
    mean.set(seat.gensId, entry);
  });
  return leans.map((lean, index) => {
    const seat = seats[index]!;
    if (seat.gensId == null) return lean;
    let out = lean;
    const group = mean.get(seat.gensId)!;
    if (group.count >= 2) out += (group.sum / group.weight - lean) * GENS_PULL;
    if (kin.sponsorGensId !== null && kin.sponsorGensId !== seat.gensId) {
      const heat = kin.feudOf(seat.gensId, kin.sponsorGensId);
      if (heat > 0) out -= Math.min(FEUD_VOTE_MAX, Math.round(heat / FEUD_VOTE_DIVISOR_BPS));
    }
    return out;
  });
}
