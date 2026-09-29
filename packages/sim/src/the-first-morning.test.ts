import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * Somebody in every chair (scenario v34).
 *
 * A hundred and twenty-seven powers opened with their thrones empty, and the
 * first man the world made for each -- "Umbrian council chief" -- called an
 * election for ruler and another for commander of horse the same morning. A
 * consul in Rome read about the Aquitani choosing a First Chief.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

describe("the first morning", () => {
  it("has a named ruler, seated, in every power that holds ground", () => {
    const world = opening();
    const landed = world.map.polities.filter((polity) => world.map.provinces.some((province) => province.controllerPolityId === polity.id));
    for (const polity of landed) {
      const people = world.characters.filter((character) => character.polityId === polity.id && character.alive);
      expect(people.length, polity.id).toBeGreaterThan(0);
      // Named as a man, never as his title.
      for (const person of people) expect(person.name, polity.id).not.toMatch(/\b(chief|leader|spokesman|council)\b/i);
      expect(world.material.officeSeats.some((seat) => seat.status === "held" && people.some((person) => person.id === seat.holderCharacterId)), polity.id).toBe(true);
    }
  });

  it("names the kings history names", () => {
    const names = new Set(opening().characters.map((character) => character.name));
    for (const king of ["Antigonus Gonatas", "Areus I", "Magas of Cyrene", "Alexander II of Epirus", "Statius Mettius"]) expect(names.has(king), king).toBe(true);
  });

  it("calls no election in its first half year", () => {
    let world = opening();
    const called: string[] = [];
    for (let day = 5; day <= 180; day += 5) {
      const ticked = runDeterministicTick({
        world: { ...world, elapsedStep: day, instant: { ...world.instant, day } }, toDay: day, ids: createIdFactory(`morning-${day}`), warfare: definition.warfare,
        government: { offices: definition.government.offices, successionRules: definition.government.successionRules ?? [] },
      });
      called.push(...ticked.factProposals.filter((fact) => fact.kind === "election_called" || fact.kind === "election_failed").map((fact) => fact.summary));
      world = ticked.world;
    }
    expect(called).toEqual([]);
    // Half a year of the whole world, ticked: slow under a full suite.
  }, 120_000);
});
