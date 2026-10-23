import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "@chronica/shared";
import { openThreadLines, openThreadsEntry } from "./open-threads";

const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const storyline = (id: string, change: Record<string, unknown>) => ({
  id, title: `Thread ${id}`, participantIds: [], provinceId: null, phase: "rising", stakes: "Something.", history: ["It began."],
  nextDevelopment: "The envoys are expected.", visibility: "public", origin: "world", openedByRef: null, openedAtStep: 0, updatedAtStep: 0, closedAtStep: null, causalFactIds: [], seedKey: null,
  ...change,
}) as unknown as WorldState["storylines"][number];

describe("what is still open", () => {
  it("lists the threads the player's side can see, never a private one, a closed one or a stale one", () => {
    const world: WorldState = { ...opening(), elapsedStep: 100, storylines: [
      storyline("a", { updatedAtStep: 95 }), storyline("b", { visibility: "private", updatedAtStep: 99 }),
      storyline("c", { phase: "closed", updatedAtStep: 99 }), storyline("d", { updatedAtStep: 1 }),
    ] };
    expect(openThreadLines(world, null)).toEqual(["Thread a: The envoys are expected."]);
  });

  it("leaves out other people's health and the Senate's votes", () => {
    const world: WorldState = { ...opening(), elapsedStep: 10, storylines: [
      storyline("health", { title: "The health of Menecrates", seedKey: "peril:menecrates", participantIds: ["menecrates"], updatedAtStep: 9 }),
      storyline("mine", { title: "My own health", seedKey: "peril:me", participantIds: ["me"], updatedAtStep: 9 }),
      storyline("vote", { title: "Dentatus and Ogulnius in open rivalry", nextDevelopment: "When the Senate's vote on the motion arrives, choose a response.", updatedAtStep: 9 }),
      storyline("road", { title: "Rhegium and the Campanian Legion", updatedAtStep: 9 }),
    ] };
    expect(openThreadLines(world, "me")).toEqual(["My own health: The envoys are expected.", "Rhegium and the Campanian Legion: The envoys are expected."]);
  });

  it("is no entry at all when nothing is open", () => {
    expect(openThreadsEntry({ ...opening(), storylines: [] }, null, 0)).toBeNull();
  });

  it("is a recorded entry otherwise", () => {
    const world: WorldState = { ...opening(), elapsedStep: 10, storylines: [storyline("a", { updatedAtStep: 9 })] };
    const entry = openThreadsEntry(world, null, 5)!;
    expect(entry.kind).toBe("recorded");
    expect(entry.title).toBe("Still open");
    expect(entry.body).toContain("Thread a");
  });
});
