import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { matterIdFor, matterPressureId, occurrenceSuffix, periodIndexFor } from "./identity";

describe("matterIdFor", () => {
  it("is stable across repeated calls with the same inputs", () => {
    expect(matterIdFor("obligation", "legio-i-pay", "period-12")).toBe(matterIdFor("obligation", "legio-i-pay", "period-12"));
  });

  it("produces the doc's exact periodic form", () => {
    expect(matterIdFor("obligation", "legio-i-pay", "period-12")).toBe("obligation:legio-i-pay:period-12");
  });

  it("produces the doc's exact continuous form (no period suffix) so legacy WorldDevelopment ids migrate unchanged", () => {
    expect(matterIdFor("scarcity", "sicily", null)).toBe("scarcity:sicily");
  });
});

describe("periodIndexFor", () => {
  it("advances by exactly one per cadence step", () => {
    const createdAtStep = 0;
    const cadenceSteps = 4;
    const first = periodIndexFor(4, cadenceSteps, createdAtStep);
    const second = periodIndexFor(8, cadenceSteps, createdAtStep);
    const third = periodIndexFor(12, cadenceSteps, createdAtStep);
    expect(second).toBe(first + 1);
    expect(third).toBe(second + 1);
  });

  it("is deterministic for the same inputs", () => {
    expect(periodIndexFor(20, 4, 0)).toBe(periodIndexFor(20, 4, 0));
  });

  it("never goes negative", () => {
    expect(periodIndexFor(0, 4, 100)).toBeGreaterThanOrEqual(0);
  });
});

describe("occurrenceSuffix", () => {
  it("is empty for the first occurrence", () => {
    expect(occurrenceSuffix(0)).toBe("");
  });

  it("is deterministic and distinct per reopen count", () => {
    const suffixes = [0, 1, 2, 3].map(occurrenceSuffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);
    expect(occurrenceSuffix(1)).toBe(occurrenceSuffix(1));
  });
});

describe("matterPressureId", () => {
  it("reproduces the legacy world-development-scheduler.ts sha256 scheme exactly", () => {
    for (const id of ["scarcity:sicily", "civic:senate-1", "war:carthage:rome:rome"]) {
      const expected = `development:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
      expect(matterPressureId(id)).toBe(expected);
    }
  });

  it("is deterministic", () => {
    expect(matterPressureId("scarcity:sicily")).toBe(matterPressureId("scarcity:sicily"));
  });

  it("differs for different matter ids", () => {
    expect(matterPressureId("scarcity:sicily")).not.toBe(matterPressureId("scarcity:rome"));
  });
});
