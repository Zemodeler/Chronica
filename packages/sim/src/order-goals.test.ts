import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { goalsOfAct, refResolver } from "./order-goals";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("what an act is for", () => {
  // Plan chronicle-and-order-truth, 1.3: an effect check for every kind that failed in the audits.
  it("makes an appointment done only when the man holds the seat", () => {
    const state = world();
    const person = state.characters[0]!;
    const act = WorldDeltaSchema.parse({ op: "office_seat_set", officeId: "legate-of-sicily", holderCharacterRef: person.id, reason: "Appointed." });
    const goals = goalsOfAct(state, act, [], refResolver(state, new Map()));
    expect(goals).toEqual([{ kind: "seat_held", officeId: "legate-of-sicily", characterId: person.id }]);
  });

  it("makes an emptied seat nobody's goal", () => {
    const state = world();
    const act = WorldDeltaSchema.parse({ op: "office_seat_set", officeId: "legate-of-sicily", holderCharacterRef: null, reason: "Vacated." });
    expect(goalsOfAct(state, act, [], refResolver(state, new Map()))).toEqual([]);
  });
});
