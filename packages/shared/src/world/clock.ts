import { z } from "zod";
import { ElapsedStepSchema } from "../material-state";

// The elastic clock's scale (ADR-0016, ADR-0032).
//
// The authoritative world stores only a non-negative elapsedStep. The scenario
// supplies what a step means to a human and how many of them make a year, so
// ageing and scheduled systems stay deterministic without the simulation ever
// choosing a historical calendar. Historical dates are descriptive setting
// material, not simulation state.

export const ScenarioClockSchema = z
  .object({
    /** What one step is called: "a week", "a season". Presentation only. */
    stepLabel: z.string().trim().min(1).max(40),
    stepLabelPlural: z.string().trim().min(1).max(40),
    /**
     * How many steps a scenario calls a year. Ageing and annual income read
     * this; nothing derives an absolute date from it.
     */
    stepsPerYear: z.number().int().positive().max(3_660),
    /** Below this, the clock does not stop -- it keeps players from being woken for trivia. */
    minSpan: z.number().int().positive().max(10_000),
    /** At this, the clock stops regardless -- an era may not pass unattended. */
    maxSpan: z.number().int().positive().max(10_000),
    /**
     * Optional calendar anchor for the game's opening step.
     * When present, the web layer can derive a human-readable date label like
     * "12th of September 1683" from `elapsedStep`. Absent → fall back to the
     * raw step count. Presentation only — the simulation never reads this.
     */
    epoch: z
      .object({
        year: z.number().int().positive(),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
        era: z.enum(["BCE", "CE"]).optional(),
      })
      .optional(),
  })
  .refine((clock) => clock.maxSpan >= clock.minSpan, {
    message: "A scenario's maxSpan must be at least its minSpan.",
    path: ["maxSpan"],
  })
  .refine((clock) => {
    const epoch = clock.epoch;
    if (epoch === undefined) return true;
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return epoch.day <= (daysInMonth[epoch.month - 1] ?? 0);
  }, {
    message: "A scenario epoch must name a real day in its month.",
    path: ["epoch", "day"],
  });
export type ScenarioClock = z.infer<typeof ScenarioClockSchema>;

/**
 * The versions a match pins when it starts.
 *
 * Stored in the snapshot rather than only on the game row, so a replay is
 * self-describing: docs/14-actions.md requires that promoting an action into
 * the library cannot alter a stored replay, and ADR-0024 requires that editing
 * a scenario cannot disturb a match already running on it.
 */
export const WorldPinsSchema = z
  .object({
    scenarioId: z.string().trim().min(1).max(120),
    scenarioVersion: z.number().int().positive(),
    libraryVersion: z.number().int().positive(),
  })
  .strict();
export type WorldPins = z.infer<typeof WorldPinsSchema>;

/** Why the elastic clock stopped. Part of the determinism contract, not just flavour. */
export const StopReasonSchema = z.enum([
  "player_decision",
  "action_completed",
  "watch_condition",
  "threshold_crossed",
  "scheduled_life_event",
  "max_span",
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export { ElapsedStepSchema };
