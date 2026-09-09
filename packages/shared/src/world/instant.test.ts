import { describe, expect, it } from "vitest";
import { addMinutes, compareWorldInstant, midnight, worldInstantFromSortKey, worldInstantToSortKey } from "./instant";

describe("worldInstantToSortKey / worldInstantFromSortKey (docs/32, Phase 7)", () => {
  it("flattens day+minute into a single monotonic key", () => {
    expect(worldInstantToSortKey({ day: 0, minute: 0 })).toBe(0);
    expect(worldInstantToSortKey({ day: 1, minute: 0 })).toBe(1440);
    expect(worldInstantToSortKey({ day: 0, minute: 660 })).toBe(660);
  });

  it("round-trips through the sort key", () => {
    const instant = { day: 12, minute: 727 };
    expect(worldInstantFromSortKey(worldInstantToSortKey(instant))).toEqual(instant);
  });
});

describe("compareWorldInstant", () => {
  it("orders an earlier day-11:00 event before a same-day noon event", () => {
    const elevenAm = { day: 5, minute: 11 * 60 };
    const noon = { day: 5, minute: 12 * 60 };
    expect(compareWorldInstant(elevenAm, noon)).toBe(-1);
    expect(compareWorldInstant(noon, elevenAm)).toBe(1);
  });

  it("treats identical instants as equal", () => {
    expect(compareWorldInstant({ day: 1, minute: 5 }, { day: 1, minute: 5 })).toBe(0);
  });
});

describe("addMinutes", () => {
  it("carries forward across a day boundary", () => {
    expect(addMinutes({ day: 0, minute: 1430 }, 20)).toEqual({ day: 1, minute: 10 });
  });

  it("carries backward across a day boundary for negative minutes", () => {
    expect(addMinutes({ day: 1, minute: 5 }, -10)).toEqual({ day: 0, minute: 1435 });
  });
});

describe("midnight", () => {
  it("builds the {day, minute: 0} instant for a given day", () => {
    expect(midnight(7)).toEqual({ day: 7, minute: 0 });
  });
});
