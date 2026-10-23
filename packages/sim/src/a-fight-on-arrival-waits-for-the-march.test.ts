import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";

/**
 * "March on the Messapians and attack them" in one breath (docs/reports/consul-run-issues.md, M12): the answer wrote the
 * march as a project and the fight as a held act of the same part. With no earlier part to wait on, the held fight was
 * dropped, and the army arrived to stand beside the enemy, "neither ordered to attack".
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

describe("a fight on arrival", () => {
  it("is held until the army it rides with has marched there", async () => {
    const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const enemy = world.material.forces.find((force) => force.id === "campanian-legion")!;
    expect(army.locationId).not.toBe(enemy.locationId);
    const engage = { op: "force_engage", forceRef: army.id, targetForceRef: enemy.id, posture: "offer_battle", tactic: null, reason: "On arrival, attack." };
    const answer = {
      narrativeSummary: "The army marches south to fight.", facts: [], delegations: [], schedule: [], cognitionCandidates: [], frictions: [], outcome: "continue", playerDecision: null,
      deltas: [{ op: "project_create", localId: "march-south", kind: "march", label: "Roman field army marches on Rhegium", sponsorRef: { kind: "character", id: "gaius-genucius" }, fundingAccountRef: null,
        milestones: [{ label: "Arrives at Rhegium", dueInDays: 20, costAmount: 0 }], completionOutcome: { kind: "force_move", label: "Arrives", forceRef: army.id, provinceId: PUNIC_IDS.rhegium }, reason: "March south." }],
      intent: { summary: "March and fight.", domains: ["military"], parts: [{ said: "March the field army on the Campanian legion and attack it", acts: [0], goals: [{ kind: "force_at", ref: army.id, at: PUNIC_IDS.rhegium, amount: null }], deferredActs: [engage], spend: null, factLocalIds: [], whyNot: null }] },
    };
    const port: SimModelPort = { complete(operation) { return Promise.resolve(JSON.stringify(operation === "simulate_orchestrate" ? answer : { actors: [] })); } };
    const result = await runSimulationBurst({ world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "fight-on-arrival", gameId: "test",
      actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome", orderText: "March the field army on the Campanian legion and attack it", knownFacts: [], queue: [], port, narratorSeeds: [], spanDays: 1 });
    const part = result.world.orders.find((order) => order.id === result.orderRecordId)!.parts[0]!;
    const held = part.stages.find((stage) => stage.held.op === "force_engage");
    expect(held?.status).toBe("waiting");
    expect(held?.waitsOn).toContainEqual({ kind: "force_at", forceId: army.id, provinceId: PUNIC_IDS.rhegium });
  });
});
