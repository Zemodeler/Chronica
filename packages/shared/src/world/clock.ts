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

/**
 * Why the elastic clock stopped. Part of the determinism contract, not just
 * flavour. `salient_event`, `clarification_required`, `plan_interrupted`,
 * and `incoming_message` are declared here in docs/32 Phase 6, but the live
 * pipeline does not yet produce them -- every turn still commits
 * `stopReason: "player_decision"` unconditionally. Phase 7's elastic
 * scheduler is what actually starts choosing among these; see docs/32's
 * stop-condition priority order.
 */
export const StopReasonSchema = z.enum([
  "player_decision",
  "clarification_required",
  "salient_event",
  "watch_condition",
  "plan_interrupted",
  "threshold_crossed",
  "action_completed",
  "scheduled_life_event",
  "incoming_message",
  "max_span",
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

/**
 * Day-level authoritative time (docs/32, Phase 6), read alongside the
 * existing `elapsedStep`. `elapsedStep` -- renamed `coarseStep` here --
 * remains what the live pipeline actually advances by exactly 1 per turn
 * until Phase 7's elastic scheduler starts writing `elapsedDay` directly;
 * until then this is a read-only projection, not a second authoritative
 * clock in the snapshot.
 */
export interface WorldTime {
  readonly elapsedDay: number;
  readonly coarseStep: number;
}

/** Matches `gm/read-tools.ts`'s own default: used only when a scenario declares no clock at all. */
const DEFAULT_STEPS_PER_YEAR = 4;

/** How many days one step represents under a scenario's own clock, or the engine default absent one. */
export function daysPerStep(scenarioClock?: ScenarioClock): number {
  return 365 / (scenarioClock?.stepsPerYear ?? DEFAULT_STEPS_PER_YEAR);
}

/** Derives day-level time from the authoritative `elapsedStep`. Pure and read-only -- see the module comment above. */
export function deriveWorldTime(elapsedStep: number, scenarioClock?: ScenarioClock): WorldTime {
  return { elapsedDay: Math.round(elapsedStep * daysPerStep(scenarioClock)), coarseStep: elapsedStep };
}

export { ElapsedStepSchema };
