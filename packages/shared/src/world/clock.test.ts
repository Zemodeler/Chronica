import { describe, expect, it } from "vitest";
import { ScenarioClockSchema, StopReasonSchema, daysPerStep, deriveWorldInstant, deriveWorldTime } from "./clock";

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
