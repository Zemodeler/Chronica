import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { roomStates } from "./room-states";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const clock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const consul = (state: WorldState) => {
  const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
  return state.characters.find((character) => character.id === seat.holderCharacterId)!;
};

describe("what each object in the room says", () => {
  it("says a fact about the player's money and men, in words with at most one number", () => {
    const state = world();
    const states = roomStates(state, consul(state).id, offices, clock);
    for (const object of Object.values(states)) {
      expect(object!.says.length).toBeGreaterThan(0);
      expect((object!.says.match(/\d[\d,]*/g) ?? []).length).toBeLessThanOrEqual(3);
      expect(object!.says).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
    }
  });

  it("marks the strongbox when payments have fallen behind", () => {
    const state = world();
    const behind: WorldState = {
      ...state,
      material: { ...state.material, obligations: state.material.obligations.map((obligation) => ({ ...obligation, arrears: 400 })) },
    };
    const states = roomStates(behind, consul(state).id, offices, clock);
    if (states.books === undefined) return;
    expect(states.books).toMatchObject({ marked: true });
    expect(states.books.says).toContain("Behind on payments");
  });

  it("says nothing for someone with no character", () => {
    expect(roomStates(world(), null, offices, clock)).toEqual({});
  });
});
