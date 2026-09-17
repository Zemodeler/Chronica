import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

const base = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const tick = (world: WorldState, toDay: number) => runDeterministicTick({ world, toDay, ids: createIdFactory("tick") });
const balance = (world: WorldState, id: string) => world.material.accounts.find((account) => account.id === id)!.balance;

function withIncome(world: WorldState, amount: number, cadenceDays: number): WorldState {
  return {
    ...world,
    material: {
      ...world.material,
      incomeSources: [{
        id: "tax-1", kind: "tax", label: "Provincial tribute", beneficiaryAccountId: "marcus-purse",
        originKind: "polity", originId: "rome", amount, cadenceSteps: cadenceDays, nextDueStep: cadenceDays,
        collectionRateBps: 10_000, active: true,
      }],
      obligations: [],
    },
  };
}

function withUpkeep(world: WorldState, amount: number, cadenceDays: number): WorldState {
  return {
    ...world,
    material: {
      ...world.material,
      incomeSources: [],
      obligations: [{
        id: "pay-1", kind: "army_pay", label: "Legionary pay", payerAccountId: "marcus-purse",
        amount, cadenceSteps: cadenceDays, nextDueStep: cadenceDays, priority: 900, arrears: 0,
        missedPeriods: 0, active: true,
      }],
    },
  };
}

describe("revenue", () => {
  it("collects each period that fell inside the span", () => {
    const world = withIncome(base(), 100, 30);
    const opening = balance(world, "marcus-purse");
    const result = tick(world, 60);
    expect(balance(result.world, "marcus-purse")).toBe(opening + 200);
  });

  it("collects nothing before the first period is due", () => {
    const world = withIncome(base(), 100, 30);
    const opening = balance(world, "marcus-purse");
    expect(balance(tick(world, 29).world, "marcus-purse")).toBe(opening);
  });

  it("stays silent about routine revenue -- a treasury filling as expected is not history", () => {
    expect(tick(withIncome(base(), 100, 30), 60).factProposals).toHaveLength(0);
  });

  it("collects only the share the collection rate allows", () => {
    const world = withIncome(base(), 100, 30);
    const halved: WorldState = {
      ...world,
      material: { ...world.material, incomeSources: world.material.incomeSources.map((s) => ({ ...s, collectionRateBps: 5_000 })) },
    };
    const opening = balance(halved, "marcus-purse");
    expect(balance(tick(halved, 30).world, "marcus-purse")).toBe(opening + 50);
  });
});

describe("standing obligations", () => {
  it("pays what the treasury can cover", () => {
    const world = withUpkeep(base(), 100, 30);
    const opening = balance(world, "marcus-purse");
    const result = tick(world, 30);
    expect(balance(result.world, "marcus-purse")).toBe(opening - 100);
    expect(result.factProposals).toHaveLength(0);
  });

  it("accrues arrears and says so when it cannot", () => {
    // An unpaid army is emphatically history, unlike revenue that simply arrived.
    const world = withUpkeep(base(), 99_999, 30);
    const result = tick(world, 30);
    const obligation = result.world.material.obligations[0]!;

    expect(obligation.missedPeriods).toBe(1);
    expect(obligation.arrears).toBe(99_999);
    expect(result.factProposals[0]!.kind).toBe("obligation_unpaid");
  });

  it("weighs a longer default more heavily", () => {
    const world = withUpkeep(base(), 99_999, 30);
    const once = tick(world, 30).factProposals[0]!.significance;
    const thrice = tick(world, 90).factProposals[0]!.significance;
    expect(thrice).toBeGreaterThan(once);
  });

  it("does not run a pathological cadence thousands of times", () => {
    const world = withUpkeep(base(), 1, 1);
    const opening = balance(world, "marcus-purse");
    // Twenty years of daily pay, resolved in one span, must stay bounded.
    expect(opening - balance(tick(world, 7_300).world, "marcus-purse")).toBeLessThanOrEqual(24);
  });
});

describe("projects", () => {
  function withProject(world: WorldState, dueDays: readonly number[]): WorldState {
    return {
      ...world,
      projects: [{
        id: "project-1", kind: "recruitment", sponsorEntityRef: { kind: "polity", id: "rome" },
        label: "Two new legions", status: "in_progress", reservationId: null,
        milestones: dueDays.map((due, index) => ({
          id: `m${index + 1}`, label: `Milestone ${index + 1}`, requiredAtElapsedOffset: due,
          costAmount: 0, status: "pending" as const, linkedWorkflowId: null, linkedWorkflowParams: {}, completedAtStep: null,
        })),
        completionWorkflowId: null, completionWorkflowParams: {}, linkedEntityIds: [],
        startedAtStep: 0, targetCompletionStep: Math.max(...dueDays), completedAtStep: null, provenanceEventIds: [],
      }],
      material: { ...world.material, incomeSources: [], obligations: [] },
    };
  }

  it("completes a milestone whose day has arrived", () => {
    const result = tick(withProject(base(), [9, 60]), 30);
    expect(result.world.projects[0]!.milestones[0]!.status).toBe("completed");
    expect(result.world.projects[0]!.milestones[1]!.status).toBe("pending");
    expect(result.world.projects[0]!.status).toBe("in_progress");
  });

  it("leaves a milestone alone until its day", () => {
    expect(tick(withProject(base(), [9, 60]), 5).world.projects[0]!.milestones[0]!.status).toBe("pending");
  });

  it("finishes the project once the last milestone lands, and says so publicly", () => {
    // This is what makes "raise two legions" eventually produce legions rather
    // than scheduling them forever (VISION §17).
    const result = tick(withProject(base(), [9, 60]), 90);
    expect(result.world.projects[0]!.status).toBe("completed");
    expect(result.factProposals.map((proposal) => proposal.kind)).toContain("project_completed");
  });

  it("charges a milestone's cost to the project's sponsor", () => {
    const world = withProject(base(), [9]);
    const costed: WorldState = {
      ...world,
      projects: [{ ...world.projects[0]!, milestones: [{ ...world.projects[0]!.milestones[0]!, costAmount: 300 }] }],
      material: {
        ...world.material,
        accounts: [...world.material.accounts, { id: "rome-treasury", owner: { kind: "polity", id: "rome" }, currencyId: world.material.currency.id, balance: 1_000, status: "active", visibility: "polity" }],
      },
    };
    const result = tick(costed, 30);
    expect(balance(result.world, "rome-treasury")).toBe(700);
  });
});
