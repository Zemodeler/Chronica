import type { Character } from "@chronica/shared";
import { feeling } from "./moods";

/**
 * What a ruler is like, as the world AI weighs it -- by rule, with no model in
 * it (docs/plans/a-living-world.md).
 *
 * The first world AI read three of a ruler's traits and one number off his
 * temperament, and weighed every other reason the same for everybody: a power
 * with a grievance, a claim or a distracted neighbour got the same push
 * whoever ruled it. So rulers differed only in how much they wanted a war, not
 * in what they wanted it *for*, what would stop them, or when they would make
 * peace.
 *
 * Here each reason a power has is weighed by the part of the ruler's mind that
 * answers to it, all of it continuous, so no two rulers weigh a board alike:
 *
 * - **greed** (wealth, status) answers to weak neighbours and open ground;
 * - **grudge** (revenge, set against forgiveness in sociability) answers to old enmity;
 * - **honour** (duty, honesty, faith) answers to claims and held ground, and
 *   keeps a treaty it has sworn;
 * - **fear** (security, caution) answers to a growing neighbour -- striking
 *   first -- and to war itself, which it does not want to be caught in;
 * - **nerve** (boldness, risk, a lack of caution) decides how bad the odds may
 *   be before the war is not worth starting;
 * - **pride** (status, revenge, honour) decides how much a war must cost
 *   before he will accept being the one who asked for peace;
 * - **steadiness** (discipline) keeps him from acting on a whim;
 * - **cruelty**, **sociability** and **vigour** (age and health) colour the
 *   rest.
 *
 * Every number is 0 to 1, derived from the ruler's own mind and nothing else,
 * so it reads the same everywhere it is used and cannot drift.
 */
export interface Disposition {
  readonly greed: number;
  readonly grudge: number;
  readonly honour: number;
  readonly fear: number;
  readonly nerve: number;
  readonly pride: number;
  readonly steadiness: number;
  readonly cruelty: number;
  readonly sociability: number;
  readonly vigour: number;
}

const unit = (value: number): number => Math.max(0, Math.min(1, value / 100));
const mean = (...parts: readonly number[]): number => parts.reduce((sum, part) => sum + part, 0) / parts.length;

export function dispositionOf(ruler: Character, day: number): Disposition {
  const { drives, temperament, riskTolerance } = ruler.mind;
  const ageYears = ruler.ageYearsAtStart + Math.floor(day / 365);
  // Strong to about fifty, failing after; a sick man has less of what it takes.
  const vigour = Math.max(0.15, Math.min(1, 1 - Math.max(0, ageYears - 50) / 40)) * (ruler.healthBps < 5_000 ? 0.6 : 1);
  const honesty = unit(temperament.honesty);
  // What he feels just now, for a few weeks (`moods.ts`): anger makes him rasher and slower to forgive, grief takes his appetite,
  // fear his nerve, elation makes him sure of himself, shame makes him want to put it right. Added on top of what he is.
  const anger = feeling(ruler, day, "anger"), grief = feeling(ruler, day, "grief"), dread = feeling(ruler, day, "fear");
  const elation = feeling(ruler, day, "elation"), shame = feeling(ruler, day, "shame");
  const within = (value: number): number => Math.max(0, Math.min(1, value));
  const settled = {
    greed: mean(unit(drives.wealth), unit(drives.status)) - 0.25 * grief + 0.1 * elation,
    // Revenge is held against what forgiving natures let go.
    grudge: Math.max(0, Math.min(1, unit(drives.revenge) - (unit(temperament.sociability) - 0.5) * 0.3)) + 0.3 * anger + 0.2 * shame,
    honour: mean(unit(drives.duty), honesty, unit(drives.faith) * 0.6 + 0.2),
    fear: mean(unit(drives.security), unit(temperament.caution)) + 0.35 * dread + 0.1 * grief - 0.1 * anger - 0.2 * elation,
    nerve: mean(unit(temperament.boldness), unit(riskTolerance), 1 - unit(temperament.caution)) + 0.25 * anger + 0.25 * elation + 0.1 * shame - 0.3 * dread - 0.15 * grief,
    pride: mean(unit(drives.status), unit(drives.revenge), unit(drives.duty) * 0.5 + 0.25) + 0.15 * anger + 0.25 * shame,
    steadiness: unit(temperament.discipline) - 0.3 * anger - 0.1 * grief - 0.1 * dread - 0.1 * elation - 0.1 * shame,
    cruelty: unit(temperament.cruelty) + 0.1 * anger,
    sociability: unit(temperament.sociability) - 0.1 * grief - 0.1 * anger,
    vigour,
  };
  return {
    greed: within(settled.greed), grudge: within(settled.grudge), honour: settled.honour, fear: within(settled.fear), nerve: within(settled.nerve),
    pride: within(settled.pride), steadiness: within(settled.steadiness), cruelty: within(settled.cruelty), sociability: within(settled.sociability), vigour: settled.vigour,
  };
}

/** A weight that is 1 for the middling ruler and `spread` either side of it at the extremes. */
export const tilt = (value: number, spread: number): number => 1 + (value - 0.5) * 2 * spread;

/**
 * How eager he is for a war at all, before any reason is weighed: ambition and
 * nerve push, fear and age hold back, cruelty adds a little. About zero for a
 * middling ruler; roughly -25 to +25 at the extremes.
 */
export function appetiteOf(d: Disposition): number {
  return (d.greed - 0.5) * 26 + (d.nerve - 0.5) * 22 + (d.cruelty - 0.5) * 8 - (d.fear - 0.5) * 12 + (d.vigour - 0.7) * 14;
}

/**
 * The worst odds he will start a war at: our strength over theirs. A bold
 * and hungry ruler takes a fight at an even chance; a fearful one wants to be
 * far the stronger. A middling ruler asks for 0.8, as every ruler once did.
 */
export function leastOdds(d: Disposition): number {
  return Math.max(0.35, Math.min(1.6, 0.8 + (0.5 - d.nerve) * 1.1 + (d.fear - 0.5) * 0.4));
}

/**
 * Pressure that has to be on him before he accepts peace, over the base for
 * a middling ruler (points of war weariness): the proud and vengeful go on
 * long after a plain man would stop; the frightened stop sooner.
 */
export function peaceReluctance(d: Disposition): number {
  return Math.round((d.pride - 0.5) * 32 + (d.grudge - 0.5) * 14 - (d.fear - 0.5) * 10 - (d.steadiness - 0.5) * 6);
}

/** The clauses of a ruler's own nature that bear on a war, each only where it is marked in him. */
export function natureInWords(d: Disposition): string[] {
  const words: string[] = [];
  if (d.greed >= 0.65) words.push("hungry for glory and gain");
  if (d.grudge >= 0.65) words.push("not a man who forgives");
  if (d.honour >= 0.7) words.push("jealous of his honour");
  if (d.fear >= 0.65) words.push("afraid of being caught unready");
  if (d.nerve >= 0.65) words.push("bold to the edge of rashness");
  else if (d.nerve <= 0.3) words.push("slow to risk anything");
  if (d.cruelty >= 0.7) words.push("cruel");
  if (d.vigour <= 0.4) words.push("failing with age or sickness");
  return words;
}
