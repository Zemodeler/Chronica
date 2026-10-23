import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { namedDestination } from "./mission-intent";

/**
 * A town's name inside another word is not the town (docs/reports/consul-run-issues.md, H1).
 *
 * "Hunt down Decius Vibellius" sent two contingents from Bruttium to Cius in Bithynia, and "they stay in Bruttium" sent three
 * forces to Tium: the destination was read by a substring, and the army's own march was overwritten with it.
 */
const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const provinceOfTown = (name: string): string => world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.name === name))!.id;

describe("a name inside a word is no place", () => {
  it("does not read Cius out of Decius, nor Tium out of Bruttium", () => {
    expect(namedDestination(world, "Hunt down Decius Vibellius.")).toBeNull();
    expect(namedDestination(world, "The contingents stay in Bruttium.")).toBeNull();
  });

  it("does not forgive a misspelling in a common word: stop is not Stob", () => {
    expect(namedDestination(world, "The Apulian and Bruttian contingents stop where they are.")).toBeNull();
  });

  it("does not read a place out of a force's own name (M13)", () => {
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const named = { ...world, material: { ...world.material, forces: [...world.material.forces, { ...army, id: "legio-i", name: "Legio I at Rhegium" }] } };
    expect(namedDestination(named, "Legio I at Rhegium attacks the Campanian legion wherever it stands.")).toBeNull();
    expect(namedDestination(named, "Legio I at Rhegium marches to Messana.")).toBe(provinceOfTown("Messana"));
  });

  it("still reads a town named whole, and a misspelt name written as a name", () => {
    expect(namedDestination(world, "March the legions to Messana.")).toBe(provinceOfTown("Messana"));
    expect(namedDestination(world, "March the legions to Messanna.")).toBe(provinceOfTown("Messana"));
  });
});
