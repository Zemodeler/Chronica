import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type FactProposalDraft, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Continue the siege of Messana."
 *
 * A legion sat before Messana for two months and the consul heard nothing:
 * the siege was a sentence, and nothing in the world was pressing the city.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = PUNIC_IDS.messana;
const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("siege"),
  gameId: "game-siege",
};

/** Legio I before Messana; the Syracusans elsewhere, so the Mamertines hold it alone. */
function before(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return {
    ...opening,
    material: {
      ...opening.material,
      forces: opening.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: MESSANA } : force)),
    },
  };
}

const WAR: WorldDelta = {
  op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "mamertines",
  terms: "War over Messana.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "They refused to surrender.",
};
const LAY: WorldDelta = { op: "siege_lay", localId: "messana", forceRef: "roman-field-army", settlementId: "settlement-messana", reason: "Invest the city." };

function run(state: WorldState, days: number): { world: WorldState; facts: FactProposalDraft[] } {
  let world = state;
  const facts: FactProposalDraft[] = [];
  for (let day = 5; day <= days; day += 5) {
    const ticked = runDeterministicTick({ world: { ...world, elapsedStep: day, instant: { ...world.instant, day } }, toDay: day, ids: createIdFactory(`siege-${day}`), warfare: definition.warfare });
    facts.push(...ticked.factProposals);
    world = ticked.world;
  }
  return { world, facts };
}

describe("the siege of Messana", () => {
  it("is refused to a power not at war with the city", () => {
    const refused = applyDeltas(before(), [LAY], context);
    expect(refused.rejected[0]?.reason).toMatch(/not at war/);
    expect(refused.world.sieges).toHaveLength(0);
  });

  it("is laid by an army standing before it, and said", () => {
    const laid = applyDeltas(before(), [WAR, LAY], context);
    expect(laid.rejected.map((rejection) => rejection.reason)).toEqual([]);
    expect(laid.world.sieges).toHaveLength(1);
    expect(laid.factProposals.some((fact) => fact.kind === "siege_laid")).toBe(true);
    // Laid twice is the same siege.
    expect(applyDeltas(laid.world, [LAY], context).world.sieges).toHaveLength(1);
  });

  it("is reported every fortnight, and the garrison starves", () => {
    const laid = applyDeltas(before(), [WAR, LAY], context).world;
    const garrisonAt = (state: WorldState) => state.material.forces.find((force) => force.id === "mamertine-garrison")?.personnel.reduce((sum, group) => sum + group.fit, 0) ?? 0;
    const { world, facts } = run(laid, 45);
    const reports = facts.filter((fact) => fact.kind === "siege_progress");
    expect(reports.length).toBeGreaterThanOrEqual(2);
    expect(reports[0]!.summary).toMatch(/siege of Messana/);
    expect(garrisonAt(world)).toBeLessThan(garrisonAt(laid));
    expect(world.sieges[0]!.pressureBps).toBeGreaterThan(0);
  });

  it("ends with the city opening its gates, and the province Rome's", () => {
    const laid = applyDeltas(before(), [WAR, LAY], context).world;
    const { world, facts } = run(laid, 400);
    expect(world.sieges[0]!.status).toBe("taken");
    expect(facts.some((fact) => fact.kind === "siege_ended" && /opened its gates/.test(fact.summary))).toBe(true);
    const province = world.map.provinces.find((candidate) => candidate.id === MESSANA)!;
    expect(province.settlements.find((city) => city.id === "settlement-messana")!.controllerPolityId).toBe("rome");
    expect(province.controllerPolityId).toBe("rome");
    expect(world.material.forces.some((force) => force.id === "mamertine-garrison")).toBe(false);
  });

  it("is raised when the army marches away", () => {
    const laid = applyDeltas(before(), [WAR, LAY], context).world;
    const gone: WorldState = { ...laid, material: { ...laid.material, forces: laid.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: PUNIC_IDS.rhegium } : force)) } };
    const { world, facts } = run(gone, 10);
    expect(world.sieges[0]!.status).toBe("lifted");
    expect(facts.some((fact) => fact.kind === "siege_lifted")).toBe(true);
  });
});
