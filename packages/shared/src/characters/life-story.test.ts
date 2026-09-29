import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { notableEventsSince, type StoryEntry } from "./life-story";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = definition.government;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const DAY = 1440;

const consulOf = (state: WorldState) => {
  const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
  return state.characters.find((character) => character.id === seat.holderCharacterId)!;
};
const story = (state: WorldState, id: string, entries: readonly StoryEntry[] = []) =>
  notableEventsSince({ world: state, characterId: id, government, clock: definition.clock, entries });

/** Makes `childId` the consul's son, born on `day`. */
const withChild = (state: WorldState, consulId: string, childId: string, day: number): WorldState => ({
  ...state,
  characters: state.characters.map((c) => (c.id === childId ? { ...c, birthStep: day } : c)),
  familyLinks: [...state.familyLinks, {
    id: `family-test-${childId}`, characterId: consulId, relatedCharacterId: childId, kind: "parent",
    startedAtStep: day, endedAtStep: null, visibility: "public", provenanceEventId: null,
  }],
});

describe("what has happened to him since the opening", () => {
  it("says nothing of the opening itself: that is the backstory's to tell", () => {
    const state = world();
    expect(story(state, consulOf(state).id)).toEqual([]);
  });

  it("records a child born and a relative dead, though no historian wrote of either", () => {
    const state = world();
    const consul = consulOf(state);
    const child = state.characters.find((c) => c.id !== consul.id && c.alive)!;
    const born = withChild(state, consul.id, child.id, 40);
    expect(story(born, consul.id).map((event) => event.line)).toContain(`A ${child.gender === "female" ? "daughter" : "son"}, ${child.name}, born`);

    const mourning: WorldState = { ...born, characters: born.characters.map((c) => (c.id === child.id ? { ...c, alive: false, diedAtStep: 90 } : c)) };
    const events = story(mourning, consul.id);
    expect(events[0]).toMatchObject({ whose: "family", chronicleEntryId: null });
    expect(events[0]!.line).toMatch(new RegExp(`^Your (son|daughter) ${child.name} died$`));
  });

  it("counts his son's election as part of his own life", () => {
    const state = world();
    const consul = consulOf(state);
    const child = state.characters.find((c) => c.id !== consul.id && c.alive)!;
    const vacant = state.material.officeSeats.find((s) => s.holderCharacterId !== consul.id && s.holderCharacterId !== child.id)!;
    const elected: WorldState = {
      ...withChild(state, consul.id, child.id, 5),
      material: {
        ...state.material,
        officeSeats: state.material.officeSeats.map((s) => (s.id === vacant.id ? { ...s, holderCharacterId: child.id, status: "held", termStartedAtStep: 200 } : s)),
      },
    };
    const line = story(elected, consul.id).find((event) => event.key === `kin-office:${vacant.id}`);
    expect(line).toMatchObject({ whose: "family" });
    expect(line!.line).toContain("took office as");
  });

  it("takes the Chronicle's entry over a milestone that is the same event", () => {
    const state = world();
    const consul = consulOf(state);
    const child = state.characters.find((c) => c.id !== consul.id && c.alive)!;
    const born = withChild(state, consul.id, child.id, 40);
    const entry: StoryEntry = {
      id: "entry-birth", title: "An heir for the Cornelii", sortKey: 40 * DAY + 600,
      subjects: [{ kind: "character", id: consul.id }, { kind: "character", id: child.id }],
      tags: [{ kind: "character", id: consul.id }], significance: 30,
    };
    const events = story(born, consul.id, [entry]);
    expect(events.map((event) => event.line)).toContain("An heir for the Cornelii");
    expect(events.some((event) => event.key.startsWith("child:"))).toBe(false);
    expect(events.find((event) => event.chronicleEntryId === "entry-birth")).toBeDefined();
  });

  it("ranks by weight, keeps the latest entry about him, and reads newest first", () => {
    const state = world();
    const consul = consulOf(state);
    const entries: StoryEntry[] = Array.from({ length: 14 }, (_, index) => ({
      id: `entry-${index}`, title: `Entry ${index}`, sortKey: (100 + index) * DAY,
      subjects: [{ kind: "character", id: consul.id }], tags: [],
      // The newest is the slightest: it is kept anyway.
      significance: index === 13 ? 0 : 100 - index,
    }));
    const events = notableEventsSince({ world: state, characterId: consul.id, government, clock: definition.clock, entries, limit: 5 });
    expect(events).toHaveLength(5);
    expect(events[0]!.chronicleEntryId).toBe("entry-13");
    expect(events.map((event) => event.chronicleEntryId)).toContain("entry-0");
    const keys = events.map((event) => event.sortKey);
    expect([...keys].sort((a, b) => b - a)).toEqual(keys);
  });

  it("ignores entries about neither him nor his family", () => {
    const state = world();
    const consul = consulOf(state);
    const stranger = state.characters.find((c) => c.id !== consul.id)!;
    const entry: StoryEntry = { id: "elsewhere", title: "Far away", sortKey: 50 * DAY, subjects: [{ kind: "character", id: stranger.id }], tags: [], significance: 99 };
    expect(story(state, consul.id, [entry])).toEqual([]);
  });

  it("remembers the promises he kept and the ones he broke", () => {
    const state = world();
    const consul = consulOf(state);
    const friend = state.characters.find((c) => c.id !== consul.id)!;
    const promised: WorldState = {
      ...state,
      commitments: [...state.commitments, {
        id: "promise-test", promisorCharacterId: consul.id, beneficiaryCharacterId: friend.id, actionKind: state.commitments[0]?.actionKind ?? "support",
        description: "to back his law", conditions: "", requiredOfficeId: null, requiredResource: null, visibility: "public", sourceEventId: null,
        breachPressureKind: "humiliation", status: "broken", createdAtStep: 10, reviewAtStep: 30, resolvedAtStep: 30, resolutionReason: null,
      } as WorldState["commitments"][number]],
    };
    expect(story(promised, consul.id).map((event) => event.line)).toContain(`Broke your promise to ${friend.name}: to back his law`);
  });
});
