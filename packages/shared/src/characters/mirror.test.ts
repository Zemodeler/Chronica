import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { readTheMirror } from "./mirror";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = definition.government;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const consulOf = (state: WorldState) => {
  const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
  return state.characters.find((character) => character.id === seat.holderCharacterId)!;
};
const read = (state: WorldState, id: string) => readTheMirror({ world: state, characterId: id, government, clock: definition.clock })!;

describe("the bronze mirror, read from the world rather than the declaration", () => {
  it("says where he is now, not where he stood at the opening", () => {
    const state = world();
    const consul = consulOf(state);
    const elsewhere = state.map.provinces.find((province) => province.id !== consul.locationProvinceId)!;
    const moved: WorldState = { ...state, characters: state.characters.map((c) => (c.id === consul.id ? { ...c, locationProvinceId: elsewhere.id } : c)) };
    expect(read(moved, consul.id).locationLabel).toBe(elsewhere.name);
  });

  it("counts the money in his own purse as it is now", () => {
    const state = world();
    const consul = consulOf(state);
    const richer: WorldState = {
      ...state,
      material: { ...state.material, accounts: state.material.accounts.map((a) => (a.id === consul.personalAccountId ? { ...a, balance: 9_876 } : a)) },
    };
    expect(read(richer, consul.id).moneyBalance).toBe(9_876);
  });

  it("puts a son born in play in the family, and keeps a dead one there as dead", () => {
    // The key relations were the people the model wrote into the file at
    // creation, and nothing ever added to them.
    const state = world();
    const consul = consulOf(state);
    const other = state.characters.find((c) => c.id !== consul.id && c.alive)!;
    const withSon: WorldState = {
      ...state,
      familyLinks: [...state.familyLinks, {
        id: "family-test-son", characterId: consul.id, relatedCharacterId: other.id, kind: "parent",
        startedAtStep: 0, endedAtStep: null, visibility: "public", provenanceEventId: null,
      }],
    };
    const son = read(withSon, consul.id).relations.find((relation) => relation.characterId === other.id)!;
    expect(son).toMatchObject({ category: "family", familyRole: "child", alive: true });
    expect(son.relationship).toMatch(/^Your (son|daughter)$/);

    const mourning: WorldState = { ...withSon, characters: withSon.characters.map((c) => (c.id === other.id ? { ...c, alive: false } : c)) };
    expect(read(mourning, consul.id).relations.find((relation) => relation.characterId === other.id)?.alive).toBe(false);
  });

  it("lists somebody he has come to feel strongly about, in his own regard and never theirs", () => {
    const state = world();
    const consul = consulOf(state);
    const stranger = state.characters.find((c) => c.id !== consul.id && c.alive && !consul.relations.some((r) => r.subjectCharacterId === c.id))!;
    const before = read(state, consul.id).relations.some((relation) => relation.characterId === stranger.id);
    expect(before).toBe(false);
    const cause = { id: "cause-test", label: "He stood by you in the Senate.", score: 70, occurredAtStep: 1, decayPerYearBps: 0, encounterMemoryId: null };
    const grateful: WorldState = {
      ...state,
      characters: state.characters.map((c) => (c.id === consul.id ? { ...c, relations: [...c.relations, { subjectCharacterId: stranger.id, causes: [cause] }] } : c)),
    };
    const entry = read(grateful, consul.id).relations.find((relation) => relation.characterId === stranger.id)!;
    expect(entry).toMatchObject({ category: "other", regard: "devoted", notes: cause.label });

    // Their view of him is theirs: a feeling of the stranger's toward the
    // consul alone does not put the stranger on the consul's list.
    const secretlyHated: WorldState = {
      ...state,
      characters: state.characters.map((c) => (c.id === stranger.id ? { ...c, relations: [...c.relations, { subjectCharacterId: consul.id, causes: [{ ...cause, score: -90 }] }] } : c)),
    };
    expect(read(secretlyHated, consul.id).relations.some((relation) => relation.characterId === stranger.id)).toBe(false);
  });

  it("titles him by the office he holds, and by the one he held once he lays it down", () => {
    const state = world();
    const consul = consulOf(state);
    const seats = state.material.officeSeats.filter((candidate) => candidate.holderCharacterId === consul.id && candidate.status === "held");
    // A consul who also sits in the Senate is titled by the consulship.
    expect(read(state, consul.id).officeTitle).toMatch(/consul/i);
    const seat = seats.find((candidate) => /consul/i.test(government.offices.find((office) => office.id === candidate.officeId)?.label ?? ""))!;
    const mine = new Set(seats.map((candidate) => candidate.id));
    const retired: WorldState = {
      ...state,
      material: { ...state.material, officeSeats: state.material.officeSeats.map((s) => (mine.has(s.id) ? { ...s, holderCharacterId: null, status: "vacant" } : s)) },
      characters: state.characters.map((c) => (c.id === consul.id ? { ...c, officesHeld: [{ officeId: seat.officeId, lastHeldAtStep: 10 }] } : c)),
    };
    expect(read(retired, consul.id).officeTitle).toMatch(/^Formerly .*consul/i);
  });

  it("borrows the declaration's words for someone the world already has", () => {
    const state = world();
    const consul = consulOf(state);
    const known = consul.relations.find((relation) => relation.causes.length > 0);
    if (known === undefined) return;
    const name = state.characters.find((c) => c.id === known.subjectCharacterId)!.name;
    const mirror = readTheMirror({ world: state, characterId: consul.id, government, declared: [{ name, relationship: "old friend from the legions", notes: "Served together at Asculum." }] })!;
    expect(mirror.relations.find((relation) => relation.characterId === known.subjectCharacterId)).toMatchObject({ relationship: "Old friend from the legions", notes: "Served together at Asculum." });
  });
});
