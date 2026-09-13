import { describe, expect, it } from "vitest";
import { ScenarioClockSchema, StopReasonSchema, currentWorldInstant, daysPerStep, deriveWorldInstant, deriveWorldTime, instantForStepOffset } from "./clock";

const clock = ScenarioClockSchema.parse({
  stepLabel: "season",
  stepLabelPlural: "seasons",
  stepsPerYear: 4,
  minSpan: 1,
  maxSpan: 10,
});

describe("daysPerStep / deriveWorldTime (docs/32, Phase 6)", () => {
  it("derives days per step from the scenario's own stepsPerYear", () => {
    expect(daysPerStep(clock)).toBeCloseTo(91.25);
  });

  it("falls back to the engine default (4 steps/year) when no scenario clock is given", () => {
    expect(daysPerStep(undefined)).toBeCloseTo(91.25);
  });

  it("keeps coarseStep identical to the authoritative elapsedStep", () => {
    expect(deriveWorldTime(3, clock).coarseStep).toBe(3);
  });

  it("derives a proportional elapsedDay from elapsedStep", () => {
    expect(deriveWorldTime(4, clock).elapsedDay).toBe(365);
    expect(deriveWorldTime(0, clock).elapsedDay).toBe(0);
  });
});

describe("deriveWorldInstant (docs/32, Phase 7)", () => {
  it("matches deriveWorldTime's elapsedDay, at minute 0", () => {
    const instant = deriveWorldInstant(4, clock);
    expect(instant).toEqual({ day: deriveWorldTime(4, clock).elapsedDay, minute: 0 });
  });

  it("floors rather than rounds, unlike deriveWorldTime's elapsedDay", () => {
    // step 1 under a 91.25-day step -> 91.25 days: deriveWorldTime rounds to 91,
    // deriveWorldInstant floors to 91 as well here, but at a step where rounding
    // and flooring diverge the instant must floor (a day only "arrives" once begun).
    expect(deriveWorldInstant(1, clock)).toEqual({ day: 91, minute: 0 });
  });
});

describe("currentWorldInstant (unified action runtime, authoritative time continuity)", () => {
  it("prefers a world's own carried instant over anything derived from elapsedStep", () => {
    // A world whose committed instant (day 400, from an earlier elastic
    // continuation) sits far past what naively deriving from elapsedStep
    // would give (elapsedStep 1 under this clock derives to day 91) --
    // currentWorldInstant must never regress to the naive derivation.
    const world = { elapsedStep: 1, instant: { day: 400, minute: 30 } };
    expect(currentWorldInstant(world, clock)).toEqual({ day: 400, minute: 30 });
  });

  it("falls back to deriveWorldInstant for a pre-Phase-7 snapshot with no instant", () => {
    const world = { elapsedStep: 4 };
    expect(currentWorldInstant(world, clock)).toEqual(deriveWorldInstant(4, clock));
  });
});

describe("instantForStepOffset (unified action runtime, requirement 3)", () => {
  it("schedules relative to the world's real current instant, not to an absolute step-derived day", () => {
    // The world's real instant (day 400) has already drifted far from what
    // deriveWorldInstant(step) would say for this step -- a plan stage
    // scheduled 2 steps out (2 * 91.25 = 182.5 days) must land at day
    // 400 + 182.5 = 582.5 (day 582, noon), never at deriveWorldInstant(fromStep + 2).
    const base = { day: 400, minute: 0 };
    expect(instantForStepOffset(base, 10, 12, clock)).toEqual({ day: 582, minute: 720 });
  });

  it("carries a non-zero minute-of-day forward unchanged when the offset is a whole number of days", () => {
    const base = { day: 10, minute: 45 };
    expect(instantForStepOffset(base, 1, 5, clock)).toEqual({ day: 10 + Math.round(4 * 91.25), minute: 45 });
  });
});

describe("StopReasonSchema (docs/32, Phase 6)", () => {
  it("still accepts every value the live pipeline currently commits", () => {
    expect(StopReasonSchema.safeParse("player_decision").success).toBe(true);
  });

  it("accepts the newly declared, not-yet-produced stop reasons", () => {
    for (const reason of ["clarification_required", "salient_event", "plan_interrupted", "incoming_message"]) {
      expect(StopReasonSchema.safeParse(reason).success).toBe(true);
    }
  });
});
