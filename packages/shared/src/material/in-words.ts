import type { MoneyObligation } from "../material-state";

/**
 * Condition, said rather than scored.
 *
 * `skills-in-words.ts` settled the argument for a person's abilities: the
 * numbers stay behind the boundary and the judgment crosses it, because a
 * number invites optimisation and a man does not have one. Everything a
 * commander or a landholder reads has the same problem. The slice tells the
 * model `morale 62/100` and `held in fact 7000`, and the player must not be
 * handed either.
 *
 * The seam only stays honest if both sides read one source. If these words
 * lived in the web app, "what the player sees and what the model is told
 * cannot drift apart" would stop being true the first time either side was
 * refactored -- so they live here, and `slice.ts` imports `bandStrength` back
 * out of this file rather than keeping its own copy.
 *
 * The vocabulary is deliberately the prose the engine already used, not new
 * invention: "shortage of supply" and "of N on the books" were written in the
 * slice long before anybody thought of showing them to a player.
 */

const MORALE: readonly { readonly atLeast: number; readonly word: string }[] = [
  { atLeast: 8_500, word: "in high spirits" },
  { atLeast: 7_000, word: "in good heart" },
  { atLeast: 5_000, word: "steady" },
  { atLeast: 3_500, word: "sullen" },
  { atLeast: 2_000, word: "close to breaking" },
  { atLeast: 0, word: "fit only to run" },
];

const CONTROL: readonly { readonly atLeast: number; readonly word: string }[] = [
  { atLeast: 8_500, word: "held firmly" },
  { atLeast: 6_500, word: "held" },
  { atLeast: 4_000, word: "held, but not securely" },
  { atLeast: 2_000, word: "barely held" },
  { atLeast: 0, word: "yours in law only" },
];

const word = (table: readonly { readonly atLeast: number; readonly word: string }[], bps: number): string =>
  (table.find((band) => bps >= band.atLeast) ?? table[table.length - 1]!).word;

/** How an army is bearing up, as its commander would put it. */
export const moraleInWords = (moraleBps: number): string => word(MORALE, moraleBps);

/** How securely a holding is actually held, as against how it is held on paper. */
export const controlInWords = (physicalControlBps: number): string => word(CONTROL, physicalControlBps);

/** Whether the men have eaten. The engine's three states, in the slice's own words. */
export function provisionInWords(status: "provisioned" | "shortage" | "critical"): string {
  switch (status) {
    case "provisioned": return "fed";
    case "shortage": return "short of supply";
    case "critical": return "starving";
  }
}

/**
 * Whether the men have been paid.
 *
 * A force with no pay obligation at all is not a force that is up to date; it
 * is a force nobody has undertaken to pay, which is a different and worse
 * thing, and the engine has always modelled it.
 */
export function payInWords(obligation: MoneyObligation | undefined, arrearsPeriods: number): string {
  if (obligation === undefined) return "Nobody has undertaken to pay them";
  if (obligation.arrears <= 0 && arrearsPeriods <= 0) return "Paid";
  const periods = Math.max(arrearsPeriods, obligation.missedPeriods);
  if (periods <= 0) return "Something is owed to them";
  return `${periods === 1 ? "One period" : `${periods} periods`} of pay owed`;
}

/**
 * A figure a bystander would quote: coarse, and never a casualty count read
 * backwards. Moved out of `slice.ts`, which now imports it from here.
 */
export function bandStrength(men: number): number {
  if (men < 100) return Math.round(men / 10) * 10;
  if (men < 1_000) return Math.round(men / 100) * 100;
  return Math.round(men / 500) * 500;
}
