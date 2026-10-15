import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, adjacentTo, ensureProvinceMaterial, retreatRoute, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { pursuitLosses } from "./engagements";
import { createIdFactory } from "./ports";

/**
 * A small army can be caught (docs/reports/consul-run-issues.md, H3). In the consul run the Campanian legion, 2,700 men and
 * then 850, fell back from 17,000 Romans six times and left its camp by night three more, a year in all: the withdrawal of the
 * outnumbered came before any storm of its camp, cost it nothing, and could step straight onto another Roman army.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = PUNIC_IDS.rome;
const fitOf = (world: WorldState, id: string): number => world.material.forces.find((force) => force.id === id)!.personnel.reduce((sum, group) => sum + group.fit, 0);
const where = (world: WorldState, id: string): string => world.material.forces.find((force) => force.id === id)!.locationId;

function as(actor: string, written: readonly unknown[], state: WorldState) {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: state.elapsedStep, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`caught-${actor}-${state.elapsedStep}`), gameId: "game-caught", orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
}

/** Six hundred Syracusans brought beside the consul's army in Latium, the two powers at war. */
function outnumbered(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const moved: WorldState = {
    ...opening,
    material: { ...opening.material, forces: opening.material.forces.map((force) => (force.id !== "syracusan-army" ? force
      : { ...force, locationId: LATIUM, personnel: [{ ...force.personnel[0]!, fit: 600 }], authorizedStrength: 600 })) },
  };
  return as("gaius-genucius", [{ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "syracuse", terms: "War over Messana.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Messana." }], moved).world;
}

const attack = (state: WorldState, manoeuvre?: string) => as("gaius-genucius", [{
  op: "force_engage", forceRef: "roman-field-army", targetForceRef: "syracusan-army", posture: "offer_battle", tactic: null, ...(manoeuvre === undefined ? {} : { manoeuvre }), reason: "Bring them to battle.",
}], state);

describe("an army outnumbered three to one", () => {
  it("pays for its withdrawal in men cut down by the pursuit", () => {
    const fled = attack(outnumbered()).world;
    expect(where(fled, "syracusan-army")).not.toBe(LATIUM);
    expect(fitOf(fled, "syracusan-army")).toBeLessThan(600);
    expect(fled.engagements.find((engagement) => engagement.openedByForceId === "roman-field-army")?.endedBy).toBe("withdrew");
  });

  it("is caught when its camp is stormed that day, and must fight", () => {
    const stormed = attack(outnumbered(), "storm_camp").world;
    const engagement = stormed.engagements.find((candidate) => candidate.openedByForceId === "roman-field-army");
    expect(engagement?.endedBy).not.toBe("withdrew");
    // A battle was fought: the Syracusans lost men on the field, not only to a pursuit.
    expect(fitOf(stormed, "syracusan-army")).toBeLessThan(600 * (1 - pursuitLosses(3, 0)));
  });

  it("has no road away when every road leads onto an enemy army", () => {
    const world = outnumbered();
    const roman = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const blocked: WorldState = {
      ...world,
      material: { ...world.material, forces: [...world.material.forces, ...adjacentTo(world, LATIUM).map((next, index) => ({ ...roman, id: `blocking-${index}`, name: `Blocking column ${index}`, locationId: next.provinceId }))] },
    };
    const syracusans = blocked.material.forces.find((force) => force.id === "syracusan-army")!;
    expect(retreatRoute(blocked, syracusans, LATIUM, new Set(["rome"]))).toBeNull();
    expect(retreatRoute(world, syracusans, LATIUM, new Set(["rome"]))).not.toBeNull();
  });

  it("loses a few in a hundred at even odds, more at worse odds and against horse, never more than an eighth", () => {
    expect(pursuitLosses(1, 0)).toBeCloseTo(0.02);
    expect(pursuitLosses(5, 0)).toBeGreaterThan(pursuitLosses(3, 0));
    expect(pursuitLosses(3, 0.5)).toBeGreaterThan(pursuitLosses(3, 0));
    expect(pursuitLosses(40, 1)).toBe(0.12);
  });
});
