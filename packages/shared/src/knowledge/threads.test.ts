import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import type { WorldState } from "../world/world-state";
import { threadsYouSee, type ThreadEntry } from "./threads";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const CONSUL = "gaius-genucius";
const CITIZEN = "manius-curius";
const KING = "hieron-ii";

function withStoryline(state: WorldState, storyline: Record<string, unknown>): WorldState {
  return WorldStateSchema.parse({
    ...state,
    storylines: [...state.storylines, {
      provinceId: null, phase: "escalating", stakes: "Whether the straits are crossed", history: ["The narrator's own summary"],
      nextDevelopment: "Hieron betrays Rome", updatedAtStep: 0, ...storyline,
    }],
  });
}

const entry = (id: string, storylineIds: string[], read = true): ThreadEntry => ({
  id, title: `Entry ${id}`, dateLabel: "1 March", sortKey: Number(id.replace(/\D/g, "")) || 0, read, storylineIds,
  subjects: [{ kind: "character", id: KING }, { kind: "polity", id: "syracuse" }],
});

const threads = (state: WorldState, characterId: string, entries: ThreadEntry[], followed: string[] = []) =>
  threadsYouSee({ world: state, characterId, offices, entries, followedIds: new Set(followed) });

describe("threads of history", () => {
  it("tells a public thread from the Chronicle, never from the narrator's own notes", () => {
    const state = withStoryline(world(), { id: "straits", title: "The straits", participantIds: [KING], visibility: "public" });
    const note = threads(state, CONSUL, [entry("e1", ["straits"]), entry("e2", ["straits"], false)])["straits"]!;
    expect(note.history.map((line) => line.entryId)).toEqual(["e1", "e2"]);
    expect(note.unread).toBe(1);
    expect(JSON.stringify(note)).not.toContain("Hieron betrays Rome");
    expect(JSON.stringify(note)).not.toContain("The narrator's own summary");
    expect(note.who.map((linked) => linked.key)).toContain(`person:${KING}`);
  });

  it("keeps a private thread from anybody not in it, even with an entry tagged to it", () => {
    const state = withStoryline(world(), { id: "plot", title: "A plot", participantIds: [KING], visibility: "private" });
    expect(threads(state, CITIZEN, [entry("e1", ["plot"])])["plot"]).toBeUndefined();
    expect(threads(state, CONSUL, [entry("e1", ["plot"])], ["plot"])["plot"]).toBeUndefined();
  });

  it("shows a thread nobody has told the viewer of only when they follow it or are in it", () => {
    const state = withStoryline(world(), { id: "quiet", title: "Quiet", participantIds: [CONSUL], visibility: "public" });
    expect(threads(state, CITIZEN, [])["quiet"]).toBeUndefined();
    expect(threads(state, CITIZEN, [], ["quiet"])["quiet"]?.followed).toBe(true);
    expect(threads(state, CONSUL, [])["quiet"]).toBeDefined();
  });

  it("says what is at stake only where the thread is public or the viewer is in it", () => {
    const state = withStoryline(world(), { id: "senate", title: "The Senate", participantIds: [CONSUL], visibility: "polity" });
    expect(threads(state, CONSUL, [entry("e1", ["senate"])])["senate"]?.stakes).not.toBeNull();
  });
});
