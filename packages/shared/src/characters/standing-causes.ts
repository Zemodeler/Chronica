/**
 * What moves a person's standing, and how far one deed of each kind may.
 *
 * Standing is what an election is counted on and who a house is offered to,
 * so a model free to write any shift up to a fifth of the scale for anything
 * at all could make a nobody electable with one well-received dinner. Each
 * cause has its own ceiling instead. The bad ones only lower it.
 */
export const STANDING_CAUSES = ["victory", "triumph", "games", "office", "patronage", "oratory", "work", "scandal", "defeat"] as const;
export type StandingCause = (typeof STANDING_CAUSES)[number];

/** The most one deed of each kind can move standing, either way. */
export const STANDING_CEILINGS_BPS: Readonly<Record<StandingCause, { readonly up: number; readonly down: number }>> = {
  victory: { up: 1_500, down: 0 },
  triumph: { up: 1_000, down: 0 },
  // Games and public works: bought, and remembered.
  games: { up: 800, down: 0 },
  office: { up: 500, down: 0 },
  patronage: { up: 300, down: 300 },
  // A speech on a question the house then decided: on the winning side, or badly beaten.
  oratory: { up: 300, down: 300 },
  // A book, a history, a school's reputation.
  work: { up: 400, down: 200 },
  scandal: { up: 0, down: 1_500 },
  defeat: { up: 0, down: 1_500 },
};

/** A shift nobody named a cause for. */
export const UNNAMED_STANDING_CEILING_BPS = 300;

/** The shift as the engine allows it. */
export function clampStandingShift(deltaBps: number, cause: StandingCause | undefined): number {
  const ceiling = cause === undefined
    ? { up: UNNAMED_STANDING_CEILING_BPS, down: UNNAMED_STANDING_CEILING_BPS }
    : STANDING_CEILINGS_BPS[cause];
  return Math.max(-ceiling.down, Math.min(ceiling.up, deltaBps));
}

/** Standing as the player reads it: "2,190". The number is his business to see; basis points are not. */
export function formatStanding(prestigeBps: number): string {
  return Math.round(prestigeBps).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * What a gate asks against what he has, in the words every refusal uses:
 * "standing 2,190 of 3,000 required". The refusal used to say only that his
 * prestige was "below the required minimum", and a player could not tell
 * whether he was one deed short or twenty.
 */
export function standingShortOf(prestigeBps: number, neededBps: number): string {
  return `standing ${formatStanding(prestigeBps)} of ${formatStanding(neededBps)} required`;
}
