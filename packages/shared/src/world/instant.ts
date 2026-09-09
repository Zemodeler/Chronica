import { z } from "zod";

/**
 * Minute-precision simulation time (docs/32 Phase 7 target architecture).
 *
 * `WorldInstant` is additive to, not a replacement for, `elapsedStep`
 * (see `clock.ts`). `elapsedStep` keeps owning turn/snapshot identity --
 * `turns`/`worldSnapshots` stay keyed by it, and it still advances by
 * exactly 1 per resolved turn. `WorldInstant` is the finer clock that
 * lives *inside* one turn's resolution window
 * `[deriveWorldInstant(elapsedStep), deriveWorldInstant(elapsedStep + 1))`,
 * used to order events within that window (an 11:00 event before a noon
 * player order, etc.). `day` is absolute from the scenario epoch; `minute`
 * is minute-of-day.
 */
export const WorldInstantSchema = z
  .object({
    day: z.number().int().nonnegative(),
    minute: z.number().int().min(0).max(1439),
  })
  .strict();
export type WorldInstant = z.infer<typeof WorldInstantSchema>;

const MINUTES_PER_DAY = 1440;

/** -1 if a is earlier, 0 if equal, 1 if a is later. */
export function compareWorldInstant(a: WorldInstant, b: WorldInstant): -1 | 0 | 1 {
  const diff = worldInstantToSortKey(a) - worldInstantToSortKey(b);
  if (diff < 0) return -1;
  if (diff > 0) return 1;
  return 0;
}

/** Adds a (possibly negative) number of minutes, carrying across day boundaries. */
export function addMinutes(instant: WorldInstant, minutes: number): WorldInstant {
  const totalMinutes = instant.day * MINUTES_PER_DAY + instant.minute + minutes;
  const day = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const minute = totalMinutes - day * MINUTES_PER_DAY;
  return { day, minute };
}

export function midnight(day: number): WorldInstant {
  return { day, minute: 0 };
}

/**
 * Flattens a `WorldInstant` into a single monotonic integer for ordering and
 * DB indexing: `day * 1440 + minute`. The core "select next due event" query
 * is `ORDER BY instantSortKey ASC` against this value.
 */
export function worldInstantToSortKey(instant: WorldInstant): number {
  return instant.day * MINUTES_PER_DAY + instant.minute;
}

export function worldInstantFromSortKey(sortKey: number): WorldInstant {
  const day = Math.floor(sortKey / MINUTES_PER_DAY);
  const minute = sortKey - day * MINUTES_PER_DAY;
  return { day, minute };
}
