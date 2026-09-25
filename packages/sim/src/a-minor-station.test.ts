import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type Character, type WorldState } from "@chronica/shared";
import { routeAmbientActors } from "./attention";
import { successionDecision } from "./mortality";

/**
 * A man of no office, and how the world treats him.
 *
 * Owning a purse was counted as holding power, so every private citizen stood
 * beside the consul in who the world asked what they were doing; and a dead
 * private man's successor was offered from the top of the state -- the sitting
 * consul, first.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;

/** Rome, with a potter in it. */
function world(): WorldState {
  const state = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const curius = state.characters.find((character) => character.id === "manius-curius")!;
  const potter = (id: string, name: string, prestigeBps: number): Character => ({
    ...curius, id, name, prestigeBps, officeId: null, officesHeld: [], relations: [], ambitions: [], mind: { ...curius.mind, currentPressures: [] },
  });
  return {
    ...state,
    characters: [...state.characters, potter("lucius-potter", "Lucius the potter", 1_500), potter("titus-neighbour", "Titus, his neighbour", 1_600)],
    // The Senate seats make everyone the scenario names an officeholder; this is about a man who is not.
    material: { ...state.material, officeSeats: state.material.officeSeats.filter((seat) => seat.officeId !== "roman-senator") },
  };
}

describe("a man of no office", () => {
  it("is asked about his own affairs only below everybody who has business to run", () => {
    const cast = routeAmbientActors({ world: world(), facts: [], offices, excludeCharacterIds: [], max: 40 });
    const order = cast.map((actor) => actor.characterId);
    const potter = order.indexOf("lucius-potter");
    expect(potter).toBeGreaterThan(-1);
    expect(order.indexOf("gaius-genucius")).toBeLessThan(potter);
    // His purse is not a command.
    expect(cast[potter]!.why).not.toContain("has a command or an office");
  });

  it("is succeeded by somebody near him, never by the consul", () => {
    const state = world();
    const neighbourly = {
      ...state,
      characters: state.characters.map((character) => (character.id === "titus-neighbour"
        ? { ...character, relations: [{ subjectCharacterId: "lucius-potter", causes: [{ id: "old-friends", label: "We grew up together.", score: 20, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: 30, affection: 30 } }] }] }
        : character)),
    };
    const decision = successionDecision(neighbourly, "lucius-potter", 0);
    const offered = decision.options.map((option) => option.id);
    expect(offered[0]).toBe("succeed-titus-neighbour");
    expect(offered).not.toContain("succeed-gaius-genucius");
  });
});
