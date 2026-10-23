import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema, WorldDeltaSchema, advanceWorldTo, agreementsBetween, type Character, type WorldDelta, type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { runSimulationBurst, type BurstInput } from "./burst";
import { answerALetterNow, answerComesOn, type LetterAnswerNowInput } from "./letter-reply";
import { aLetterWaitsOnItsReader, heldAnswersDue, lettersOwed, nextReplyDueKey } from "./letters";
import { createIdFactory, type SimModelPort, type SimOperation } from "./ports";
import { opening, withCustoms } from "./trade-test-kit";

/**
 * A letter is always answered by the model.
 *
 * Between the player and the people of the world the model is always called.
 * Speaking with a man in the room already was; a letter used to wait for its
 * reader to be picked for a round under the round's caps, or was answered by
 * rule. Now writing is asking: one call for the one written to, whoever he is,
 * decided at once and delivered when the letter has gone and the answer come
 * back. The rules (his interests, his nature, his books) are counsel in the
 * prompt and no longer overwrite what the model says; only what he cannot do
 * is refused.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const ROME = "gaius-genucius";
const HIERON = "hieron-ii";

const rules = { warfare: definition.warfare, terrains: definition.map.terrains, gameId: "game-letters" };
const context = (actor: string, now = { day: 0, minute: 540 }): ApplyContext => ({
  now, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, ...rules, ids: createIdFactory(`letters-${actor}`), playerCharacterId: ROME,
});

const world = (): WorldState => withCustoms(opening(), "syracuse", 3_000);
const person = (state: WorldState, id: string): Character => state.characters.find((c) => c.id === id)!;
const withMind = (state: WorldState, id: string, temperament: Partial<Character["mind"]["temperament"]>, drives: Partial<Character["mind"]["drives"]>): WorldState =>
  ({ ...state, characters: state.characters.map((c) => (c.id === id ? { ...c, traits: [], mind: { ...c.mind, temperament: { ...c.mind.temperament, ...temperament }, drives: { ...c.mind.drives, ...drives } } } : c)) });
const generous = (state: WorldState): WorldState => withMind(state, HIERON, { sociability: 95, honesty: 80 }, { wealth: 10, status: 10 });
const miser = (state: WorldState): WorldState => withMind(state, HIERON, { sociability: 5, honesty: 60 }, { wealth: 95, status: 95 });

/** Rome writes: the letter as the engine records it, sent today, on the road. */
function written(state: WorldState, to: string, more: Record<string, unknown> = {}) {
  const sent = applyDeltas(state, [WorldDeltaSchema.parse({
    op: "diplomatic_message_send", localId: "letter", kind: "letter", fromPolityId: "rome", fromCharacterRef: ROME,
    toPolityId: person(state, to).polityId, toCharacterRef: to, subject: "A word", terms: "Rome would have your friendship.",
    replyWithinDays: null, inReplyToRef: null, visibility: "private", reason: "The consul writes.", ...more,
  })], context(ROME));
  expect(sent.rejected).toEqual([]);
  return { world: sent.world, message: sent.world.diplomacy.at(-1)! };
}

const tradeOffer = (cap: number, more: Record<string, unknown> = {}) => ({
  kind: "trade_offer", subject: "A pact of trade", terms: "Rome proposes a pact of trade.", replyWithinDays: 60, visibility: "polity",
  trade: { tariffCapBps: cap, mostFavoured: false, exempt: [], goods: [] }, ...more,
});

/** A model that answers as scripted, and keeps what it was asked. */
function scripted(say: (reader: string, messageId: string) => WorldDelta[] | string) {
  const asked: { operation: SimOperation; user: string }[] = [];
  const port: SimModelPort = {
    complete(operation, _system, user) {
      asked.push({ operation, user });
      const messageId = /\[(message-[^\]]+)\]/.exec(user)?.[1] ?? "";
      const said = say(readerOf(user), messageId);
      return Promise.resolve(typeof said === "string" ? said : JSON.stringify({ actors: [{ actorRef: { kind: "character", id: readerOf(user) }, proposal: { deltas: said, facts: [] } }] }));
    },
  };
  return { port, asked };
}
/** The person a prompt is written for: the first id in the first section, which is his own. */
const readerOf = (user: string): string => /\[([a-z0-9-]+)\]/.exec(user)![1]!;

const answer = (messageId: string, how: "accepted" | "refused" | "countered", words: string, more: Record<string, unknown> = {}): WorldDelta =>
  WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: messageId, answer: how, answerText: words, reason: words, ...more });

const askNow = (state: WorldState, messageId: string, port: SimModelPort): Promise<Awaited<ReturnType<typeof answerALetterNow>>> =>
  answerALetterNow({ world: state, clock: definition.clock, offices: definition.government.offices, port, messageId, rules } satisfies LetterAnswerNowInput);

/** The story reaches the day the answer is due, and the engine gives it as the reader's own act. */
function delivered(held: WorldState) {
  const [due] = heldAnswersDue(advanceWorldTo(held, { day: held.diplomacy.at(-1)!.heldAnswer!.comesOnDay, minute: 540 }));
  const arrived = advanceWorldTo(held, { day: held.diplomacy.at(-1)!.heldAnswer!.comesOnDay, minute: 540 });
  expect(due).toBeDefined();
  const after = applyDeltas(arrived, due!.deltas, { ...context(due!.readerId, arrived.instant), now: arrived.instant });
  expect(after.rejected).toEqual([]);
  return { arrived, after, due: due! };
}

describe("a letter to a far ruler", () => {
  it("makes one call to the man it is written to, decides the answer now, and gives it when the road has been walked", async () => {
    const { world: sent, message } = written(world(), HIERON);
    const model = scripted((_r, id) => [answer(id, "accepted", "Hieron gives you his hand, and thanks you for the letter.")]);
    const result = await askNow(sent, message.id, model.port);

    expect(model.asked.map((entry) => entry.operation)).toEqual(["simulate_cognition"]);
    expect(result.status).toBe("decided");
    if (result.status !== "decided") return;
    expect(result.calls).toBe(1);
    expect(result.readerId).toBe(HIERON);
    // It is on the road: there and back, and until then nothing has been answered.
    const held = result.world.diplomacy.find((m) => m.id === message.id)!;
    expect(held.status).toBe("awaiting_reply");
    expect(held.heldAnswer?.comesOnDay).toBe(answerComesOn(message));
    expect(result.comesOnDay).toBeGreaterThanOrEqual(message.sentAtStep);
    // The model was shown it as put into his hands, and asked this one thing.
    expect(model.asked[0]!.user).toContain(`[${message.id}]`);
    expect(model.asked[0]!.user).toContain("Letters awaiting their answer");
    // On the day, the answer is the reader's own act, in the model's words.
    const { after } = delivered(result.world);
    expect(after.world.diplomacy.find((m) => m.id === message.id)).toMatchObject({ status: "answered", answer: "accepted", answerText: "Hieron gives you his hand, and thanks you for the letter." });
    expect(after.world.diplomacy.find((m) => m.id === message.id)!.heldAnswer).toBeUndefined();
  });

  it("is not asked about again by a round of the world: the letter is answered, and only waiting for its day", async () => {
    const { world: sent, message } = written(world(), HIERON);
    const model = scripted((_r, id) => [answer(id, "refused", "No.")]);
    const result = await askNow(sent, message.id, model.port);
    if (result.status !== "decided") throw new Error("not decided");
    const arrived = advanceWorldTo(result.world, { day: (message.deliveredOnDay ?? 0) + 1, minute: 540 });
    expect(lettersOwed(arrived, definition.clock).size).toBe(0);
    expect(aLetterWaitsOnItsReader(arrived)).toBe(false);
    // The walk of a burst stops on the day the answer comes back.
    expect(nextReplyDueKey(result.world, -1)).toBeDefined();
  });
});

describe("a letter to somebody who matters to nobody", () => {
  it("is answered by the model too: a background man, a clerk, a man nobody has met", async () => {
    const state = world();
    const background = state.characters.find((c) => c.alive && c.polityId === "syracuse" && c.id !== HIERON && c.officeId === null)
      ?? state.characters.find((c) => c.alive && c.polityId === "syracuse" && c.id !== HIERON)!;
    const { world: sent, message } = written(state, background.id);
    const model = scripted((_r, id) => [answer(id, "accepted", "I am honoured, and will remember it.")]);
    const result = await askNow(sent, message.id, model.port);
    expect(model.asked).toHaveLength(1);
    expect(result.status).toBe("decided");
    if (result.status === "decided") expect(result.readerId).toBe(background.id);
  });
});

describe("a trade letter where the model disagrees with the verdict", () => {
  it("is told what his books say, and what the model has him say stands: yes where the books say counter", async () => {
    // A cap far below the tariff, most-favoured and bread free: by his books he would haggle.
    const state = generous(world());
    const { world: sent, message } = written(state, HIERON, tradeOffer(300, { trade: { tariffCapBps: 300, mostFavoured: true, exempt: ["grain", "textiles"], goods: [] } }));
    const model = scripted((_r, id) => [answer(id, "accepted", "Agreed in every part: Syracuse takes the pact.")]);
    const result = await askNow(sent, message.id, model.port);
    expect(model.asked[0]!.user).toMatch(/interests and nature say/);
    expect(model.asked[0]!.user).toMatch(/counsel/);
    expect(result.status).toBe("decided");
    if (result.status !== "decided") return;
    expect(result.answer).toBe("accepted");
    expect(result.held).toBeNull();
    const { after } = delivered(result.world);
    const pact = agreementsBetween(after.world.polityAgreements, "rome", "syracuse").find((a) => a.kind === "trade_pact");
    expect(pact?.trade).toMatchObject({ tariffCapBps: 300, mostFavoured: true });
  });

  it("and the model's no stands where the books say yes: nothing is opened", async () => {
    const { world: sent, message } = written(generous(world()), HIERON, tradeOffer(2_500));
    const model = scripted((_r, id) => [answer(id, "refused", "Not this year; the treasury cannot spare it.")]);
    const result = await askNow(sent, message.id, model.port);
    if (result.status !== "decided") throw new Error("not decided");
    const { after } = delivered(result.world);
    expect(agreementsBetween(after.world.polityAgreements, "rome", "syracuse").some((a) => a.kind === "trade_pact")).toBe(false);
    expect(after.world.diplomacy.find((m) => m.id === message.id)).toMatchObject({ answer: "refused", answerText: "Not this year; the treasury cannot spare it." });
  });

  it("and the miser's yes stands too", async () => {
    const { world: sent, message } = written(miser(world()), HIERON, tradeOffer(300, { trade: { tariffCapBps: 300, mostFavoured: true, exempt: ["grain", "textiles", "oil_wine"], goods: [] } }));
    const model = scripted((_r, id) => [answer(id, "accepted", "Done.")]);
    const result = await askNow(sent, message.id, model.port);
    expect(result.status === "decided" && result.answer === "accepted").toBe(true);
  });

  it("is held only where it was not his to give: a letter to the wrong man is answered by pointing to the right one", async () => {
    const state = generous(world());
    const wrong = state.characters.find((c) => c.polityId === "syracuse" && c.alive && c.id !== HIERON && c.officeId === "syracusan-strategos")!;
    const { world: sent, message } = written(state, wrong.id, tradeOffer(2_500));
    expect(message.decidedBy).toBe(HIERON);
    const model = scripted((_r, id) => [answer(id, "accepted", "Agreed, gladly.")]);
    const result = await askNow(sent, message.id, model.port);
    expect(result.status).toBe("decided");
    if (result.status !== "decided") return;
    expect(result.answer).toBe("countered");
    expect(result.held).toMatch(/not his to decide/);
    const { after } = delivered(result.world);
    expect(agreementsBetween(after.world.polityAgreements, "rome", "syracuse").some((a) => a.kind === "trade_pact")).toBe(false);
  });
});

describe("a call that fails", () => {
  it("leaves the letter pending, as it always was, and says why", async () => {
    const { world: sent, message } = written(world(), HIERON);
    const down: SimModelPort = { complete: () => Promise.reject(new Error("the provider is down")) };
    const result = await askNow(sent, message.id, down);
    expect(result.status).toBe("undecided");
    if (result.status !== "undecided") return;
    expect(result.coins).toBe(false);
    // A provider that fails is tried once more, as every round of the world is (`runCognition`): both are counted.
    expect(result.calls).toBeGreaterThanOrEqual(1);
    const same = result.world.diplomacy.find((m) => m.id === message.id)!;
    expect(same.heldAnswer).toBeUndefined();
    expect(same.status).toBe("awaiting_reply");
    // And the next round that reaches him asks him, as before: that is the retry.
    const arrived = advanceWorldTo(result.world, { day: (message.deliveredOnDay ?? 0) + 1, minute: 540 });
    expect([...lettersOwed(arrived, definition.clock).keys()]).toContain(HIERON);
  });

  it("is not a call at all when the coin gate refuses, and the writer is told it was the coins", async () => {
    const { world: sent, message } = written(world(), HIERON);
    const refused: SimModelPort = { complete: () => Promise.reject(Object.assign(new Error("Not enough coins."), { name: "InsufficientCoinsError" })) };
    const result = await askNow(sent, message.id, refused);
    expect(result).toMatchObject({ status: "undecided", coins: true, calls: 0 });
  });

  it("keeps the letter pending when the model's answer cannot be read, or says nothing of this letter", async () => {
    const { world: sent, message } = written(world(), HIERON);
    const garbage = scripted(() => "not json at all");
    const unread = await askNow(sent, message.id, garbage.port);
    expect(unread.status).toBe("undecided");
    const silent = scripted(() => JSON.stringify({ actors: [] }));
    const nothing = await askNow(sent, message.id, silent.port);
    expect(nothing.status).toBe("undecided");
    expect(nothing.world.diplomacy.find((m) => m.id === message.id)!.heldAnswer).toBeUndefined();
  });

  it("is not promised to a reader who is dead: there is nobody to read it, and no call is made", async () => {
    const { world: sent, message } = written(world(), HIERON);
    const model = scripted((_r, id) => [answer(id, "accepted", "Yes.")]);
    const dead = { ...sent, characters: sent.characters.map((c) => (c.id === HIERON ? { ...c, alive: false, diedAtStep: sent.elapsedStep } : c)) };
    const gone = await askNow(dead, message.id, model.port);
    expect(gone).toMatchObject({ status: "undecided", calls: 0 });
    expect(model.asked).toHaveLength(0);
  });
});

describe("a letter held for its day, in a burst", () => {
  it("is given on the day the answer comes back, with no second call to its reader", async () => {
    const { world: sent, message } = written(generous(world()), HIERON, tradeOffer(2_500));
    const first = scripted((_r, id) => [answer(id, "accepted", "Syracuse takes the pact, and thanks Rome.")]);
    const decided = await askNow(sent, message.id, first.port);
    if (decided.status !== "decided") throw new Error("not decided");

    const asked: { operation: SimOperation; user: string }[] = [];
    const port: SimModelPort = { complete: (operation, _s, user) => { asked.push({ operation, user }); return Promise.resolve(JSON.stringify({ actors: [] })); } };
    const burst: BurstInput = {
      world: decided.world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
      burstId: "held", gameId: "game-letters", actorRef: { kind: "character", id: ROME }, actorPolityId: "rome", orderText: null, continuation: true,
      spanDays: Math.max(30, decided.comesOnDay - sent.instant.day + 10), knownFacts: [], queue: [], port,
    };
    const result = await runSimulationBurst(burst);
    const after = result.world.diplomacy.find((m) => m.id === message.id)!;
    expect(after).toMatchObject({ status: "answered", answer: "accepted", answerText: "Syracuse takes the pact, and thanks Rome." });
    expect(agreementsBetween(result.world.polityAgreements, "rome", "syracuse").some((a) => a.kind === "trade_pact")).toBe(true);
    // Nobody was asked the letter again: it is in no prompt as a letter awaiting its answer.
    const listed = new RegExp(String.raw`^\s+- \[${message.id}\] `, "m");
    expect(asked.some((entry) => listed.test(entry.user))).toBe(false);
  });

  it("returns to a pending letter, to be asked in a round, when its answer cannot be given on its day", async () => {
    const { world: sent, message } = written(world(), HIERON);
    const model = scripted((_r, id) => [answer(id, "accepted", "Yes.")]);
    const decided = await askNow(sent, message.id, model.port);
    if (decided.status !== "decided") throw new Error("not decided");
    // By the day it comes back its reader has died: the answer is not given, and the letter is as any unanswered one.
    const spoiled = { ...decided.world, characters: decided.world.characters.map((c) => (c.id === HIERON ? { ...c, alive: false, diedAtStep: sent.elapsedStep } : c)) };
    const port: SimModelPort = { complete: () => Promise.resolve(JSON.stringify({ actors: [] })) };
    const result = await runSimulationBurst({
      world: spoiled, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
      burstId: "held-2", gameId: "game-letters", actorRef: { kind: "character", id: ROME }, actorPolityId: "rome", orderText: null, continuation: true,
      spanDays: Math.max(30, decided.comesOnDay - sent.instant.day + 10), knownFacts: [], queue: [], port,
    });
    const same = result.world.diplomacy.find((m) => m.id === message.id)!;
    expect(same.heldAnswer).toBeUndefined();
    expect(same.answer === "accepted").toBe(false);
  });
});
