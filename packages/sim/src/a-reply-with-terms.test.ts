import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, advanceWorldTo, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * R13: "We accept Messana's protectorate. We shall defend Messana whenever
 * they call for us; in exchange we shall receive money and manpower as well
 * as your participation in any war Rome is in."
 *
 * Bound as the Mamertines' bare request for protection: the money, the men and
 * the war service were never in the agreement. An acceptance that asks for
 * more is an answer with terms of its own, and binds nobody until it is taken.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const mamertine = (): string => world().characters.find((character) => character.polityId === "mamertines" && character.alive)!.id;
const context = (actor: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`terms-${actor}`),
  gameId: "game-terms",
  playerCharacterId: "gaius-genucius",
});

const REQUEST = (from: string): WorldDelta => ({
  op: "diplomatic_message_send", localId: "ask", kind: "military_aid_request",
  fromPolityId: "mamertines", fromCharacterRef: from, toPolityId: "rome", toCharacterRef: "gaius-genucius",
  subject: "Protection for Messana", terms: "Take Messana under Rome's protection and leave it its own laws.",
  replyWithinDays: 20, inReplyToRef: null, visibility: "public", proposes: ["protectorate"], reason: "The Mamertines ask.",
});

const protectorate = (state: WorldState) => state.polityAgreements.find((agreement) => agreement.kind === "protectorate" && agreement.status === "active"
  && [agreement.polityId, agreement.otherPolityId].includes("mamertines") && [agreement.polityId, agreement.otherPolityId].includes("rome"));

describe("an acceptance that asks for more", () => {
  it("binds nothing, and sends the whole of the terms back to be taken or left", () => {
    const from = mamertine();
    const asked = applyDeltas(world(), [REQUEST(from)], context(from));
    expect(asked.rejected).toEqual([]);
    const letter = asked.world.diplomacy.at(-1)!;
    const arrived = advanceWorldTo(asked.world, { day: letter.deliveredOnDay ?? 0, minute: 540 });
    const answered = applyDeltas(arrived, [{
      op: "diplomatic_message_answer", messageRef: letter.id, answer: "accepted",
      answerText: "We accept Messana's protectorate. We shall defend Messana whenever they call for us, in exchange we shall receive money and manpower as well as your participation in any war Rome is in",
      reason: "The consul answers.",
    }], { ...context("gaius-genucius"), now: arrived.instant });
    expect(answered.rejected).toEqual([]);
    expect(protectorate(answered.world)).toBeUndefined();
    expect(answered.world.diplomacy.find((message) => message.id === letter.id)!.answer).toBe("countered");
    const counter = answered.world.diplomacy.at(-1)!;
    expect(counter.fromPolityId).toBe("rome");
    expect(counter.inReplyToMessageId).toBe(letter.id);
    expect(counter.terms).toContain("money and manpower");

    // Taken, it binds the whole.
    const delivered = advanceWorldTo(answered.world, { day: counter.deliveredOnDay ?? answered.world.instant.day, minute: 600 });
    const taken = applyDeltas(delivered, [{
      op: "diplomatic_message_answer", messageRef: counter.id, answer: "accepted", answerText: "Messana agrees.", reason: "They need Rome.",
    }], { ...context(from), now: delivered.instant });
    expect(taken.rejected).toEqual([]);
    expect(protectorate(taken.world)?.terms).toContain("money and manpower");
  });
});
