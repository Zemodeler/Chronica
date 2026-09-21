import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../index";
import { findPayProblems } from "./who-pays";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("who has undertaken to pay whom", () => {
  it("passes a scenario whose armies all have someone answering for their wages", () => {
    expect(findPayProblems(world())).toEqual([]);
  });

  it("says nothing about an army whose power keeps no treasury to pay it from", () => {
    const state = world();
    const legion = state.material.forces.find((force) => force.id === "campanian-legion")!;
    expect(legion.payObligationId).toBeNull();
    expect(findPayProblems(state).some((problem) => problem.message.includes("campanian-legion"))).toBe(false);
  });

  it("catches an army its own government could pay and has not undertaken to", () => {
    const state = world();
    const unwired: WorldState = {
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) =>
          force.id === "roman-field-army" ? { ...force, payObligationId: null } : force),
      },
    };
    const problems = findPayProblems(unwired);
    expect(problems.some((problem) => problem.message.includes(`"roman-field-army"`))).toBe(true);
    // And the wage bill it left behind is now paying nobody, which is the same
    // fault read from the other end.
    expect(problems.some((problem) => problem.message.includes(`"rome-legion-pay"`))).toBe(true);
  });

  it("catches money leaving a treasury for an army that does not exist", () => {
    const state = world();
    const orphaned: WorldState = {
      ...state,
      material: {
        ...state.material,
        obligations: [
          ...state.material.obligations,
          {
            id: "phantom-pay", kind: "army_pay", label: "Pay of an army nobody has",
            payerAccountId: "rome-treasury", amount: 100, cadenceSteps: 30, nextDueStep: 30,
            priority: 900, arrears: 0, missedPeriods: 0, active: true,
          },
        ],
      },
    };
    expect(findPayProblems(orphaned).some((problem) => problem.message.includes(`"phantom-pay"`))).toBe(true);
  });

  it("leaves the magistrates and the creditors alone", () => {
    const state = world();
    // `rome-magistracies` is a salary and pays no army; no force will ever
    // reference it, and that is not a fault.
    expect(findPayProblems(state).some((problem) => problem.message.includes("rome-magistracies"))).toBe(false);
  });
});
