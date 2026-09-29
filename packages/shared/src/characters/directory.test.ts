import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { lettersDirectory } from "./directory";
import { peopleYouKnow } from "./acquaintance";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const holderOf = (state: WorldState) => {
  const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
  return state.characters.find((character) => character.id === seat.holderCharacterId)!;
};

describe("the letter tray's people", () => {
  it("lists only people the player knows of, or who sit in an office", () => {
    const state = world();
    const viewer = holderOf(state);
    const known = new Set(peopleYouKnow({ world: state, viewerId: viewer.id, offices }).map((person) => person.id));
    const seated = new Set(state.material.officeSeats.filter((seat) => seat.status === "held").map((seat) => seat.holderCharacterId));
    for (const group of lettersDirectory({ world: state, viewerId: viewer.id, offices })) {
      for (const person of group.people) expect(known.has(person.id) || seated.has(person.id), person.name).toBe(true);
    }
  });

  it("keeps an unknown, unseated person out, even one standing in the same town", () => {
    const state = world();
    const viewer = holderOf(state);
    const stranger = {
      ...structuredClone(state.characters.find((character) => character.id !== viewer.id)!),
      id: "hidden-conspirator", name: "A Hidden Conspirator", officeId: null, relations: [],
      locationProvinceId: viewer.locationProvinceId,
    };
    const withStranger: WorldState = { ...state, characters: [...state.characters, stranger] };
    const everyone = lettersDirectory({ world: withStranger, viewerId: viewer.id, offices }).flatMap((group) => group.people);
    expect(everyone.some((person) => person.id === "hidden-conspirator")).toBe(false);
  });

  it("puts people already spoken to first, and says how each can be reached", () => {
    const state = world();
    const viewer = holderOf(state);
    const partner = state.characters.find((character) => character.id !== viewer.id && character.alive)!;
    const groups = lettersDirectory({ world: state, viewerId: viewer.id, offices, conversationPartnerIds: [partner.id] });
    expect(groups[0]!.key).toBe("speaking");
    expect(groups[0]!.people.map((person) => person.id)).toContain(partner.id);
    for (const person of groups.flatMap((group) => group.people)) {
      expect(["here", "letter"]).toContain(person.reach);
      if (person.reach === "here") expect(person.ladder).toEqual([]);
      expect(person.ladder.some((step) => step.startsWith("Write to"))).toBe(false);
    }
  });

  it("lets the player write to a foreign magistrate who has never heard of him", () => {
    const state = world();
    const viewer = holderOf(state);
    const everyone = lettersDirectory({ world: state, viewerId: viewer.id, offices }).flatMap((group) => group.people);
    const strangers = everyone.filter((person) => {
      const character = state.characters.find((candidate) => candidate.id === person.id)!;
      return character.polityId !== viewer.polityId && character.locationProvinceId !== viewer.locationProvinceId && person.how === "public";
    });
    expect(strangers.length).toBeGreaterThan(0);
    for (const person of strangers) {
      expect(person.reach, person.name).toBe("letter");
      expect(person.reachLabel).toBe("By letter");
    }
  });

  it("groups other powers' officeholders under their own power", () => {
    const state = world();
    const viewer = holderOf(state);
    const groups = lettersDirectory({ world: state, viewerId: viewer.id, offices });
    const foreign = groups.filter((group) => group.key.startsWith("polity:") && group.key !== `polity:${viewer.polityId}`);
    for (const group of foreign) {
      for (const person of group.people) expect(state.characters.find((character) => character.id === person.id)!.polityId).toBe(group.key.slice("polity:".length));
    }
  });
});
