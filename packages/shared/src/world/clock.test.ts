import { describe, expect, it } from "vitest";
import { ScenarioClockSchema, StopReasonSchema, calendarDateOf, formatWorldDate } from "./clock";

const clock = ScenarioClockSchema.parse({
  epoch: { year: 264, month: 3, day: 1, era: "BCE" },
  minSpanDays: 7,
  maxSpanDays: 365,
});

describe("ScenarioClockSchema", () => {
  it("requires an epoch, because events carry real timestamps", () => {
    expect(ScenarioClockSchema.safeParse({ minSpanDays: 7, maxSpanDays: 365 }).success).toBe(false);
  });

  it("rejects a span whose maximum is below its minimum", () => {
    expect(ScenarioClockSchema.safeParse({ epoch: { year: 264, month: 3, day: 1, era: "BCE" }, minSpanDays: 90, maxSpanDays: 7 }).success).toBe(false);
  });

  it("rejects an epoch that names a day its month does not have", () => {
    expect(ScenarioClockSchema.safeParse({ epoch: { year: 264, month: 2, day: 31, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 }).success).toBe(false);
  });
});

describe("calendar conversion", () => {
  it("names day 0 as the scenario's own epoch", () => {
    expect(calendarDateOf({ day: 0, minute: 0 }, clock)).toEqual({ year: 264, month: 3, day: 1, era: "BCE" });
  });

  it("advances within a month", () => {
    expect(calendarDateOf({ day: 12, minute: 600 }, clock)).toEqual({ year: 264, month: 3, day: 13, era: "BCE" });
  });

  it("carries across a month boundary", () => {
    expect(calendarDateOf({ day: 31, minute: 0 }, clock)).toEqual({ year: 264, month: 4, day: 1, era: "BCE" });
  });

  it("counts down across a BCE year boundary, where the year number decreases", () => {
    // 1 March 264 BC + 306 days reaches 1 January 263 BC.
    expect(calendarDateOf({ day: 306, minute: 0 }, clock)).toEqual({ year: 263, month: 1, day: 1, era: "BCE" });
  });

  it("crosses from BCE into CE without a year zero in the displayed numbering", () => {
    const lateRepublic = ScenarioClockSchema.parse({ epoch: { year: 1, month: 12, day: 31, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 });
    expect(calendarDateOf({ day: 1, minute: 0 }, lateRepublic)).toEqual({ year: 1, month: 1, day: 1, era: "CE" });
  });

  it("formats a date the way a prompt or chronicle heading reads it", () => {
    expect(formatWorldDate({ day: 0, minute: 0 }, clock)).toBe("1 March 264 BC");
  });
});

describe("StopReasonSchema", () => {
  it("covers every way a burst can end", () => {
    for (const reason of ["player_decision", "salient_event", "watch_condition", "no_due_events", "budget_exhausted", "max_span"]) {
      expect(StopReasonSchema.safeParse(reason).success).toBe(true);
    }
  });

  it("no longer accepts the deleted turn-era reasons", () => {
    expect(StopReasonSchema.safeParse("plan_interrupted").success).toBe(false);
  });
});
