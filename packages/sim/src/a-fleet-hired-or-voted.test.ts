import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, passageFor, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { holdVotes } from "./senate";
import { runDeterministicTick } from "./tick";

/**
 * "Find mercenaries and boats enough to carry 10000 men" hired a Campanian
 * shipmaster and not one hull; the Senate voted a fleet 119 to 0 and not a keel
 * was laid; a project that was to build ships would have raised infantry; and
 * the consul was told only that no fleet stood with his legion, never that
 * eighteen hulls lay two provinces off. Each is a way a fleet now comes to be.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const opening = (): WorldState => {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  // The house wanting nothing in particular, so the count is the dispositions alone.
  return { ...world, material: { ...world.material, institutions: world.material.institutions.map((institution) => ({ ...institution, votingBlocs: institution.votingBlocs.map((bloc) => ({ ...bloc, interests: [] })) })) } };
};
const as = (actor: string, written: readonly unknown[], state: WorldState = opening()) => {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: state.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: actor }, offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`fleet-${actor}`), gameId: "game-fleet", orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
};
const tickTo = (state: WorldState, day: number) =>
  runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`fleet-tick-${day}`), warfare: definition.warfare });
const SICILY = PUNIC_IDS.messana;
const army = (state: WorldState) => state.material.forces.find((force) => force.id === "roman-field-army")!;
const balance = (state: WorldState, id: string) => state.material.accounts.find((account) => account.id === id)!.balance;

describe("a fleet hired", () => {
  it("brings the hulls the captain was hired for, under whoever hired him, and they carry the legion", () => {
    const hired = as("gaius-genucius", [{
      op: "service_contract_open", localId: "ships", role: "mercenary", label: "Campanian transports", employerAccountRef: "rome-treasury",
      employeeRef: "quintus-ogulnius", advance: 10, monthlyPay: 700, termDays: 365, duties: "Carry the legion to Sicily.",
      company: { categoryId: "warship", strength: 300 }, provinceId: army(opening()).locationId, reason: "The legion must cross.",
    }]);
    expect(hired.rejected).toEqual([]);
    const contract = hired.world.material.contracts[0]!;
    const fleet = hired.world.material.forces.find((force) => force.id === contract.forceId)!;
    expect(fleet).toMatchObject({ polityId: "rome", commanderCharacterId: "quintus-ogulnius", controllerCharacterId: "gaius-genucius", payObligationId: contract.obligationId });
    expect(fleet.personnel).toEqual([expect.objectContaining({ categoryId: "warship", fit: 300 })]);
    expect(WorldStateSchema.safeParse(hired.world).success).toBe(true);
    expect(passageFor(hired.world, army(hired.world), SICILY, definition.warfare).by).toBe("sea");
  });

  it("will not hire a captain who brings nothing", () => {
    const refused = as("gaius-genucius", [{
      op: "service_contract_open", localId: "ships", role: "mercenary", label: "A shipmaster", employerAccountRef: "rome-treasury",
      employeeRef: "quintus-ogulnius", monthlyPay: 100, duties: "Find boats.", reason: "The legion must cross.",
    }]);
    expect(refused.rejected[0]?.reason).toMatch(/"company"/);
  });

  it("says, when the legion cannot cross, what ships its power has and what they carry", () => {
    const refused = passageFor(opening(), army(opening()), SICILY, definition.warfare);
    expect(refused.by).toBeNull();
    expect(refused.by === null && refused.reason).toMatch(/Allied Greek hulls, lie in .* and carry 540/);
  });
});

describe("a fleet built", () => {
  const build = (state: WorldState, fundedBy: string) => as("gaius-genucius", [{
    op: "project_create", localId: "keels", kind: "shipbuilding", label: "A Roman fleet", sponsorRef: { kind: "character", id: "gaius-genucius" },
    fundingAccountRef: fundedBy, milestones: [{ label: "Keels laid", dueInDays: 10, costAmount: 100 }],
    completionOutcome: { kind: "force", label: "The Roman fleet", amount: 120, provinceId: army(state).locationId, polityId: "rome", commanderCharacterRef: "gaius-genucius", categoryId: "warship" },
    reason: "Rome needs ships.",
  }], state);

  it("launches ships, not foot soldiers, and is paid for from the chest that was named", () => {
    const begun = build(opening(), "rome-treasury");
    expect(begun.rejected).toEqual([]);
    const purse = begun.world.characters.find((character) => character.id === "gaius-genucius")!.personalAccountId;
    const done = tickTo(begun.world, 10).world;
    const fleet = done.material.forces.find((force) => force.name === "The Roman fleet")!;
    expect(fleet.personnel).toEqual([expect.objectContaining({ categoryId: "warship", fit: 120 })]);
    // What the consul's hand makes of 100 is his; that the treasury pays it, and not his purse, is the point.
    const cost = begun.world.projects[0]!.milestones[0]!.costAmount;
    expect(cost).toBeGreaterThan(0);
    expect(balance(done, "rome-treasury")).toBe(balance(begun.world, "rome-treasury") - cost);
    expect(balance(done, purse)).toBe(balance(begun.world, purse));
  });

  it("refuses a kind of troops the world does not have", () => {
    const state = opening();
    const refused = as("gaius-genucius", [{
      op: "project_create", localId: "keels", kind: "shipbuilding", label: "A fleet", sponsorRef: { kind: "character", id: "gaius-genucius" },
      fundingAccountRef: "rome-treasury", milestones: [{ label: "Keels", dueInDays: 10 }],
      completionOutcome: { kind: "force", label: "Fleet", amount: 10, provinceId: army(state).locationId, polityId: "rome", commanderCharacterRef: "gaius-genucius", categoryId: "trireme" },
      reason: "Ships.",
    }], state);
    expect(refused.rejected[0]?.reason).toMatch(/No kind of troops "trireme"/);
  });
});

describe("a fleet voted", () => {
  const putToTheSenate = () => {
    const state = opening();
    const opened = as("gaius-genucius", [{
      op: "political_procedure_open", localId: "fleet", type: "council_deliberation", institutionRef: "roman-senate", sponsorCharacterRef: "gaius-genucius",
      subjectKind: "polity", subjectRef: "rome", label: "Whether Rome should build a fleet", resolutionMechanism: "vote", deadlineInDays: 30,
      enacts: { project: {
        kind: "shipbuilding", label: "The Senate's fleet", fundingAccountRef: "rome-treasury", milestones: [{ label: "Keels laid", dueInDays: 20, costAmount: 50 }],
        completionOutcome: { kind: "force", label: "The Senate's fleet", amount: 100, provinceId: army(state).locationId, polityId: "rome", commanderCharacterRef: "gaius-genucius", categoryId: "warship" },
      } },
      reason: "The strait.",
    }], state);
    expect(opened.rejected).toEqual([]);
    return { world: opened.world, id: opened.assignedIds.get("fleet")! };
  };
  const work = (state: WorldState) => state.projects.find((project) => project.label === "The Senate's fleet")!;

  it("waits on the vote, begins the day it is carried, and launches the ships", () => {
    const { world, id } = putToTheSenate();
    expect(work(world).status).toBe("proposed");
    // Nothing is built, and nothing paid, before the vote.
    expect(tickTo(world, 25).world.projects.find((project) => project.id === work(world).id)!.milestones[0]!.status).toBe("pending");

    const counted = holdVotes({ world: { ...world, elapsedStep: 30 }, offices, toDay: 30, ids: createIdFactory("count") });
    expect(counted.world.material.politicalProcedures.find((procedure) => procedure.id === id)!.outcome).toBe("passed");
    expect(work(counted.world)).toMatchObject({ status: "in_progress", startedAtStep: 30 });
    expect(counted.facts.some((fact) => fact.kind === "law_enacted" && fact.summary.includes("The Senate's fleet is begun"))).toBe(true);

    const launched = tickTo(counted.world, 50).world;
    expect(launched.material.forces.find((force) => force.name === "The Senate's fleet")?.personnel[0]?.categoryId).toBe("warship");
  });

  it("goes with the measure when the measure fails", () => {
    const { world, id } = putToTheSenate();
    const failed = { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((procedure) => (procedure.id === id ? { ...procedure, stage: "resolved" as const, outcome: "failed" as const, resolvedAtStep: 30 } : procedure)) } };
    expect(work(tickTo(failed, 31).world).status).toBe("cancelled");
  });
});
