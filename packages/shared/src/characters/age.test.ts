import { describe, expect, it } from "vitest";
import { classifyLifeStage, currentAgeYears, lifeStatus, type LifeStage } from "./age";
import { firstPunicWarScenario } from "@chronica/db";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("currentAgeYears", () => {
  it("derives age for a legacy character (no birthStep) from ageYearsAtStart plus elapsed time", () => {
    const marcus = world().characters.find((c) => c.id === "marcus-atilius")!;
    expect(marcus.birthStep).toBeNull();
    expect(currentAgeYears(marcus, 4, 0)).toBe(38);
    expect(currentAgeYears(marcus, 4, 8)).toBe(40);
  });

  it("derives age for a character born during play from birthStep, ignoring ageYearsAtStart", () => {
    const newborn = { ageYearsAtStart: 0, birthStep: 12 };
    expect(currentAgeYears(newborn, 4, 12)).toBe(0);
    expect(currentAgeYears(newborn, 4, 20)).toBe(2);
  });
});

describe("classifyLifeStage", () => {
  const stages: LifeStage[] = [
    { id: "youth", label: "youth", minAgeYears: 0, maxAgeYears: 17, mortalityRatePerYearBps: 0, incapacityRatePerYearBps: 0, recoveryRatePerYearBps: 0 },
    { id: "adult", label: "adulthood", minAgeYears: 18, maxAgeYears: 54, mortalityRatePerYearBps: 0, incapacityRatePerYearBps: 0, recoveryRatePerYearBps: 0 },
    { id: "elder", label: "old age", minAgeYears: 55, maxAgeYears: null, mortalityRatePerYearBps: 0, incapacityRatePerYearBps: 0, recoveryRatePerYearBps: 0 },
  ];

  it("classifies by age bracket, generic to whatever the scenario authored", () => {
    expect(classifyLifeStage(10, stages)?.id).toBe("youth");
    expect(classifyLifeStage(38, stages)?.id).toBe("adult");
    expect(classifyLifeStage(80, stages)?.id).toBe("elder");
  });

  it("returns undefined when no authored stage covers the age", () => {
    expect(classifyLifeStage(10, [])).toBeUndefined();
  });
});

describe("lifeStatus", () => {
  it("is deceased regardless of any tag once alive is false", () => {
    expect(lifeStatus({ alive: false, disqualifyingStatuses: ["captured"] })).toBe("deceased");
  });

  it("reads engine-known tags from the existing disqualifyingStatuses array", () => {
    expect(lifeStatus({ alive: true, disqualifyingStatuses: ["captured"] })).toBe("captured");
    expect(lifeStatus({ alive: true, disqualifyingStatuses: ["incapacitated"] })).toBe("incapacitated");
    expect(lifeStatus({ alive: true, disqualifyingStatuses: ["retired"] })).toBe("retired");
    expect(lifeStatus({ alive: true, disqualifyingStatuses: [] })).toBe("living");
  });
});
