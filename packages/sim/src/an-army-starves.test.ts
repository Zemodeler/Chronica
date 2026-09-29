import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, openWar, type FactProposalDraft, type Force, type WorldState } from "@chronica/shared";
import { keepTheField, provisionStatusOn } from "./campaign";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Hold Agrigentum's country and wait for them."
 *
 * A legion could stand in enemy country for a year on the bread it set out
 * with: nothing ever ran its stores down, and a march ate nothing unless the
 * model remembered to write that it did. An army is fed now where the ground
 * feeds it, and where it does not it eats what it carries, goes short, and
 * starves.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const AGRIGENTUM = "ita-72843720b81376294924159-sicily-central";
const LATIUM = "punic-italy-latium";
/** Carthage's in the scenario, and nobody counted anybody living there. */
const EL_TARF = "dza-43142294b15861145285183";

function world(at: string, changes: Partial<Force> = {}): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return {
    ...opening,
    polityAgreements: openWar(opening.polityAgreements, { id: "war-carthage", polityId: "rome", otherPolityId: "carthage", terms: "Sicily.", atStep: 0, sourceMessageId: null, reason: "Messana." }),
    material: {
      ...opening.material,
      forces: opening.material.forces.map((force) => (force.id === "roman-field-army"
        ? { ...force, locationId: at, provisionedThroughStep: 10, reckonedToStep: 0, ...changes }
        : force)),
    },
  };
}

const legion = (state: WorldState): Force => state.material.forces.find((force) => force.id === "roman-field-army")!;
const fit = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const food = (state: WorldState, provinceId: string): number => state.material.provinceMaterial.find((row) => row.provinceId === provinceId)!.foodSecurityBps;

function run(state: WorldState, days: number, step = 5): { world: WorldState; facts: FactProposalDraft[] } {
  let current = state;
  const facts: FactProposalDraft[] = [];
  for (let day = step; day <= days; day += step) {
    const ticked = runDeterministicTick({ world: { ...current, elapsedStep: day, instant: { ...current.instant, day } }, toDay: day, ids: createIdFactory(`field-${day}`), warfare: definition.warfare });
    facts.push(...ticked.factProposals);
    current = ticked.world;
  }
  return { world: current, facts };
}

describe("an army in enemy country", () => {
  it("eats what it carries, goes short, and then starves", () => {
    const before = world(AGRIGENTUM);
    const shortly = run(before, 15);
    expect(legion(shortly.world).provisionStatus).toBe("shortage");
    expect(shortly.facts.some((fact) => fact.kind === "force_short")).toBe(true);

    const { world: after, facts } = run(before, 60);
    expect(legion(after).provisionStatus).toBe("critical");
    expect(fit(legion(after))).toBeLessThan(fit(legion(before)));
    expect(legion(after).moraleBps).toBeLessThan(legion(before).moraleBps);
    expect(facts.some((fact) => fact.kind === "force_starving" && /starving in Agrigentum/.test(fact.summary))).toBe(true);
    // Some died and some walked away, and the army's history says which.
    const hunger = legion(after).history.filter((event) => event.causeId.includes("hunger"));
    expect(hunger.some((event) => event.kind === "desertion")).toBe(true);
    expect(hunger.some((event) => event.kind === "attrition_death")).toBe(true);
  });

  it("feeds a small army off the country, and strips it doing so", () => {
    const small = world(AGRIGENTUM, { personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 1_000, unavailable: [] }] });
    const { world: after } = run(small, 30);
    expect(legion(after).provisionStatus).toBe("provisioned");
    expect(legion(after).provisionedThroughStep).toBeGreaterThan(30);
    expect(food(after, AGRIGENTUM)).toBeLessThan(food(small, AGRIGENTUM));
    // Enemy ground: foraging it is burning it.
    expect(after.material.provinceMaterial.find((row) => row.provinceId === AGRIGENTUM)!.warDamageBps).toBeGreaterThan(0);
  });
});

describe("an army at home", () => {
  it("is fed, and rests back into heart and order", () => {
    const tired = world(LATIUM, { moraleBps: 4_000, cohesionBps: 4_000, fatigueBps: 3_000 });
    const { world: after } = run(tired, 20);
    const rested = legion(after);
    expect(rested.provisionStatus).toBe("provisioned");
    expect(rested.moraleBps).toBeGreaterThan(4_000);
    expect(rested.cohesionBps).toBeGreaterThan(4_000);
    expect(rested.fatigueBps).toBe(0);
    // Never past what rest can give.
    expect(rested.moraleBps).toBeLessThanOrEqual(7_000);
  });

  it("rests faster in winter quarters", () => {
    const tired = world(LATIUM, { moraleBps: 4_000, cohesionBps: 4_000 });
    const summer = keepTheField({ world: { ...tired, elapsedStep: 10 }, toDay: 10, month: 7, warfare: definition.warfare }).world;
    const winter = keepTheField({ world: { ...tired, elapsedStep: 10 }, toDay: 10, month: 1, warfare: definition.warfare }).world;
    expect(legion(winter).moraleBps - 4_000).toBeGreaterThan(legion(summer).moraleBps - 4_000);
  });

  it("does not recover while its pay is owed", () => {
    const unpaid = world(LATIUM, { moraleBps: 4_000, payArrearsPeriods: 2 });
    const after = keepTheField({ world: { ...unpaid, elapsedStep: 10 }, toDay: 10, month: null, warfare: definition.warfare }).world;
    expect(legion(after).moraleBps).toBe(4_000);
  });
});

describe("ground nobody has reckoned", () => {
  it("neither feeds nor starves an army", () => {
    // Every province is counted now, townless or not; this is one war has
    // emptied of people, which feeds nobody and is not counted again.
    const placed = world(EL_TARF);
    const nowhere = { ...placed, material: { ...placed.material, provinceMaterial: placed.material.provinceMaterial.map((row) => (row.provinceId === EL_TARF ? { ...row, population: 0, availableManpower: 0, warDamageBps: 10_000 } : row)) } };
    const { world: after, facts } = run(nowhere, 60);
    expect(legion(after).provisionedThroughStep).toBe(10);
    expect(fit(legion(after))).toBe(fit(legion(nowhere)));
    expect(facts.some((fact) => fact.kind === "force_starving" || fact.kind === "force_short")).toBe(false);
  });

  it("is looked at once before it is reckoned", () => {
    const fresh = world(AGRIGENTUM, { reckonedToStep: undefined });
    const after = keepTheField({ world: fresh, toDay: 40, month: null, warfare: definition.warfare }).world;
    expect(legion(after).reckonedToStep).toBe(40);
    expect(fit(legion(after))).toBe(fit(legion(fresh)));
  });
});

describe("the bread it carries", () => {
  it("is plenty, then short, then starving, on dates", () => {
    expect(provisionStatusOn(30, 30)).toBe("provisioned");
    expect(provisionStatusOn(30, 35)).toBe("shortage");
    expect(provisionStatusOn(30, 41)).toBe("critical");
  });

  it("runs out sooner in the field in winter", () => {
    const hungry = world(AGRIGENTUM, { provisionedThroughStep: 40 });
    const summer = keepTheField({ world: hungry, toDay: 20, month: 7, warfare: definition.warfare }).world;
    const winter = keepTheField({ world: hungry, toDay: 20, month: 1, warfare: definition.warfare }).world;
    expect(legion(summer).provisionedThroughStep).toBe(40);
    expect(legion(winter).provisionedThroughStep).toBeLessThan(40);
  });
});

describe("a camp that sits still", () => {
  it("sickens, some summer, in its lines", () => {
    // Somewhere in a long hot summer, a big camp sickens: the roll is a
    // stable hash, so which fortnight is the same on every replay.
    let current = world(LATIUM, { personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 20_000, unavailable: [] }] });
    const facts: FactProposalDraft[] = [];
    for (let day = 15; day <= 720; day += 15) {
      const kept = keepTheField({ world: current, toDay: day, month: 7, warfare: definition.warfare });
      facts.push(...kept.facts);
      current = kept.world;
    }
    const sick = facts.filter((fact) => fact.kind === "camp_sickness");
    expect(sick.length).toBeGreaterThan(0);
    expect(sick[0]!.summary).toMatch(/summer heat/);
    expect(legion(current).history.some((event) => event.kind === "unavailable" && event.causeId.includes("camp-fever"))).toBe(true);
  });
});
