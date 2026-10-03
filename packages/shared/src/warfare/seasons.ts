import { stableHash } from "../determinism";
import { calendarDateOf, type ScenarioClock } from "../world/clock";
import type { CrossingType } from "../world/map";

/**
 * The year a general campaigns in.
 *
 * Nothing in the engine knew what month it was, so a legion marched over the
 * Apennines in January as fast as in June, a fleet crossed to Africa in the
 * dead of winter without a care, and an army stood in the field all winter on
 * the same bread it ate in summer. Every period this repository plays is a
 * Mediterranean one, where the sea was shut from November to March and the
 * campaigning season was the summer; so these are engine constants, keyed by
 * the calendar month, and every save benefits without new scenario data.
 *
 * Where the clock is not known -- a caller that passed none -- there are no
 * seasons: every function here takes the month, and a null month is always
 * the kindest reading.
 */

/** The calendar month of a world day, 1-12. */
export function monthOfDay(day: number, clock: ScenarioClock): number {
  return calendarDateOf({ day, minute: 0 }, clock).month;
}

/**
 * November to February: the roads are mud or snow, the passes shut, the sea
 * dangerous. March is Mars's month, when the legions took the field: counted
 * as winter, every scenario that opens on 1 March began its first campaign
 * at a winter crawl. The sea is still only half open then (`sailingSeason`).
 */
export function isWinterMonth(month: number | null): boolean {
  return month !== null && (month >= 11 || month <= 2);
}

/** June to September: the months a camp sickens in. */
export function isSummerMonth(month: number | null): boolean {
  return month !== null && month >= 6 && month <= 9;
}

/**
 * The sailing season (the Romans' `mare clausum`). From April to October the
 * sea is open; March and November are the risky edges of it; December to
 * February it is shut to anything but the shortest passage.
 */
export type SailingSeason = "open" | "risky" | "shut";

export function sailingSeason(month: number | null): SailingSeason {
  if (month === null) return "open";
  if (month === 12 || month <= 2) return "shut";
  if (month === 3 || month === 11) return "risky";
  return "open";
}

/** How much longer a march takes in winter. */
export const WINTER_MARCH_FACTOR = 1.5;
/** And over a mountain pass in winter, on top of that. */
export const WINTER_PASS_FACTOR = 2;

/** The days a march of `days` takes in this month, over this ground. */
export function daysInSeason(days: number, month: number | null, overPass = false): number {
  if (!isWinterMonth(month)) return days;
  return Math.ceil(days * WINTER_MARCH_FACTOR * (overPass ? WINTER_PASS_FACTOR / WINTER_MARCH_FACTOR : 1));
}

/**
 * The chance, in basis points, that a voyage over this water in this month
 * meets a storm. A strait is an hour's sail and is rarely lost; a sea lane is
 * days out of sight of land.
 */
export function stormChanceBps(month: number | null, crossing: CrossingType): number {
  const season = sailingSeason(month);
  const short = crossing === "strait";
  if (season === "open") return short ? 0 : 100;
  if (season === "risky") return short ? 400 : 1_000;
  return short ? 1_200 : 3_000;
}

/** Of a fleet caught in a storm, the share of its hulls lost, in basis points: worse in the shut season. */
export function stormLossBps(month: number | null): number {
  return sailingSeason(month) === "shut" ? 1_500 : 600;
}

/** Of an army crossing a pass in winter, the share lost to cold, falls and snow, in basis points. */
export const WINTER_PASS_LOSS_BPS = 300;

/** Whether the storm finds this voyage: a deterministic roll on who sails, where, and when. */
export function stormFinds(month: number | null, crossing: CrossingType, key: readonly (string | number)[]): boolean {
  const chance = stormChanceBps(month, crossing);
  return chance > 0 && stableHash(["storm", ...key]) % 10_000 < chance;
}
