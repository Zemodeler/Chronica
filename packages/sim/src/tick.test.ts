import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
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
        collectionRateBps: 10_000, counterpartyPolityId: null, active: true,
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
          costAmount: 0, status: "pending" as const, completedAtStep: null,
        })),
        completionOutcome: null, linkedEntityIds: [],
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

describe("provinces over time", () => {
  it("gives every province a material state on the first tick, so an order can see the country", () => {
    const opening = base();
    expect(opening.material.provinceMaterial).toHaveLength(0);

    const ticked = runDeterministicTick({ world: opening, toDay: opening.instant.day, ids: createIdFactory("t") });
    expect(ticked.world.material.provinceMaterial).toHaveLength(opening.map.provinces.length);
    expect(ticked.world.material.provinceMaterial.every((material) => material.availableManpower >= 0)).toBe(true);
  });

  it("lets a burned province recover rather than staying burned forever", () => {
    const opening = runDeterministicTick({ world: base(), toDay: base().instant.day, ids: createIdFactory("t") }).world;
    const target = opening.map.provinces[0]!.id;
    const damaged: WorldState = {
      ...opening,
      material: {
        ...opening.material,
        provinceMaterial: opening.material.provinceMaterial.map((material) =>
          material.provinceId === target ? { ...material, warDamageBps: 6_000, lastMaterialUpdateStep: opening.elapsedStep } : material,
        ),
      },
    };

    const later = runDeterministicTick({ world: damaged, toDay: damaged.instant.day + 120, ids: createIdFactory("t2") }).world;
    const healed = later.material.provinceMaterial.find((material) => material.provinceId === target)!;
    expect(healed.warDamageBps).toBeLessThan(6_000);
  });

  it("says nothing about ordinary recovery, which is not history", () => {
    const opening = runDeterministicTick({ world: base(), toDay: base().instant.day, ids: createIdFactory("t") }).world;
    const later = runDeterministicTick({ world: opening, toDay: opening.instant.day + 30, ids: createIdFactory("t2") });
    expect(later.factProposals.some((fact) => fact.kind === "province_hunger" || fact.kind === "province_unrest")).toBe(false);
  });
});

describe("what a finished project leaves behind", () => {
  const projectWith = (outcome: WorldState["projects"][number]["completionOutcome"], state: WorldState): WorldState => ({
    ...state,
    projects: [
      {
        id: "naval-expansion",
        kind: "naval",
        sponsorEntityRef: { kind: "polity", id: "rome" },
        label: "Roman naval expansion",
        status: "in_progress",
        reservationId: null,
        milestones: [{ id: "m1", label: "Keels laid", requiredAtElapsedOffset: 5, costAmount: 0, status: "pending", completedAtStep: null }],
        completionOutcome: outcome,
        linkedEntityIds: [],
        startedAtStep: state.elapsedStep,
        targetCompletionStep: state.elapsedStep + 5,
        completedAtStep: null,
        provenanceEventIds: [],
      },
    ],
  });

  it("builds the fleet the project was for, and links it back to the project", () => {
    const state = base();
    const commander = state.characters.find((character) => character.alive && character.polityId === "rome")!;
    const province = state.map.provinces[0]!.id;
    const ready = projectWith(
      { kind: "force", label: "The new fleet", amount: 4_200, provinceId: province, polityId: "rome", commanderCharacterId: commander.id, forceId: null, beneficiaryAccountId: null, cadenceDays: null },
      state,
    );

    const result = tick(ready, state.instant.day + 10);
    const fleet = result.world.material.forces.find((force) => force.name === "The new fleet");
    expect(fleet).toBeDefined();
    expect(fleet!.personnel.reduce((sum, category) => sum + category.fit, 0)).toBe(4_200);
    expect(result.world.projects[0]!.status).toBe("completed");
    expect(result.world.projects[0]!.linkedEntityIds).toContain(fleet!.id);
    expect(result.factProposals.find((fact) => fact.kind === "project_completed")!.summary).toContain("The new fleet");
  });

  it("puts the army where the march was going, rather than completing and moving nobody", () => {
    // Found live: a forced march ran its milestones, reported itself complete,
    // and left the field army exactly where it had started.
    const state = base();
    const marching = state.material.forces[0]!;
    const destination = state.map.provinces.find((province) => province.id !== marching.locationId)!.id;
    const ready = projectWith(
      { kind: "force_move", label: "Forced march north", amount: 0, provinceId: destination, polityId: null, commanderCharacterId: null, forceId: marching.id, beneficiaryAccountId: null, cadenceDays: null },
      state,
    );

    const result = tick(ready, state.instant.day + 10);
    expect(result.world.material.forces.find((force) => force.id === marching.id)!.locationId).toBe(destination);
    expect(result.factProposals.find((fact) => fact.kind === "project_completed")!.summary).toContain("arrived");
  });

  it("produces nothing rather than an invalid world when the outcome names a dead man", () => {
    const state = base();
    const province = state.map.provinces[0]!.id;
    const ready = projectWith(
      { kind: "force", label: "A fleet under a ghost", amount: 900, provinceId: province, polityId: "rome", commanderCharacterId: "nobody-at-all", forceId: null, beneficiaryAccountId: null, cadenceDays: null },
      state,
    );

    const result = tick(ready, state.instant.day + 10);
    expect(result.world.material.forces.some((force) => force.name === "A fleet under a ghost")).toBe(false);
    // The effort still finished, and the record says so.
    expect(result.world.projects[0]!.status).toBe("completed");
    expect(result.factProposals.some((fact) => fact.kind === "project_completed")).toBe(true);
  });

  it("opens the revenue an arrangement was built to collect", () => {
    const state = base();
    const account = state.material.accounts[0]!.id;
    const ready = projectWith(
      { kind: "income_source", label: "Harbour dues at Ostia", amount: 45, provinceId: null, polityId: "rome", commanderCharacterId: null, forceId: null, beneficiaryAccountId: account, cadenceDays: 30 },
      state,
    );

    const result = tick(ready, state.instant.day + 10);
    const income = result.world.material.incomeSources.find((source) => source.label === "Harbour dues at Ostia");
    expect(income?.amount).toBe(45);
    expect(income?.cadenceSteps).toBe(30);
  });

  it("says so when a milestone was paid for with money that was not there", () => {
    const state = base();
    const poor: WorldState = {
      ...state,
      material: { ...state.material, accounts: state.material.accounts.map((account) => ({ ...account, balance: 0 })) },
      projects: [
        {
          id: "too-dear", kind: "naval", sponsorEntityRef: { kind: "polity", id: "rome" }, label: "A fleet beyond our means",
          status: "in_progress", reservationId: null,
          milestones: [{ id: "m1", label: "Timber bought", requiredAtElapsedOffset: 5, costAmount: 900, status: "pending", completedAtStep: null }],
          completionOutcome: null, linkedEntityIds: [], startedAtStep: state.elapsedStep,
          targetCompletionStep: state.elapsedStep + 5, completedAtStep: null, provenanceEventIds: [],
        },
      ],
    };

    const result = tick(poor, state.instant.day + 10);
    const shortfall = result.factProposals.find((fact) => fact.kind === "project_shortfall");
    expect(shortfall?.summary).toContain("900");
  });
});

describe("a debt that stops being paid", () => {
  const indebted = (): WorldState => {
    const state = base();
    return {
      ...state,
      material: {
        ...state.material,
        // Nothing to pay anyone with, so the servicing simply cannot be met.
        accounts: state.material.accounts.map((account) => ({ ...account, balance: 0 })),
        obligations: [
          {
            id: "service-1", kind: "debt_service", label: "Interest on merchant credit",
            payerAccountId: "marcus-purse", recipientAccountId: "hanno-purse", amount: 24,
            cadenceSteps: 30, nextDueStep: state.elapsedStep + 30, priority: 400, arrears: 0, missedPeriods: 0, active: true,
          },
        ],
        loans: [
          {
            id: "loan-1", lenderKind: "character", lenderId: "hanno", borrowerAccountId: "marcus-purse",
            principal: 300, outstanding: 300, interestBps: 800, cadenceSteps: 30,
            serviceObligationId: "service-1", terms: "Merchant credit against the coming harvest",
            collateralHoldingId: null, status: "active", openedAtStep: state.elapsedStep,
          },
        ],
      },
    };
  };

  it("falls into default once enough payments have been missed, and names the creditor", () => {
    const state = indebted();
    const result = tick(state, state.instant.day + 120);

    expect(result.world.material.loans[0]!.status).toBe("defaulted");
    const fact = result.factProposals.find((proposal) => proposal.kind === "loan_defaulted");
    expect(fact).toBeDefined();
    // The lender is a person, so the fact can wake them.
    expect(fact!.affectedRefs.some((ref) => ref.kind === "character" && ref.id === "hanno")).toBe(true);
    expect(result.world.material.obligations.find((o) => o.id === "service-1")!.active).toBe(false);
  });

  it("leaves a debt alone while it is still being paid", () => {
    const state = indebted();
    const solvent: WorldState = {
      ...state,
      material: { ...state.material, accounts: state.material.accounts.map((account) => ({ ...account, balance: 5_000 })) },
    };
    const result = tick(solvent, state.instant.day + 120);
    expect(result.world.material.loans[0]!.status).toBe("active");
    expect(result.factProposals.some((proposal) => proposal.kind === "loan_defaulted")).toBe(false);
  });
});

describe("an army that is not being paid", () => {
  const unpaid = (missed: number): WorldState => {
    const state = base();
    const force = state.material.forces[0]!;
    return {
      ...state,
      material: {
        ...state.material,
        accounts: state.material.accounts.map((account) => ({ ...account, balance: 0 })),
        obligations: [
          {
            id: "pay-1", kind: "army_pay", label: `Pay for ${force.name}`, payerAccountId: state.material.accounts[0]!.id,
            amount: 100, cadenceSteps: 30, nextDueStep: state.elapsedStep + 30, priority: 900,
            arrears: 0, missedPeriods: missed, active: true,
          },
        ],
        forces: state.material.forces.map((candidate) =>
          candidate.id === force.id ? { ...candidate, payObligationId: "pay-1", payArrearsPeriods: 0 } : candidate,
        ),
      },
    };
  };

  // The scenario's own rules, so the thresholds under test are the real ones.
  const warfare = { ...ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition).warfare, arrearsMoralePeriods: 1, arrearsDesertionPeriods: 3 };
  const run = (world: WorldState, toDay: number) => runDeterministicTick({ world, toDay, ids: createIdFactory("t"), warfare });

  it("costs an army its morale before it costs the state its men", () => {
    const state = unpaid(1);
    const before = state.material.forces[0]!;
    const result = run(state, state.instant.day + 1);
    const after = result.world.material.forces.find((force) => force.id === before.id)!;

    expect(after.moraleBps).toBeLessThan(before.moraleBps);
    expect(after.personnel.reduce((sum, c) => sum + c.fit, 0)).toBe(before.personnel.reduce((sum, c) => sum + c.fit, 0));
    expect(result.factProposals.some((fact) => fact.kind === "force_unpaid")).toBe(true);
  });

  it("loses men once the wages have been owed long enough", () => {
    const state = unpaid(4);
    const before = state.material.forces[0]!;
    const result = run(state, state.instant.day + 1);
    const after = result.world.material.forces.find((force) => force.id === before.id)!;

    expect(after.personnel.reduce((sum, c) => sum + c.fit, 0)).toBeLessThan(before.personnel.reduce((sum, c) => sum + c.fit, 0));
    expect(after.authorizedStrength).toBe(after.personnel.reduce((sum, c) => sum + c.fit, 0));
    const desertion = result.factProposals.find((fact) => fact.kind === "force_desertion");
    expect(desertion?.significance).toBe(70);
  });

  it("leaves an army that is being paid entirely alone", () => {
    const state = unpaid(0);
    const before = state.material.forces[0]!;
    const result = run(state, state.instant.day + 1);
    const after = result.world.material.forces.find((force) => force.id === before.id)!;
    expect(after.moraleBps).toBe(before.moraleBps);
    expect(result.factProposals.some((fact) => fact.kind === "force_desertion" || fact.kind === "force_unpaid")).toBe(false);
  });
});
