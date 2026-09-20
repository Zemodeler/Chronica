import { describe, expect, it } from "vitest";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { punicWarsScenario } from "@chronica/db";
import { whoMayBeReached } from "./access";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("who you can get a hearing from", () => {
  it("never refuses a living person without saying what to do about it", () => {
    // The invariant this whole module hangs on. An empty ladder is a dead end,
    // and a dead end is the one thing the branch rules out: the `write` rung
    // is always there, because you may always write to anybody.
    const state = world();
    let blocked = 0;
    let open = 0;
    for (const reacher of state.characters) {
      for (const target of state.characters) {
        if (reacher.id === target.id) continue;
        const verdict = whoMayBeReached({ world: state, offices, reacherId: reacher.id, targetId: target.id, channel: "correspondence" });
        if (verdict.reachable) { open += 1; continue; }
        if (!target.alive) continue;
        blocked += 1;
        expect(verdict.ladder.length, `${reacher.id} -> ${target.id}`).toBeGreaterThan(0);
        expect(verdict.ladder[verdict.ladder.length - 1]!.rung).toBe("write");
        expect(verdict.reason).not.toBeNull();
      }
    }
    // The invariant is worth nothing if nothing is ever blocked, and the gate
    // is worth nothing if everything is.
    expect(blocked).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(0);
  });

  it("lets an order be answered whatever either of them is", () => {
    // Constraint 2 of the branch: the player must never give an order and read
    // nothing back. This rule is first precisely so nothing else can shadow it.
    const state = world();
    const [a, b] = state.characters;
    if (a === undefined || b === undefined) return;
    const stranger: WorldState = {
      ...state,
      // Strip everything that could let them speak by any other route.
      characters: state.characters.map((character) => (character.id === a.id || character.id === b.id
        ? { ...character, relations: [], prestigeBps: character.id === a.id ? 200 : 9_800, polityId: character.id === a.id ? "rome" : "carthage" }
        : character)),
      familyLinks: [],
    };
    const blocked = whoMayBeReached({ world: stranger, offices, reacherId: a.id, targetId: b.id, channel: "correspondence" });
    expect(blocked.reachable).toBe(false);

    const withOrder = whoMayBeReached({
      world: stranger, offices, reacherId: a.id, targetId: b.id, channel: "correspondence",
      orderAttempts: [{
        id: "order-1", issuerRef: { kind: "character", id: b.id }, recipientRef: { kind: "character", id: a.id },
        instruction: "Hold the crossing.", standing: "binding", status: "received",
      } as never],
    });
    expect(withOrder.reachable).toBe(true);
    expect(withOrder.via).toBe("answerable");
  });

  it("offers an introduction through whoever knows them both", () => {
    const state = world();
    const [stranger, middle, great] = state.characters;
    if (stranger === undefined || middle === undefined || great === undefined) return;
    const linked: WorldState = {
      ...state,
      characters: state.characters.map((character) => {
        if (character.id === stranger.id) {
          return {
            ...character, polityId: "rome", prestigeBps: 100, officeId: null,
            relations: [{ subjectCharacterId: middle.id, causes: [{ id: "c1", label: "An old creditor.", score: 10, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }],
          };
        }
        if (character.id === middle.id) {
          return {
            ...character, polityId: "rome", prestigeBps: 5_000,
            relations: [{ subjectCharacterId: great.id, causes: [{ id: "c2", label: "Served under him.", score: 20, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }],
          };
        }
        if (character.id === great.id) return { ...character, polityId: "carthage", prestigeBps: 9_500, relations: [] };
        return character;
      }),
      familyLinks: [],
    };
    const verdict = whoMayBeReached({ world: linked, offices, reacherId: stranger.id, targetId: great.id, channel: "correspondence" });
    expect(verdict.reachable).toBe(false);
    expect(verdict.ladder.some((step) => step.rung === "ask_intermediary" && step.throughCharacterId === middle.id)).toBe(true);
  });

  it("says a dead man is dead, and offers no ladder to him", () => {
    const state = world();
    const [a, b] = state.characters;
    if (a === undefined || b === undefined) return;
    const bereaved: WorldState = {
      ...state,
      characters: state.characters.map((character) => (character.id === b.id ? { ...character, alive: false, diedAtStep: 1 } : character)),
    };
    const verdict = whoMayBeReached({ world: bereaved, offices, reacherId: a.id, targetId: b.id, channel: "correspondence" });
    expect(verdict.reachable).toBe(false);
    expect(verdict.ladder).toEqual([]);
  });
});
