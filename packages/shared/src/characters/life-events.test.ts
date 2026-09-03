import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { dueLifeReviews, nextReviewStep, rollLifeEvent } from "./life-events";
import type { LifeStage } from "./age";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

const NEUTRAL_STAGE: LifeStage = { id: "adult", label: "adulthood", minAgeYears: 0, maxAgeYears: null, mortalityRatePerYearBps: 0, incapacityRatePerYearBps: 0, recoveryRatePerYearBps: 0 };

describe("rollLifeEvent", () => {
  it("never produces an event when the scenario authors no rates (bounded by default)", () => {
    for (let step = 0; step < 50; step++) {
      expect(rollLifeEvent({ id: "char-1", disqualifyingStatuses: [] }, NEUTRAL_STAGE, step)).toBeNull();
    }
  });

  it("returns null when no life stage covers the character's age", () => {
    expect(rollLifeEvent({ id: "char-1", disqualifyingStatuses: [] }, undefined, 0)).toBeNull();
  });

  it("is deterministic: the same character and step always roll the same outcome", () => {
    const highMortality: LifeStage = { ...NEUTRAL_STAGE, mortalityRatePerYearBps: 5_000 };
    const first = rollLifeEvent({ id: "char-1", disqualifyingStatuses: [] }, highMortality, 7);
    const second = rollLifeEvent({ id: "char-1", disqualifyingStatuses: [] }, highMortality, 7);
    expect(second).toEqual(first);
  });

  it("only rolls recovery for an already-incapacitated character", () => {
    const stage: LifeStage = { ...NEUTRAL_STAGE, mortalityRatePerYearBps: 10_000, incapacityRatePerYearBps: 10_000, recoveryRatePerYearBps: 0 };
    const roll = rollLifeEvent({ id: "char-1", disqualifyingStatuses: ["incapacitated"] }, stage, 0);
    expect(roll).toBeNull();
  });

  it("can roll death at a high authored mortality rate", () => {
    const stage: LifeStage = { ...NEUTRAL_STAGE, mortalityRatePerYearBps: 10_000 };
    const roll = rollLifeEvent({ id: "char-1", disqualifyingStatuses: [] }, stage, 0);
    expect(roll?.kind).toBe("death");
  });
});

describe("dueLifeReviews / nextReviewStep", () => {
  it("selects only living characters whose review step has arrived", () => {
    const w = world();
    const characters = w.characters.map((c, index) => {
      if (index === 0) return { ...c, alive: true, nextLifeReviewAtStep: 4 };
      if (index === 1) return { ...c, alive: true, nextLifeReviewAtStep: 10 };
      if (index === 2) return { ...c, alive: false, diedAtStep: 0, nextLifeReviewAtStep: 4 };
      return { ...c, alive: true, nextLifeReviewAtStep: null };
    });
    const due = dueLifeReviews(characters, 5);
    expect(due.map((c) => c.id)).toEqual([characters[0]!.id]);
  });

  it("schedules the next review at atStep + interval", () => {
    expect(nextReviewStep(4, 4)).toBe(8);
  });
});
