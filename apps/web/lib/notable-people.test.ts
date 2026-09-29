import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema } from "@chronica/shared";
import { notablePeople } from "./notable-people";

const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const offices = punicWarsScenario.definition.government?.offices ?? [];

describe("the people of a world a player could be", () => {
  it("leads with the holders of the highest offices, the consuls of 270 among them", () => {
    const people = notablePeople(world, offices, new Set());
    expect(people.length).toBeGreaterThan(3);
    expect(people.slice(0, 2).every((person) => person.role !== null)).toBe(true);
    expect(people.some((person) => person.role === "Roman consul")).toBe(true);
  });

  it("takes no more than two from any one power, so it is not all Romans", () => {
    const people = notablePeople(world, offices, new Set());
    const perPolity = new Map<string, number>();
    for (const person of people) perPolity.set(person.polity ?? "", (perPolity.get(person.polity ?? "") ?? 0) + 1);
    expect(Math.max(...perPolity.values())).toBeLessThanOrEqual(2);
  });

  it("leaves out someone a player already is", () => {
    const first = notablePeople(world, offices, new Set())[0]!;
    const taken = world.characters.find((character) => character.name === first.name)!;
    expect(notablePeople(world, offices, new Set([taken.id])).some((person) => person.name === first.name)).toBe(false);
  });
});
