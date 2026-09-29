import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import {
  GenericEntitySchema,
  MechanicEffectSchema,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  mechanicWorth,
  type MechanicDraft,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "../ports";
import { attachMechanic } from "./attach-mechanic";
import { newDebitLedger } from "./instantiate";
import { readableRefsFor } from "./refs";
import { runMechanics } from "./run-mechanics";
import { validateMechanic } from "./validate-mechanic";

/**
 * A rule that drills the army, and one that fills a province.
 *
 * A mechanic had five things it could do and none of them reached an army or
 * the people of a place: "drill the garrison every month" and "settle
 * colonists here each year" were arrangements that did nothing. Now a rule may
 * move its province's people, and the morale, cohesion or numbers of an army
 * -- one its owner commands, and only while he does. It may wear men away;
 * it may not raise them. It may not move ground at all.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices = definition.government.offices;
const warfare = definition.warfare;
const MARCUS = { kind: "character" as const, id: "marcus-atilius" };
const NORTHEAST = "ita-72843720b81376294924159-sicily-northeast";

/** Marcus's arrangement in north-eastern Sicily, and an army there he commands. */
function camp(commander = MARCUS.id): WorldState {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld)), 0);
  const force = world.material.forces[0]!;
  const entity = GenericEntitySchema.parse({
    id: "drill", kind: "drill_ground", label: "The drill ground", ownerRef: MARCUS, attributes: {}, linkedEntityIds: [], createdAtStep: 0, provenanceEventIds: [],
    provinceId: NORTHEAST, effects: [], upkeep: null,
  });
  return {
    ...world,
    genericEntities: [...world.genericEntities, entity],
    material: { ...world.material, forces: world.material.forces.map((candidate) => (candidate.id === force.id ? { ...candidate, locationId: NORTHEAST, positionId: null, commanderCharacterId: commander, controllerCharacterId: commander, moraleBps: 5_000 } : candidate)) },
  };
}

const drill = (forceId: string, quantity: "morale" | "cohesion" | "men" = "morale", direction: "raise" | "lower" = "raise"): MechanicDraft => ({
  trigger: { kind: "monthly" }, conditions: [],
  effects: [{ op: "force_shift", forceId, quantity, direction, band: "great" }, { op: "province_material_shift", provinceId: NORTHEAST, quantity: "population", direction: "raise", band: "marked" }],
  end: { kind: "never" }, price: { setup: 20, upkeepPerMonth: 1 }, why: "The men drill, and the camp draws settlers.",
});

function attach(world: WorldState, draft: MechanicDraft) {
  const entity = world.genericEntities.find((candidate) => candidate.id === "drill")!;
  const refs = readableRefsFor(world, MARCUS, entity);
  const checked = validateMechanic(draft, world, refs, offices);
  if (!checked.ok) return { checked, world };
  const out = attachMechanic({ world, entity, draft: checked.draft, origin: "written", warrants: checked.warrants, refs, ids: createIdFactory("attach"), offices, warfare, gameId: "g" });
  if (!out.ok) throw new Error(out.reason);
  return { checked, world: out.world };
}

const run = (world: WorldState, toDay: number) => runMechanics({
  world, toDay, ids: createIdFactory("run"), recentFacts: [], ledger: newDebitLedger(world),
  apply: { offices, warfare, gameId: "g", playerCharacterId: MARCUS.id },
});

describe("a rule drills the army", () => {
  it("raises the spirits of an army its owner commands, and the people of its province", () => {
    const world = camp();
    const forceId = world.material.forces[0]!.id;
    const { world: ruled } = attach(world, drill(forceId));
    const people = ruled.material.provinceMaterial.find((row) => row.provinceId === NORTHEAST)!.population;
    const fired = run(ruled, ruled.instant.day + 31);
    expect(fired.fired).toBe(1);
    expect(fired.world.material.forces.find((force) => force.id === forceId)!.moraleBps).toBe(5_000 + mechanicWorth.forceBps.great);
    expect(fired.world.material.provinceMaterial.find((row) => row.provinceId === NORTHEAST)!.population).toBe(people + Math.round(people * mechanicWorth.populationShare.marked));
  });

  it("wears men away, and never raises them", () => {
    const world = camp();
    const forceId = world.material.forces[0]!.id;
    const fit = (state: WorldState) => state.material.forces.find((force) => force.id === forceId)!.personnel.reduce((sum, group) => sum + group.fit, 0);
    const { world: ruled } = attach(world, drill(forceId, "men", "lower"));
    expect(fit(run(ruled, ruled.instant.day + 31).world)).toBeLessThan(fit(world));
    const raising = attach(world, drill(forceId, "men", "raise"));
    expect(raising.checked.ok).toBe(false);
  });

  it("leaves alone an army its owner does not command -- and stops when he gives it up", () => {
    const theirs = camp("hanno");
    const forceId = theirs.material.forces[0]!.id;
    const { checked } = attach(theirs, drill(forceId));
    // The army is dropped from the rule; the settlers stay.
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.draft.effects.map((effect) => effect.op)).toEqual(["province_material_shift"]);

    const { world: ruled } = attach(camp(), drill(forceId));
    const handedOver: WorldState = { ...ruled, material: { ...ruled.material, forces: ruled.material.forces.map((force) => (force.id === forceId ? { ...force, commanderCharacterId: "hanno", controllerCharacterId: "hanno" } : force)) } };
    const fired = run(handedOver, handedOver.instant.day + 31);
    expect(fired.world.material.forces.find((force) => force.id === forceId)!.moraleBps).toBe(5_000);
  });

  it("has no effect that moves ground", () => {
    const ops = MechanicEffectSchema.options.map((option) => option.shape.op.value);
    expect(ops).not.toContain("province_control_set");
    expect(ops).not.toContain("settlement_control_set");
  });
});
