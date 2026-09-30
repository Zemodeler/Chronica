import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { isBackgroundLetter, lettersOwed, aLetterWaitsOnItsReader } from "./letters";

/**
 * Two other powers writing plainly to each other is the world's background:
 * it is on the record, but it does not wake its reader for another reply.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const letter = (over: Partial<DiplomaticMessage> = {}): DiplomaticMessage => ({
  id: "m1", kind: "letter", fromPolityId: "carthage", fromCharacterId: "hanno-carthage", toPolityId: "syracuse", toCharacterId: "hieron-ii",
  subject: "The strait", terms: "Carthage seeks the strait open.", sentAtStep: 0, replyDueByStep: null, status: "awaiting_reply", answer: null,
  answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity", ...over,
});

describe("a background letter", () => {
  it("is a plain letter between two powers, neither of them the player's", () => {
    expect(isBackgroundLetter(letter(), "rome")).toBe(true);
  });

  it("is not one when the player's power is either end", () => {
    expect(isBackgroundLetter(letter({ toPolityId: "rome" }), "rome")).toBe(false);
    expect(isBackgroundLetter(letter({ fromPolityId: "rome" }), "rome")).toBe(false);
  });

  it("is not one when it offers, demands or threatens something", () => {
    expect(isBackgroundLetter(letter({ kind: "alliance_offer" }), "rome")).toBe(false);
    expect(isBackgroundLetter(letter({ proposes: ["alliance"] }), "rome")).toBe(false);
    expect(isBackgroundLetter(letter({ clauses: [{ kind: "x" }] }), "rome")).toBe(false);
    expect(isBackgroundLetter(letter({ onRefusal: "war" }), "rome")).toBe(false);
  });

  it("is never one when nobody's power is the player's", () => {
    expect(isBackgroundLetter(letter(), null)).toBe(false);
  });

  it("does not wake its reader, but a letter to the player's power still does", () => {
    const world: WorldState = { ...opening(), diplomacy: [letter()] };
    expect(lettersOwed(world, definition.clock, [], "rome").size).toBe(0);
    expect(lettersOwed(world, definition.clock, [], null).size).toBe(1);
    expect(aLetterWaitsOnItsReader(world, [], "rome")).toBe(false);
    const toRome: WorldState = { ...world, diplomacy: [letter({ toPolityId: "rome", toCharacterId: "hieron-ii" })] };
    expect(lettersOwed(toRome, definition.clock, [], "rome").size).toBe(1);
  });
});
