import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type Force, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * R01, R04, R05, R66: "Use the Roman navy to transport Legio I from Rome to Messana."
 *
 * The legion stood in Latium and the navy at Messana, more than a day's
 * gathering apart, and the crossing was refused four times with advice to
 * "order them nearer first" -- pointing at the Allied squadron that carries a
 * tenth of the legion. It is arranged now: the navy sails to the shore the
 * legion can walk to, the legion walks there, and it goes over in loads.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const { rome: ROME, messana: MESSANA } = PUNIC_IDS;

const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("arranged"),
  gameId: "game-arranged",
};

function world(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const hulls = opening.material.forces.find((force) => force.id === "allied-greek-hulls")!;
  const navy: Force = { ...hulls, id: "roman-navy", name: "Roman Navy", locationId: MESSANA, personnel: [{ categoryId: "warship", label: "Warships", fit: 150, unavailable: [] }] };
  return {
    ...opening,
    material: {
      ...opening.material,
      forces: [
        ...opening.material.forces.map((force): Force => force.id === "roman-field-army"
          ? { ...force, locationId: ROME, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 7_100, unavailable: [] }] }
          : force),
        navy,
      ],
    },
  };
}

const legion = (state: WorldState): Force => state.material.forces.find((force) => force.id === "roman-field-army")!;
const navy = (state: WorldState): Force => state.material.forces.find((force) => force.id === "roman-navy")!;

function runTo(state: WorldState, day: number): WorldState {
  let current = state;
  for (let at = current.instant.day + 5; at < day + 5; at += 5) {
    current = runDeterministicTick({ world: current, toDay: at, ids: createIdFactory(`tick-${at}`), warfare: definition.warfare }).world;
  }
  return current;
}

describe("a crossing that has to be arranged", () => {
  it("is arranged, not refused, when the named fleet lies far off", () => {
    const set = applyDeltas(world(), [{ op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, fleetRefs: ["roman-navy"], reason: "Carry Legio I to Messana." }], context);
    expect(set.rejected).toEqual([]);
    const crossing = set.world.projects.find((project) => project.kind === "crossing")!;
    expect(crossing.completionOutcome?.forceId).toBe("roman-field-army");
    expect(crossing.completionOutcome?.fleetIds).toEqual(["roman-navy"]);
    // The shore soonest reached from Rome and soonest left for Messana: a
    // coast the legion can walk to, not Rome itself.
    const shore = crossing.completionOutcome?.embarkProvinceId;
    expect(shore).toBeDefined();
    expect(shore).not.toBe(ROME);
    expect(crossing.milestones.at(-1)!.requiredAtElapsedOffset).toBeLessThan(60);
    // A march to the shore and a sailing to meet it, as real work.
    expect(set.world.projects.some((project) => project.kind === "march" && project.completionOutcome?.provinceId === shore)).toBe(true);
    expect(set.world.projects.some((project) => project.kind === "sailing" && project.completionOutcome?.forceId === "roman-navy")).toBe(true);
    // Its stages say what is actually going to happen.
    expect(crossing.milestones[0]!.label).toContain("Roman Navy");
    expect(set.factProposals.some((fact) => fact.kind === "crossing_arranged")).toBe(true);
  });

  it("chooses the fleet that can carry the legion over the nearer squadron that cannot", () => {
    const set = applyDeltas(world(), [{ op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, reason: "To Messana." }], context);
    expect(set.rejected).toEqual([]);
    expect(set.world.projects.find((project) => project.kind === "crossing")!.completionOutcome?.fleetIds).toContain("roman-navy");
  });

  it("is also what a project written for the crossing becomes", () => {
    const set = applyDeltas(world(), [{
      op: "project_create", localId: "transport", kind: "military_transport", label: "Bring the Roman Navy to Rome to embark Legio I",
      sponsorRef: { kind: "character", id: "gaius-genucius" }, fundingAccountRef: null,
      milestones: [{ label: "Sail to Rhegium and meet Legio I", dueInDays: 10, costAmount: 0 }],
      completionOutcome: { kind: "force_move", label: "Legio I at Messana", amount: 0, provinceId: MESSANA, polityId: null, commanderCharacterRef: null, forceRef: "roman-field-army", beneficiaryAccountRef: null, cadenceDays: null, agreementKind: null, withPolityId: null },
      reason: "Carry the legion over.",
    }], context);
    expect(set.rejected).toEqual([]);
    const crossing = set.world.projects.find((project) => project.id === set.assignedIds.get("transport"))!;
    expect(crossing.completionOutcome?.embarkProvinceId).toBeDefined();
    // Its stages are the engine's, not "sail to Rhegium" for a legion left in Rome.
    expect(crossing.milestones.map((milestone) => milestone.label).join(" ")).not.toContain("Sail to Rhegium");
  });

  it("lands the legion at Messana once both have come to the shore", () => {
    const set = applyDeltas(world(), [{ op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, fleetRefs: ["roman-navy"], reason: "Carry Legio I to Messana." }], context).world;
    const crossing = set.projects.find((project) => project.kind === "crossing")!;
    const due = crossing.milestones.at(-1)!.requiredAtElapsedOffset;
    const after = runTo(set, due + 20);
    expect(legion(after).locationId).toBe(MESSANA);
    expect(navy(after).locationId).toBe(MESSANA);
    expect(after.projects.find((project) => project.id === crossing.id)!.status).toBe("completed");
  });
});
