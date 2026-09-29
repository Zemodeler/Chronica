import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, emitFacts, type Fact, type FactDraft, type WorldState } from "@chronica/shared";
import { findPolityGaps } from "./population";

/**
 * The opening world with its minor powers emptied again. Every power has been
 * seated with a ruler since scenario v34; these are about what the world owes
 * a country that has lost everybody, which still happens -- to a people whose
 * last chief dies, or one a war has broken up.
 */
const world = (): WorldState => {
  const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const authored = new Set(["rome", "carthage", "syracuse", "mamertines", "rhegium-campanians"]);
  return { ...opening, characters: opening.characters.filter((character) => character.polityId === null || authored.has(character.polityId)) };
};

let counter = 0;
function factAbout(polityId: string): Fact {
  const draft: FactDraft = {
    time: { day: 0, minute: 0 }, atStep: 0, kind: "military_order",
    summary: `Rome moves against ${polityId}.`,
    affectedEntities: [{ kind: "polity", id: polityId }],
    resourceChanges: [], authorityChange: undefined, visibility: "public",
    discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    evidence: null, eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0,
  };
  return emitFacts([draft], () => `fact-${(counter += 1)}`)[0]!;
}

const gaps = (facts: readonly Fact[] = [], limit = 2) =>
  findPolityGaps({ world: world(), ownPolityId: "rome", facts, limit });

describe("countries the world owes people", () => {
  it("finds countries that hold land but have nobody in them", () => {
    // The scenario names a dozen Italian peoples and gives almost none of them
    // a single character. That is the sparse start working as designed -- and
    // the gap this closes.
    const found = gaps();
    expect(found.length).toBeGreaterThan(0);
    for (const gap of found) expect(gap.provinceCount).toBeGreaterThan(0);
  });

  it("never asks the player's own country to be populated", () => {
    expect(gaps([], 20).map((gap) => gap.polityId)).not.toContain("rome");
  });

  it("puts whoever the player is dealing with first", () => {
    // Invading the Boii must produce Boii to fight, ahead of any quiet
    // neighbour who happens to hold more ground.
    expect(gaps([factAbout("boii")])[0]!.polityId).toBe("boii");
  });

  it("says why, in words a prompt can use", () => {
    expect(gaps([factAbout("boii")])[0]!.why).toContain("dealing with them now");
  });

  it("asks for both a leader and forces when a country has neither", () => {
    const boii = gaps([factAbout("boii")])[0]!;
    expect(boii.needsLeader).toBe(true);
    expect(boii.needsForce).toBe(true);
  });

  it("stops asking once a country has been given people", () => {
    const populated: WorldState = (() => {
      const state = world();
      const boiiProvince = state.map.provinces.find((province) => province.controllerPolityId === "boii")!;
      return {
        ...state,
        characters: [...state.characters, { ...state.characters[0]!, id: "boii-chief", name: "A Boii chieftain", polityId: "boii", officeId: null }],
        material: {
          ...state.material,
          forces: [...state.material.forces, { ...state.material.forces[0]!, id: "boii-host", name: "Boii host", polityId: "boii", locationId: boiiProvince.id }],
        },
      };
    })();
    const found = findPolityGaps({ world: populated, ownPolityId: "rome", facts: [factAbout("boii")], limit: 20 });
    expect(found.map((gap) => gap.polityId)).not.toContain("boii");
  });

  it("asks for only a few at a time, so one burst is not swamped", () => {
    expect(gaps([], 2).length).toBeLessThanOrEqual(2);
  });

  it("asks for the same countries in the same order every time", () => {
    expect(gaps([factAbout("boii")]).map((g) => g.polityId)).toEqual(gaps([factAbout("boii")]).map((g) => g.polityId));
  });
});
