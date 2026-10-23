import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * "...Then march on Messana" (a playtest, round 5): the march was written as a held act of its own part, and the part had nothing
 * earlier to wait on. The held march then waited on the one thing it could find, the force's arrival at Messana, which is the march's
 * own result: "Still waiting for Carthaginian field force never reached ... Messana (16 days) before 'Then march on Messana' can go
 * ahead. It lapses on day 90; your word?" -- an order that could only fail.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

describe("a march held for later", () => {
  it("does not wait for its own arrival, and goes when it has nothing else to wait for", async () => {
    const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const march = { op: "project_create", localId: "march-south", kind: "march", label: "Roman field army marches on Rhegium", sponsorRef: { kind: "character", id: "gaius-genucius" }, fundingAccountRef: null,
      milestones: [{ label: "Arrives at Rhegium", dueInDays: 20, costAmount: 0 }], completionOutcome: { kind: "force_move", label: "Arrives", forceRef: army.id, provinceId: PUNIC_IDS.rhegium }, reason: "March south." };
    const answer = {
      narrativeSummary: "The army will march.", facts: [], delegations: [], schedule: [], cognitionCandidates: [], frictions: [], outcome: "continue", playerDecision: null, deltas: [],
      intent: { summary: "Then march.", domains: ["military"], parts: [{ said: "Then march on Rhegium", acts: [], deferredActs: [march], spend: null, factLocalIds: [], whyNot: null }] },
    };
    const port: SimModelPort = { complete(operation) { return Promise.resolve(JSON.stringify(operation === "simulate_orchestrate" ? answer : { actors: [] })); } };
    const result = await runSimulationBurst({ world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "march-for-nothing", gameId: "test",
      actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome", orderText: "Then march on Rhegium", knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1 });
    const part = result.world.orders.find((order) => order.id === result.orderRecordId)!.parts[0]!;
    // The march has nothing earlier to wait on, so it is an act of its part and is done: the force is marching, not waiting for itself.
    expect(part.stages.some((stage) => stage.waitsOn.some((condition) => condition.kind === "force_at" && condition.forceId === army.id && condition.provinceId === PUNIC_IDS.rhegium))).toBe(false);
    expect(result.world.projects.some((project) => /marches on Rhegium/.test(project.label))).toBe(true);
  });
});
