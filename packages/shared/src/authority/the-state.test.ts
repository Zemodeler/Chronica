import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { readTheState } from "./the-state";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const clock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const holderOf = (state: WorldState) => {
  const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
  return state.characters.find((character) => character.id === seat.holderCharacterId)!;
};

describe("the state a person serves, as they could know it", () => {
  it("shows an officeholder his own power's offices, his own first", () => {
    const state = world();
    const holder = holderOf(state);
    const reading = readTheState(state, holder.id, offices, clock);
    expect(reading.offices.length).toBeGreaterThan(0);
    expect(reading.offices[0]!.yours).toBe(true);
    expect(reading.polityLabel).toBe(state.map.polities.find((polity) => polity.id === holder.polityId)!.name);
  });

  it("says how his power is governed, and lists each office once, with how it is filled", () => {
    const seeded = world();
    const holder = holderOf(seeded);
    // The sim grows constitutions at the first tick (`ensureConstitutions`); the seed has none.
    const state: WorldState = {
      ...seeded,
      constitutions: [{ polityId: holder.polityId!, form: "oligarchic_republic", origin: "scenario", adoptedAtStep: 0, rulerOfficeId: null, sovereignInstitutionId: null, history: [] }],
    };
    const reading = readTheState(state, holder.id, offices, clock, definition.government.successionRules);
    expect(reading.government?.formLabel).toMatch(/great houses|republic/i);
    const keys = reading.offices.map((office) => office.key);
    expect(new Set(keys).size).toBe(keys.length);
    const mine = reading.offices[0]!;
    expect(mine.holders.some((seat) => seat.yours)).toBe(true);
    expect(mine.filledLabel).not.toBeNull();
    for (const office of reading.offices) expect(office.holders.length).toBeLessThanOrEqual(office.seats);
  });

  it("does not show a foreigner another power's offices", () => {
    const state = world();
    const holder = holderOf(state);
    const foreigner = state.characters.find((character) => character.alive && character.polityId !== holder.polityId && character.polityId !== null)!;
    const theirs = readTheState(state, foreigner.id, offices, clock);
    const romanOffices = new Set(state.material.officeSeats.filter((seat) => seat.holderCharacterId === holder.id).map((seat) => seat.officeId));
    expect(theirs.offices.some((office) => romanOffices.has(office.key))).toBe(false);
  });

  it("keeps a treaty made in private from those who do not govern", () => {
    const state = world();
    const holder = holderOf(state);
    const other = state.map.polities.find((polity) => polity.id !== holder.polityId)!;
    const secret = {
      id: "secret-pact", kind: "non_aggression", polityId: holder.polityId!, otherPolityId: other.id, terms: "Neither will move on Sicily.",
      sinceStep: state.elapsedStep, visibility: "private",
    };
    const withSecret = WorldStateSchema.parse({ ...state, polityAgreements: [...state.polityAgreements, secret] });
    const commoner = withSecret.characters.find((character) =>
      character.alive && character.polityId === holder.polityId && character.officesHeld.length === 0
      && !withSecret.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === character.id));
    if (commoner === undefined) return;
    const powers = readTheState(withSecret, commoner.id, offices, clock).abroad.powers;
    expect(powers.some((power) => power.lines.some((line) => line.key === "secret-pact"))).toBe(false);
    expect(powers.every((power) => power.regard === null)).toBe(true);
  });

  it("says legitimacy in words, never as a number", () => {
    const state = world();
    const reading = readTheState(state, holderOf(state).id, offices, clock);
    if (reading.legitimacy === null) return;
    expect(reading.legitimacy.inWords).not.toMatch(/\d/);
  });

  it("gives nobody's state to someone with no character", () => {
    expect(readTheState(world(), null, offices, clock).offices).toEqual([]);
  });
});
