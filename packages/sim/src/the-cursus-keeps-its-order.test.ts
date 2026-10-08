import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, admissionRefusal, allOffices, ScenarioDefinitionSchema, type Character, type WorldState } from "@chronica/shared";

/**
 * The ladder was custom in 270 (the lex Villia annalis is of 180 BCE, later): the quaestorship at about thirty, a year's rest between offices, no step back
 * down (praetor then aedile) and no leap from the quaestorship to the consulship.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = allOffices({}, definition.government.offices);
const office = (id: string) => offices.find((candidate) => candidate.id === id)!;
const base: WorldState = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const template = base.characters.find((character) => character.polityId === "rome" && character.alive && character.officeId === null && character.gender === "male")!;

const man = (held: ReadonlyArray<readonly [string, number]>, age = 45): { world: WorldState; him: Character } => {
  const him: Character = { ...template, prestigeBps: 9_500, ordo: "patrician", ageYearsAtStart: age, officesHeld: held.map(([officeId, lastHeldAtStep]) => ({ officeId, lastHeldAtStep })), eligibilityWaivers: [], disqualifyingStatuses: [] };
  return { world: { ...base, characters: base.characters.map((character) => (character.id === him.id ? him : character)) }, him };
};
const refusal = (id: string, who: { world: WorldState; him: Character }, day: number): string | null =>
  admissionRefusal(who.world, office(id), office(id).eligibilityRequirementIds, who.him, day);

describe("the cursus keeps its order", () => {
  it("asks his years of a man who stands for quaestor", () => {
    expect(refusal("roman-quaestor", man([], 25), 100)).toMatch(/27 years/);
    expect(refusal("roman-quaestor", man([], 31), 100) ?? "").not.toMatch(/27 years/);
  });
  it("does not let a man step back down, or hold two of a rung", () => {
    expect(refusal("roman-aedile", man([["roman-praetor", 500]]), 2_000)).toMatch(/lesser office/);
    expect(refusal("roman-plebeian-aedile", man([["roman-aedile", 500]]), 2_000)).toMatch(/beside it/);
  });
  it("asks a year's rest between one office and the next", () => {
    const aedile = man([["roman-aedile", 1_000]]);
    expect(refusal("roman-praetor", aedile, 1_040)).toMatch(/year's rest/);
    expect(refusal("roman-praetor", aedile, 1_000 + 400) ?? "").not.toMatch(/rest|lesser|beside/);
  });
  it("does not let a quaestor leap to the consulship", () => {
    expect(refusal("roman-consul", man([["roman-quaestor", 100]]), 100 + 800)).toMatch(/aedile or praetor/);
  });
});
