import { mercenaryContractOfForce, warsOf, type WorldState } from "@chronica/shared";
import type { Books } from "./fiscal-officers";

/**
 * How hard a power's money presses on it (docs/economy.md, "Strain, debasement and arrears").
 *
 * One reading, 0 to 100, from four things the treasurers of the age felt: how many months of its pay the chest
 * holds (`cover`), how much of the army's pay is behind (`arrearsMonths`), how long the war has gone on (`warMonths`)
 * and how much it has borrowed against it (`debtMonths`). The AI's fiscal and mint routines read it and nothing
 * else decides when a coin is struck lighter: in peace and in solvent times it stays low and the coin is left alone.
 *
 *  - cover: up to 30 points, none at three months in the chest or more, all of them at an empty chest;
 *  - arrears: up to 30, fifteen for every month of pay behind;
 *  - war: up to 15, rising over three years of war (nothing in peace);
 *  - debt: up to 25, rising over a year's pay owed to lenders.
 *
 * The coin is moved at `DEBASE_STRAIN` and over, in a war and with pay behind or the chest nearly empty; Rome's
 * reduction of the as in 217 and Carthage's billon at the end of the Mercenary War are what it is shaped on.
 */

/** From this the coin is struck lighter, in a war, when pay is behind or the chest is nearly empty. */
export const DEBASE_STRAIN = 55;
/** From this the pressure is at its worst: the lighter strike is the bigger one. */
export const DESPERATE_STRAIN = 80;
/** The strike is a tenth of the silver, and up to a sixth in desperation: the as of 217 fell by a third and more, but silver held better. */
export const DEBASE_STEP_BPS = 1_000;
export const DESPERATE_STEP_BPS = 1_700;
/** Pay behind this many months, or less cover than this, is what a war needs for the strain to move the coin at all. */
export const COIN_MOVES_AT_COVER = 1;
/** Coin is re-struck better when the war is over and the chest holds this many months of pay. */
export const REFORM_COVER_MONTHS = 6;
/** A decree to strike the coin lighter is carried out while the strain is at least this, though it has slipped under the line that moved it. */
export const DECREE_STRAIN = 35;
/** A year between one debasement and the next (the mint's own cooldown is sixty days; a treasurer waits for a harvest). */
export const DEBASE_COOLDOWN_DAYS = 365;

export interface Strain {
  readonly score: number;
  readonly cover: number;
  readonly arrearsMonths: number;
  readonly warMonths: number;
  readonly debtMonths: number;
  readonly atWar: boolean;
  /** Hired men of its own that have taken the road for want of pay: the war it fights at home, as Carthage did in 241-238. */
  readonly revolt: boolean;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** The day the longest war a power is in began, or null in peace. */
export function warMonthsOf(world: Pick<WorldState, "polityAgreements" | "instant">, polityId: string): number {
  let oldest: number | null = null;
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.kind !== "war") continue;
    if (agreement.polityId !== polityId && agreement.otherPolityId !== polityId) continue;
    if (oldest === null || agreement.sinceStep < oldest) oldest = agreement.sinceStep;
  }
  return oldest === null ? 0 : Math.max(0, (world.instant.day - oldest) / 30);
}

/** The strain on a power, from its books and its wars. */
export function strainOf(world: WorldState, book: Pick<Books, "balance" | "owed" | "arrears" | "debt">, polityId: string): Strain {
  const atWar = warsOf(world.polityAgreements, polityId).length > 0;
  const owed = Math.max(1, book.owed);
  const cover = book.owed <= 0 ? 99 : book.balance / owed;
  const arrearsMonths = book.arrears / owed;
  // What is in the chest after what is already owed is paid: a chest the arrears would swallow is no cover.
  const netCover = Math.max(0, (book.balance - book.arrears) / owed);
  const warMonths = atWar ? warMonthsOf(world, polityId) : 0;
  const debtMonths = book.debt / owed;
  const revolt = world.material.forces.some((force) => force.outlaw === true && force.polityId === polityId && force.personnel.some((row) => row.fit > 0) && mercenaryContractOfForce(world, force.id) === undefined && world.material.contracts.some((contract) => contract.forceId === force.id && contract.role === "mercenary" && contract.status === "lapsed"));
  const score = Math.round(
    clamp(30 * (3 - Math.min(cover, netCover)) / 3, 0, 30)
    + clamp(15 * arrearsMonths, 0, 30)
    + (atWar ? clamp(15 * warMonths / 36, 0, 15) : revolt ? 8 : 0)
    + clamp(25 * debtMonths / 12, 0, 25),
  );
  return { score, cover, arrearsMonths, warMonths, debtMonths, atWar, revolt };
}

/** Whether the strain is enough to make a treasurer strike the coin lighter: at war (or with its own hired men up in arms), past the threshold, and pay behind or the chest all but empty. */
export function coinIsMoved(strain: Strain, hasArrears: boolean): boolean {
  return (strain.atWar || strain.revolt) && strain.score >= DEBASE_STRAIN && (hasArrears || strain.cover < COIN_MOVES_AT_COVER);
}

/** Pay this many months behind, with the strain at this or over, is enough for the coin to be moved though the tax has not been raised to its ceiling: no treasury waits on a vote for a quarter of a year of unpaid soldiers. */
export const BEHIND_MONTHS_ENOUGH = 3;
export const BEHIND_STRAIN_ENOUGH = 60;

/** Whether the tax has been tried enough before the coin is touched: at its ceiling, or just raised, or the case is desperate or the soldiers are a quarter-year unpaid. */
export function taxTriedFirst(strain: Strain, taxAtCeilingOrRecent: boolean): boolean {
  return taxAtCeilingOrRecent || strain.score >= DESPERATE_STRAIN || (strain.arrearsMonths >= BEHIND_MONTHS_ENOUGH && strain.score >= BEHIND_STRAIN_ENOUGH);
}

/** How much lighter the coin is struck at this strain, in basis points of its silver (negative). */
export function debaseStepFor(strain: Strain): number {
  return strain.score >= DESPERATE_STRAIN ? -DESPERATE_STEP_BPS : -DEBASE_STEP_BPS;
}
