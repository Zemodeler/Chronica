import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { computeOpinion } from "./opinion";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("computeOpinion", () => {
  it("is zero when no relation cause is recorded", () => {
    const marcus = world().characters.find((c) => c.id === "marcus-atilius")!;
    expect(computeOpinion(marcus, "hanno")).toBe(0);
  });

  it("folds every cause the subject holds toward the target", () => {
    const marcus = { ...world().characters.find((c) => c.id === "marcus-atilius")! };
    marcus.relations = [
      {
        subjectCharacterId: "hanno",
        causes: [
          { id: "c1", label: "insulted you", score: -12, occurredAtStep: 1, decayPerYearBps: 0, encounterMemoryId: null },
          { id: "c2", label: "paid your debt", score: 8, occurredAtStep: 2, decayPerYearBps: 0, encounterMemoryId: null },
        ],
      },
    ];
    expect(computeOpinion(marcus, "hanno")).toBe(-4);
  });
});
