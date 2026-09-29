import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * People written by name where an id was wanted.
 *
 * "No character 'Gaius Genucius Clepsina' exists to take part in this": the
 * consul was in the world under his id and the reference was compared with ids
 * only. And "Hiero II" -- Hieron II spelt the Latin way -- was nobody at all,
 * so a letter to him went to a Roman of that name.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "hieron-ii" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("names"),
  gameId: "game-names",
};

describe("a person written by name", () => {
  it("is the person of that name", () => {
    const result = applyDeltas(world(), [WorldDeltaSchema.parse({
      op: "social_events",
      events: [{
        participantCharacterRefs: ["Hieron II", "Gaius Genucius Clepsina"], kind: "conversation", visibility: "public",
        summary: "Hieron refused the consul's ultimatum.", relationCauses: [],
      }],
    })], context);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([]);
  });

  it("is the person of that name spelt a letter differently", () => {
    const result = applyDeltas(world(), [WorldDeltaSchema.parse({
      op: "diplomatic_message_send", localId: "claim", kind: "letter", fromPolityId: "rome", fromCharacterRef: "gaius-genucius",
      toPolityId: "syracuse", toCharacterRef: "Hiero II", subject: "Roman claim and assurances concerning Messana",
      terms: "Respect Rome's claim over Messana.", replyWithinDays: null, inReplyToRef: null, visibility: "polity", reason: "The consul writes.",
    })], { ...context, actorRef: { kind: "character", id: "gaius-genucius" } });
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([]);
    expect(result.world.diplomacy.at(-1)!.toCharacterId).toBe("hieron-ii");
    expect(result.world.characters.filter((character) => /hiero/i.test(character.name))).toHaveLength(1);
  });

  it("will not carry a letter for one power to a man of another", () => {
    const result = applyDeltas(world(), [WorldDeltaSchema.parse({
      op: "diplomatic_message_send", localId: "claim", kind: "letter", fromPolityId: "rome", fromCharacterRef: "gaius-genucius",
      toPolityId: "syracuse", toCharacterRef: "manius-curius", subject: "Roman claim and assurances concerning Messana",
      terms: "Respect Rome's claim over Messana.", replyWithinDays: null, inReplyToRef: null, visibility: "polity", reason: "The consul writes.",
    })], { ...context, actorRef: { kind: "character", id: "gaius-genucius" } });
    expect(result.rejected[0]?.reason).toMatch(/Hieron II/);
  });
});
