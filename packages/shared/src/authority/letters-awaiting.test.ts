import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { lettersAwaitingYou } from "./letters-awaiting";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("letters waiting on the player's answer", () => {
  it("shows a letter addressed to him, and not one addressed to another man", () => {
    const state = world();
    const seat = state.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId !== null)!;
    const holder = state.characters.find((character) => character.id === seat.holderCharacterId)!;
    const sender = state.characters.find((character) => character.polityId !== holder.polityId && character.polityId !== null)!;
    const someoneElse = state.characters.find((character) => character.id !== holder.id && character.id !== sender.id)!;
    const letter = (id: string, to: string, kind: string) => ({
      id, kind, fromPolityId: sender.polityId, fromCharacterId: sender.id, toPolityId: holder.polityId, toCharacterId: to,
      subject: "Messana", terms: "Leave Messana to us.", sentAtStep: state.elapsedStep, replyDueByStep: state.elapsedStep + 9,
    });
    const withLetters = WorldStateSchema.parse({
      ...state,
      diplomacy: [...state.diplomacy, letter("to-him", holder.id, "ultimatum"), letter("to-another", someoneElse.id, "letter")],
    });
    const waiting = lettersAwaitingYou(withLetters, holder.id, offices, definition.clock);
    expect(waiting.map((entry) => entry.id)).toContain("to-him");
    expect(waiting.map((entry) => entry.id)).not.toContain("to-another");
    expect(waiting.find((entry) => entry.id === "to-him")).toMatchObject({ kindLabel: "An ultimatum", toYou: true });
  });
});
