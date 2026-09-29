import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, advanceWorldTo, correspondenceOf, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import { lettersOwed } from "./letters";

/**
 * "Write back to Hieron."
 *
 * A letter from another power could be answered only at the desk, as an order,
 * and anybody in the letter tray could be spoken with at once however far off.
 * Now a player out of somebody's region writes to them from the tray, the
 * letter is put to its reader in the next burst, and a letter written to the
 * player is answered there too -- none of it, between two private people,
 * anybody's authority to breach.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const CURIUS = "manius-curius";
const HIERON = "hieron-ii";

const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

function as(actorId: string, state: WorldState, written: readonly unknown[]) {
  return applyDeltas(state, written.map((raw) => WorldDeltaSchema.parse(raw)), {
    now: state.instant,
    actorRef: { kind: "character", id: actorId },
    offices: definition.government.offices,
    warfare: definition.warfare,
    ids: createIdFactory(`tray-${actorId}`),
    gameId: "game-tray",
    playerCharacterId: CURIUS,
  });
}

/** The world on the day the last letter sent reaches its reader: Curius writes from Latium, Hieron reads in Syracuse. */
const whenItArrives = (state: WorldState): WorldState =>
  advanceWorldTo(state, { day: Math.max(state.instant.day, ...state.diplomacy.map((message) => message.deliveredOnDay ?? 0)), minute: state.instant.minute });

/** The tray's letter, as `letter-service.ts` writes it. */
const letterToHieron = {
  op: "diplomatic_message_send", localId: "letter", kind: "letter",
  fromPolityId: "rome", fromCharacterRef: CURIUS, toPolityId: "syracuse", toCharacterRef: HIERON,
  subject: "On the price of grain", terms: "Is it true your harvest failed? Rome would buy, if you would sell.",
  replyWithinDays: null, inReplyToRef: null, visibility: "private", reason: "A letter in Curius's own hand.",
};

describe("a letter from the tray", () => {
  it("is Curius's own business, and is put to Hieron in the next burst", () => {
    const state = world();
    expect(state.characters.find((character) => character.id === CURIUS)!.locationProvinceId)
      .not.toBe(state.characters.find((character) => character.id === HIERON)!.locationProvinceId);
    const sent = as(CURIUS, state, [letterToHieron]);
    expect(sent.rejected).toEqual([]);
    expect(sent.breaches).toEqual([]);
    const letter = sent.world.diplomacy.at(-1)!;
    expect(letter).toMatchObject({ fromCharacterId: CURIUS, toCharacterId: HIERON, status: "awaiting_reply", replyDueByStep: null });
    // On the road first: Hieron is not woken by a letter he has not got.
    expect(letter.deliveredOnDay).toBeGreaterThan(state.elapsedStep);
    expect(lettersOwed(sent.world, definition.clock).has(HIERON)).toBe(false);
    expect(lettersOwed(whenItArrives(sent.world), definition.clock).has(HIERON)).toBe(true);

    const thread = correspondenceOf(sent.world, CURIUS).find((entry) => entry.withCharacterId === HIERON)!;
    expect(thread.waitingOn).toBe("them");
    expect(thread.pages.map((page) => [page.fromYou, page.awaiting])).toEqual([[true, true]]);
  });

  it("reads Hieron's answer as a page of his, written back rather than countered by a power", () => {
    const sent = as(CURIUS, world(), [letterToHieron]);
    const letterId = sent.world.diplomacy.at(-1)!.id;
    const answered = as(HIERON, whenItArrives(sent.world), [{
      op: "diplomatic_message_answer", messageRef: letterId, answer: "countered",
      answerText: "It failed in the west. I will sell at a price, and not to Carthage.", reason: "He needs the silver.",
    }]);
    expect(answered.rejected).toEqual([]);
    expect(answered.breaches).toEqual([]);
    expect(answered.factProposals.find((fact) => fact.kind === "letter_answered")!.summary).toMatch(/^Hieron II wrote back to Manius Curius/);

    const thread = correspondenceOf(answered.world, CURIUS).find((entry) => entry.withCharacterId === HIERON)!;
    expect(thread.waitingOn).toBeNull();
    expect(thread.pages.map((page) => [page.fromYou, page.label])).toEqual([[true, "A letter"], [false, "Answered"]]);
  });

  it("lets a private man write back to a letter sent him by name, without answering for Rome", () => {
    const received = as(HIERON, world(), [{
      ...letterToHieron, fromPolityId: "syracuse", fromCharacterRef: HIERON, toPolityId: "rome", toCharacterRef: CURIUS,
      subject: "An old friend", terms: "Are you still farming, Curius?",
    }]);
    const letterId = received.world.diplomacy.at(-1)!.id;
    const words = "Still farming, and still poor. Come and see.";
    // Writing back is answering and sending in one breath, as the tray does it.
    const replied = as(CURIUS, whenItArrives(received.world), [
      { op: "diplomatic_message_answer", messageRef: letterId, answer: "countered", answerText: words, reason: "His own words." },
      { ...letterToHieron, localId: "reply", subject: "Re: An old friend", terms: words, inReplyToRef: letterId },
    ]);
    expect(replied.rejected).toEqual([]);
    expect(replied.breaches).toEqual([]);

    // Said once: the answer and the letter carrying it are one page.
    const thread = correspondenceOf(replied.world, CURIUS).find((entry) => entry.withCharacterId === HIERON)!;
    expect(thread.pages.map((page) => [page.fromYou, page.body])).toEqual([[false, "Are you still farming, Curius?"], [true, words]]);
    expect(thread.waitingOn).toBe("them");
  });

  it("still judges an answer to an offer a power would have to keep", () => {
    const offered = as(HIERON, world(), [{
      ...letterToHieron, kind: "alliance_offer", fromPolityId: "syracuse", fromCharacterRef: HIERON, toPolityId: "rome", toCharacterRef: CURIUS,
      subject: "An alliance", terms: "Syracuse and Rome, allies against Carthage.", visibility: "polity",
    }]);
    const letterId = offered.world.diplomacy.at(-1)!.id;
    const accepted = as(CURIUS, offered.world, [{ op: "diplomatic_message_answer", messageRef: letterId, answer: "accepted", answerText: "Rome accepts.", reason: "He thinks it wise." }]);
    // Curius holds no office: the alliance is not his to make.
    expect(accepted.rejected.length + accepted.breaches.length).toBeGreaterThan(0);
  });
});
