import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type Office, type WorldState } from "../index";
import { buildAuthorityIndex } from "./authority-grant";
import {
  CLAIMED_OFFICE_SOURCE_REF,
  buildStation,
  authorityInWords,
  knowsPerson,
  reachesPerson,
  describeAuthority,
  factsKnownToStation,
  holdsPolityStanding,
  speaksForPolity,
} from "./station";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const offices: readonly Office[] = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition).government.offices;

/** Whoever the scenario actually seated. The fixtures move; the question does not. */
function seatedConsul(state: WorldState): string {
  const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null);
  return seat?.holderCharacterId ?? state.characters[0]!.id;
}

/** Somebody of the same polity holding no seat: the case the whole design turns on. */
function privateCitizen(state: WorldState, consulId: string): string | null {
  const consul = state.characters.find((character) => character.id === consulId)!;
  const seated = new Set(state.material.officeSeats.filter((seat) => seat.status === "held").map((seat) => seat.holderCharacterId));
  const commanders = new Set(state.material.forces.flatMap((force) => [force.commanderCharacterId, force.controllerCharacterId]));
  return state.characters.find(
    (character) => character.alive && character.polityId === consul.polityId && !seated.has(character.id) && !commanders.has(character.id) && character.officeId === null,
  )?.id ?? null;
}

describe("a person's station", () => {
  it("gives someone who holds an office standing over their whole power", () => {
    const state = world();
    const station = buildStation({ world: state, characterId: seatedConsul(state), offices });
    expect(station.seats.length).toBeGreaterThan(0);
    expect(holdsPolityStanding(station)).toBe(true);
    // An office's treasury is reach, and reach is sight.
    for (const seat of station.seats) {
      if (seat.office.treasuryAccountId !== null) expect(station.accountIds.has(seat.office.treasuryAccountId)).toBe(true);
    }
  });

  it("gives a private citizen of the same power nothing but his own purse", () => {
    const state = world();
    const citizenId = privateCitizen(state, seatedConsul(state));
    if (citizenId === null) return;
    const station = buildStation({ world: state, characterId: citizenId, offices });

    expect(station.seats).toEqual([]);
    expect(station.forceIds.size).toBe(0);
    expect(holdsPolityStanding(station)).toBe(false);
    for (const domain of ["fiscal", "military", "civil", "diplomatic", "judicial", "religious", "social"] as const) {
      expect(speaksForPolity(station, domain), domain).toBe(false);
    }
    // Ownership is not an office, so his own money is still his.
    const purse = state.characters.find((character) => character.id === citizenId)!.personalAccountId;
    if (purse !== null) expect(station.accountIds.has(purse)).toBe(true);
  });

  it("does not mistake commanding a legion for commanding the republic", () => {
    // The distinction the whole design turns on. `deriveCommandGrants` scopes a
    // command to the force; only an office is scoped to the polity.
    const state = world();
    const force = state.material.forces[0]!;
    const station = buildStation({ world: state, characterId: force.commanderCharacterId, offices });

    expect(station.forceIds.has(force.id)).toBe(true);
    const seated = state.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === force.commanderCharacterId);
    if (!seated) {
      expect(speaksForPolity(station, "military")).toBe(false);
      expect(holdsPolityStanding(station)).toBe(false);
    }
  });

  it("shows a claimed office what that office would show, and marks it as sight alone", () => {
    // A declared player carries `officeId` from a word-overlap match that can
    // set the field without finding a seat. Judged on seats alone, such a consul
    // would read his own republic as a stranger and then order things the prompt
    // never told him he held.
    const state = world();
    const citizenId = privateCitizen(state, seatedConsul(state));
    if (citizenId === null) return;
    const office = offices[0]!;
    const claiming: WorldState = {
      ...state,
      characters: state.characters.map((character) => (character.id === citizenId ? { ...character, officeId: office.id, polityId: office.polityId } : character)),
    };

    const station = buildStation({ world: claiming, characterId: citizenId, offices });
    expect(holdsPolityStanding(station)).toBe(true);
    expect(station.seats.some((seat) => seat.office.id === office.id)).toBe(true);
    expect(station.grants.some((grant) => grant.sourceRef === CLAIMED_OFFICE_SOURCE_REF)).toBe(true);
  });

  it("never lets a claimed office reach the authority index, which is what decides what may be done", () => {
    // Sight is not permission. A station that leaked into the authority check
    // would turn this kindness into a way of acquiring power by claiming it.
    const state = world();
    const citizenId = privateCitizen(state, seatedConsul(state));
    if (citizenId === null) return;
    const office = offices[0]!;
    const claiming: WorldState = {
      ...state,
      characters: state.characters.map((character) => (character.id === citizenId ? { ...character, officeId: office.id, polityId: office.polityId } : character)),
    };

    const index = buildAuthorityIndex(claiming.material, claiming.authorityGrants, offices, claiming.elapsedStep);
    expect(index.grants.some((grant) => grant.sourceRef === CLAIMED_OFFICE_SOURCE_REF)).toBe(false);
    expect(index.grants.some((grant) => grant.holder.id === citizenId && grant.scope.kind === "polity")).toBe(false);
  });

  it("names the scopes a person may act over, rather than printing their ids", () => {
    const state = world();
    const lines = describeAuthority(buildStation({ world: state, characterId: seatedConsul(state), offices }), state);
    expect(lines.length).toBeGreaterThan(0);
    // The section exists to tell the world who it is speaking for; "over
    // polity:rome" tells it nothing a reader would recognise.
    expect(lines.some((line) => /over [A-Z]/.test(line))).toBe(true);
  });

  it("says the same thing to the prompt after the split as it did before", () => {
    // describeAuthority is now a rendering of authorityInWords. The prompt is
    // written against its exact wording, so the two must not drift.
    const state = world();
    const station = buildStation({ world: state, characterId: seatedConsul(state), offices });
    const rebuilt = authorityInWords(station, state).map(
      (p) => `${p.powers.join(", ")} in ${p.domain} matters, over ${p.overLabel} [${p.scopeId}].`,
    );
    expect(rebuilt).toEqual(describeAuthority(station, state));
  });

  it("gives a person the same grant without the id the model needs", () => {
    const state = world();
    const station = buildStation({ world: state, characterId: seatedConsul(state), offices });
    const phrases = authorityInWords(station, state);
    expect(phrases.length).toBeGreaterThan(0);
    for (const phrase of phrases) {
      expect(phrase.overLabel).not.toContain("[");
      expect(phrase.powers.join(" ")).not.toContain("[");
    }
  });
});

describe("knowing a person, as against being briefed on them", () => {
  it("does not let a consul claim acquaintance with everyone alive", () => {
    // reachesPerson has a polity hatch and should: a man who speaks for a
    // whole power is briefed on its figures. It is the wrong answer to "do
    // these two know each other" -- under it a consul knows a Gallic
    // chieftain he has never heard of.
    const state = world();
    const station = buildStation({ world: state, characterId: seatedConsul(state), offices });
    const strangers = state.characters.filter(
      (c) => c.id !== station.characterId && !station.knownCharacterIds.has(c.id),
    );
    expect(strangers.length).toBeGreaterThan(0);
    for (const stranger of strangers) {
      expect(reachesPerson(station, stranger.id)).toBe(true);
      expect(knowsPerson(station, stranger.id)).toBe(false);
    }
  });

  it("still counts the people they have actually dealt with, and themselves", () => {
    const state = world();
    const station = buildStation({ world: state, characterId: seatedConsul(state), offices });
    expect(knowsPerson(station, station.characterId)).toBe(true);
    for (const id of station.knownCharacterIds) expect(knowsPerson(station, id)).toBe(true);
  });
});

describe("what a person knows, as against what their government knows", () => {
  const polityFact = (id: string, subjectId: string) => ({
    id,
    time: { day: 0, minute: 0 },
    atStep: 0,
    kind: "dispatch",
    summary: "A dispatch.",
    affectedEntities: [{ kind: "polity" as const, id: subjectId }],
    resourceChanges: [],
    authorityChange: undefined,
    visibility: "polity" as const,
    discovery: { state: "polity" as const, knowableAtInstant: null, discoveredBy: [] },
    evidence: null,
    eligibleReactionScopes: [],
    sourceEventId: null,
    sourceActionId: null,
    causalDepth: 0,
  });

  it("lets the government read its own dispatches", () => {
    const state = world();
    const consulId = seatedConsul(state);
    const station = buildStation({ world: state, characterId: consulId, offices });
    const fact = polityFact("f1", station.polityId ?? "rome");
    expect(factsKnownToStation([fact], station, { day: 1, minute: 0 })).toHaveLength(1);
  });

  it("does not let a private citizen read them", () => {
    // This is the leak that made a merchant's world identical to a consul's:
    // `factsKnownTo` treats every polity-scoped fact as known to everyone in it.
    const state = world();
    const citizenId = privateCitizen(state, seatedConsul(state));
    if (citizenId === null) return;
    const station = buildStation({ world: state, characterId: citizenId, offices });
    const fact = polityFact("f1", station.polityId ?? "rome");
    expect(factsKnownToStation([fact], station, { day: 1, minute: 0 })).toEqual([]);
  });

  it("still lets a private citizen read what names something he touches", () => {
    const state = world();
    const citizenId = privateCitizen(state, seatedConsul(state));
    if (citizenId === null) return;
    const station = buildStation({ world: state, characterId: citizenId, offices });
    const fact = { ...polityFact("f1", "rome"), affectedEntities: [{ kind: "character" as const, id: citizenId }] };
    expect(factsKnownToStation([fact], station, { day: 1, minute: 0 })).toHaveLength(1);
  });

  it("leaves public news public", () => {
    const state = world();
    const citizenId = privateCitizen(state, seatedConsul(state));
    if (citizenId === null) return;
    const station = buildStation({ world: state, characterId: citizenId, offices });
    const fact = { ...polityFact("f1", "rome"), visibility: "public" as const, discovery: { state: "public" as const, knowableAtInstant: null, discoveredBy: [] } };
    expect(factsKnownToStation([fact], station, { day: 1, minute: 0 })).toHaveLength(1);
  });
});
