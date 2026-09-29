import { DEFAULT_WEALTH_BANDS, type WealthBand } from "../characters/wealth";
import { bandStrength } from "../material/in-words";
import type { SourceChannel } from "./source";
import { stableHash } from "../determinism";

/**
 * What the viewer can say about someone else's numbers.
 *
 * A commander knows his own men to the man, and nobody else's. Scouts count
 * files and guess. A letter repeats a figure a week old. Talk in the forum
 * doubles it. So a count of another power's men comes as a range, and the
 * range is as wide as the source is weak and old: "between 8,000 and 10,000,
 * by your scouts at Rhegium".
 *
 * The same rule is used for the model's slice and for the map, so the
 * narrator never knows a figure the player is shown only as a guess.
 */

/** How far off each channel is on the day it is heard, as a share of the truth. */
const SPREAD: Readonly<Record<SourceChannel, number>> = {
  own_eyes: 0.08,
  roll: 0,
  dealings: 0.1,
  record: 0.1,
  report: 0.12,
  letter: 0.18,
  public: 0.25,
  rumour: 0.4,
};

/** Each day since it was heard widens the range by this share; never past half. */
const SPREAD_PER_DAY = 0.006;
const MAX_SPREAD = 0.5;

/** To two significant figures: 8,437 is 8,400, and 612 is 610. */
function roughly(n: number): number {
  if (n < 10) return Math.max(0, Math.round(n));
  const magnitude = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / magnitude) * magnitude;
}

const figure = (n: number): string => n.toLocaleString("en-GB");

export interface MenEstimate {
  readonly low: number;
  readonly high: number;
  /** "about 9,000 men" or "between 8,000 and 10,000 men". */
  readonly label: string;
}

/**
 * How far a report leans, one way or the other, as a share of its spread.
 * A range centred on the truth told the reader the truth -- its midpoint was
 * the exact count -- so a report is off to one side as well as wide, and off
 * the same way every time the same report is read.
 */
const MAX_LEAN = 0.6;

/**
 * A count of somebody else's men, as a source would put it.
 *
 * `men` is what the source actually saw -- the army as it stood on the day of
 * the report, not today (`Fact.forcesAsReported`). `seed` names the report: the
 * army, the reader, the day it was heard. The truth is always inside the
 * range, and the range's midpoint is not it.
 */
export function estimateMen(men: number, channel: SourceChannel, ageDays: number, seed: readonly (string | number)[]): MenEstimate {
  if (men <= 0) return { low: 0, high: 0, label: "no men to speak of" };
  const spread = Math.min(MAX_SPREAD, SPREAD[channel] + Math.max(0, ageDays) * SPREAD_PER_DAY);
  if (spread <= SPREAD.own_eyes) {
    const about = bandStrength(men);
    return { low: about, high: about, label: `about ${figure(about)} men` };
  }
  // Under by up to MAX_LEAN of the spread, or over by as much.
  const lean = ((stableHash(seed) % 2_001) / 1_000 - 1) * MAX_LEAN;
  const low = roughly(men * (1 - Math.min(MAX_SPREAD, spread * (1 + lean))));
  const high = roughly(men * (1 + Math.min(MAX_SPREAD, spread * (1 - lean))));
  if (low === high) return { low, high, label: `about ${figure(low)} men` };
  return { low, high, label: `between ${figure(low)} and ${figure(high)} men` };
}

/** The same for hulls, which are fewer and easier to count from a headland. */
export function estimateShips(ships: number, channel: SourceChannel, ageDays: number): string {
  if (ships <= 0) return "no ships to speak of";
  const spread = Math.min(MAX_SPREAD, SPREAD[channel] + Math.max(0, ageDays) * SPREAD_PER_DAY);
  const low = Math.max(1, Math.round(ships * (1 - spread)));
  const high = Math.round(ships * (1 + spread));
  return low === high ? `${ships === 1 ? "one ship" : `about ${figure(ships)} ships`}` : `between ${figure(low)} and ${figure(high)} ships`;
}

/**
 * A balance as the world would put it: "a household of some standing".
 *
 * The bands overlap, as reputations do. The richest band whose floor the sum
 * reaches is the one people use.
 */
export function wealthInWords(balance: number, bands: readonly WealthBand[] = DEFAULT_WEALTH_BANDS): string {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  let label = sorted[0]?.label ?? "little";
  for (const band of sorted) if (balance >= band.min) label = band.label;
  return label;
}
