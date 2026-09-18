import { z } from "zod";
import { ElapsedStepSchema } from "../material-state";
import type { WorldInstant } from "./instant";

// The world's clock.
//
// Time used to be a turn counter: `elapsedStep` was authoritative, a step meant
// "a season", and `WorldInstant` was a fine clock derived *inside* one turn's
// resolution window. VISION §15 removes turns entirely and §16 asks for real
// timestamps, so the relationship is inverted: `WorldInstant` (day + minute
// from the scenario epoch) is authoritative, and `elapsedStep` is maintained as
// exactly `instant.day`.
//
// Keeping `elapsedStep` as a day count rather than deleting it is deliberate:
// roughly forty schemas across material state, projects, authority and the
// character system store `*AtStep` fields, and every one of them stays
// meaningful when a step is a day. What changes is only what a step *means* --
// no longer a turn, just a date.

export const ScenarioClockSchema = z
  .object({
    /**
     * The calendar date of day 0. Required, unlike its turn-era predecessor:
     * §16 wants events to carry real timestamps, and a world that cannot name
     * its own date cannot produce them.
     */
    epoch: z
      .object({
        year: z.number().int().positive(),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
        era: z.enum(["BCE", "CE"]).default("CE"),
      })
      .strict(),
    /** Below this many simulated days a burst does not stop for the player -- it keeps them from being woken for trivia. */
    minSpanDays: z.number().int().positive().max(3_660),
    /** At this many simulated days a burst stops regardless: an era may not pass unattended (VISION §22's hard safeguard). */
    maxSpanDays: z.number().int().positive().max(36_600),
  })
  .strict()
  .refine((clock) => clock.maxSpanDays >= clock.minSpanDays, {
    message: "A scenario's maxSpanDays must be at least its minSpanDays.",
    path: ["maxSpanDays"],
  })
  .refine((clock) => {
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return clock.epoch.day <= (daysInMonth[clock.epoch.month - 1] ?? 0);
  }, {
    message: "A scenario epoch must name a real day in its month.",
    path: ["epoch", "day"],
  });
export type ScenarioClock = z.infer<typeof ScenarioClockSchema>;

/**
 * The versions a match pins when it starts.
 *
 * Stored in the snapshot rather than only on the game row, so a replay is
 * self-describing: editing a scenario cannot disturb a match already running
 * on it.
 */
export const WorldPinsSchema = z
  .object({
    scenarioId: z.string().trim().min(1).max(120),
    scenarioVersion: z.number().int().positive(),
    libraryVersion: z.number().int().positive(),
  })
  .strict();
export type WorldPins = z.infer<typeof WorldPinsSchema>;

/**
 * Why a simulation burst stopped (VISION §23's three outcomes, with the reason
 * preserved). `player_decision` and `incoming_message` interrupt; the rest are
 * the world running out of room -- the calendar, the budget, or anything left
 * to wake for -- and produce a Chronicle of whatever happened on the way.
 *
 * There is deliberately no "enough has happened" reason. Accumulated weight
 * used to end a burst, which made every piece of news an interruption and cost
 * a campaign six orders where it needed one. Weight earns a Chronicle entry; it
 * does not earn the player's attention.
 */
export const StopReasonSchema = z.enum([
  "player_decision",
  "clarification_required",
  "salient_event",
  "watch_condition",
  "action_completed",
  "scheduled_life_event",
  "incoming_message",
  "no_due_events",
  "budget_exhausted",
  "max_span",
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const DAYS_PER_YEAR = 365;

/*
 * Calendar conversion, so a `WorldInstant` can be named as a date.
 *
 * Proleptic Gregorian throughout, including deep BCE, using astronomical year
 * numbering internally (1 BCE is year 0, 264 BCE is year -263). This is
 * presentation and prompt material -- the simulation itself only ever compares
 * day numbers -- but it has to be consistent, because a model told the wrong
 * date will reason from the wrong season.
 */

export interface CalendarDate {
  /** Positive, paired with `era` -- 264 with era "BCE" reads as 264 BC. */
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly era: "BCE" | "CE";
}

function toAstronomicalYear(year: number, era: "BCE" | "CE"): number {
  return era === "BCE" ? 1 - year : year;
}

function fromAstronomicalYear(year: number): { year: number; era: "BCE" | "CE" } {
  return year <= 0 ? { year: 1 - year, era: "BCE" } : { year, era: "CE" };
}

/** Days from 1970-01-01 for a proleptic Gregorian date in astronomical year numbering (Hinnant's algorithm). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: month <= 2 ? y + 1 : y, month, day };
}

/** The calendar date `instant` falls on, under the scenario's epoch. */
export function calendarDateOf(instant: WorldInstant, clock: ScenarioClock): CalendarDate {
  const epochDays = daysFromCivil(toAstronomicalYear(clock.epoch.year, clock.epoch.era), clock.epoch.month, clock.epoch.day);
  const civil = civilFromDays(epochDays + instant.day);
  return { ...fromAstronomicalYear(civil.year), month: civil.month, day: civil.day };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "1 March 264 BC" -- what a prompt, a Chronicle heading, or the UI shows. */
export function formatWorldDate(instant: WorldInstant, clock: ScenarioClock): string {
  const date = calendarDateOf(instant, clock);
  const month = MONTH_NAMES[date.month - 1] ?? "";
  return `${date.day} ${month} ${date.year} ${date.era === "BCE" ? "BC" : "AD"}`;
}

export { ElapsedStepSchema };
export type { WorldInstant };
