import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, FIRST_PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { runSimulationBurst } from "./burst";
import { groundOfForce } from "./force-ground";
import type { SimModelPort } from "./ports";

/**
 * A fact may name where an army is going (E29).
 *
 * A province named beside an army is checked against the army's ground, so the
 * record cannot put a fleet in Sicily while it lies off Africa. The ground was
 * where the army stood and where it stood before the answer moved it, and a
 * march takes days: "the army marches on Messana", written the day it set
 * out, lost Messana every turn of the play-test.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

describe("an army's ground", () => {
  it("is where it stands, where it marches, the shore it takes ship from, its battle and its siege", () => {
    const state = world();
    const force = state.material.forces[0]!;
    const project = {
      id: "march-1", kind: "march", label: "The march", sponsorEntityRef: { kind: "polity", id: force.polityId }, overseerCharacterId: null, linkedEntityIds: [],
      status: "in_progress", startedAtStep: 0, milestones: [], fundingAccountId: null, reservationId: null,
      completionOutcome: { kind: "force_move", label: "Arrives", amount: 0, provinceId: "far-shore", polityId: null, commanderCharacterId: null, forceId: force.id, embarkProvinceId: "the-port", beneficiaryAccountId: null, cadenceDays: null, agreementKind: null, withPolityId: null },
    } as unknown as WorldState["projects"][number];
    const marching: WorldState = { ...state, projects: [...state.projects, project] };
    const ground = groundOfForce(marching, force.id);
    expect(ground).toContain(force.locationId);
    expect(ground).toContain("far-shore");
    expect(ground).toContain("the-port");
    // A march that is over is no longer ground.
    expect(groundOfForce({ ...marching, projects: [...state.projects, { ...project, status: "completed" }] }, force.id)).not.toContain("far-shore");
  });

  it("keeps the place an army is marching to in the fact that says so", async () => {
    const order = JSON.stringify({
      intent: { summary: "Watch the coast.", domains: ["military"] }, narrativeSummary: "The consul watches the coast.",
      deltas: [], facts: [], outcome: "continue",
    });
    const march = JSON.stringify({
      actors: [{
        actorRef: { kind: "character", id: "hanno" },
        reasoning: "The army moves.",
        proposal: {
          narrativeSummary: "The army marches across the island.",
          deltas: [{ op: "force_modify", forceRef: "carthaginian-army", locationId: FIRST_PUNIC_IDS.messana, reason: "The march across the island." }],
          facts: [{
            localId: "marching", kind: "march_begun", summary: "The Carthaginian army marches on Messana.",
            affectedRefs: [{ kind: "force", id: "carthaginian-army" }, { kind: "province", id: FIRST_PUNIC_IDS.messana }],
            visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 50,
          }],
        },
      }],
    });
    let cognition = 0;
    const port: SimModelPort = {
      complete(operation) {
        if (operation === "simulate_orchestrate") return Promise.resolve(order);
        if (operation === "simulate_cognition") return Promise.resolve((cognition += 1) === 1 ? march : JSON.stringify({ actors: [] }));
        return Promise.resolve("{}");
      },
    };
    const before = world().material.forces.find((force) => force.id === "carthaginian-army")!.locationId;
    expect(before).not.toBe(FIRST_PUNIC_IDS.messana);
    const result = await runSimulationBurst({
      world: world(), clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: "march", gameId: "a-march-named", actorRef: { kind: "character", id: "marcus-atilius" }, actorPolityId: "rome",
      orderText: "Watch the coast.", spanDays: 1, knownFacts: [], queue: [], port, narratorSeeds: [],
    });
    const told = result.newFacts.find((fact) => fact.summary === "The Carthaginian army marches on Messana.");
    expect(told).toBeDefined();
    expect(told!.affectedEntities.map((entity) => entity.id)).toContain(FIRST_PUNIC_IDS.messana);
    expect(result.skipped.some((entry) => entry.stage === "fact_places")).toBe(false);
  });
});
