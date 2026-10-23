import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema, WorldDeltaSchema, advanceWorldTo, agreementsBetween, readTradeDesk, tradeTermsBetween, type Character, type WorldDelta, type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { holdAnswerToAuthority } from "./nature";
import { createIdFactory } from "./ports";
import { answerByRule, type StatecraftInput } from "./statecraft";
import { runDeterministicTick } from "./tick";
import { adviceOnALetter, letterVerdict } from "./letter-verdict";
import { trustOf } from "./treaties";
import { agreement, opening, withAgreements, withCustoms } from "./trade-test-kit";

/**
 * A trade pact is written for.
 *
 * Offering a trade pact or an embargo used to be a decree: `agreement_open`, with
 * nobody on the other side of it. It is now part of "Write to": the player puts
 * the terms in a letter to the person who decides trade in the other power, that
 * person answers by who he is and what his power stands to lose -- customs given
 * up, bread, trust, what already stands -- and only a yes opens the pact. A no
 * opens nothing, other terms come back as an offer of their own, a letter to
 * somebody who does not decide it is answered by pointing the writer to the one
 * who does, and an embargo is announced as a threat that is carried out when it
 * is refused or goes unanswered, not as a bargain.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const ROME = "gaius-genucius";
const HIERON = "hieron-ii";

const context = (actor: string, now = { day: 0, minute: 540 }): ApplyContext => ({
  now,
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`written-${actor}`),
  gameId: "game-written",
});

/** Syracuse lays a heavy tariff: a cap on it is real money given up. */
const world = (): WorldState => withCustoms(opening(), "syracuse", 3_000);

const withMind = (state: WorldState, id: string, temperament: Partial<Character["mind"]["temperament"]>, drives: Partial<Character["mind"]["drives"]>): WorldState =>
  ({ ...state, characters: state.characters.map((c) => (c.id === id ? { ...c, traits: [], mind: { ...c.mind, temperament: { ...c.mind.temperament, ...temperament }, drives: { ...c.mind.drives, ...drives } } } : c)) });
/** Open-handed and sociable: bears a good deal of customs given up. */
const generous = (state: WorldState): WorldState => withMind(state, HIERON, { sociability: 95, honesty: 80 }, { wealth: 10, status: 10 });
/** Grasping and cold: bears very little. */
const miser = (state: WorldState): WorldState => withMind(state, HIERON, { sociability: 5, honesty: 60 }, { wealth: 95, status: 95 });

const inputOf = (state: WorldState): StatecraftInput => ({ world: state, gameId: "written", excludedPolityIds: new Set(), playedByModel: new Set(), playerCharacterId: null, nearPlayer: null, pressures: [] });
const hieron = (state: WorldState): Character => state.characters.find((c) => c.id === HIERON)!;

const offer = (more: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse({
  op: "diplomatic_message_send", localId: "offer", kind: "trade_offer", fromPolityId: "rome", fromCharacterRef: ROME, toPolityId: "syracuse", toCharacterRef: HIERON,
  subject: "A pact of trade", terms: "Rome proposes a pact of trade.", replyWithinDays: 60, inReplyToRef: null, visibility: "polity", reason: "Clepsina writes to Hieron.",
  trade: { tariffCapBps: 2_500, mostFavoured: false, exempt: [], goods: [] },
  ...more,
});

/** Rome writes; the letter reaches the reader, who has had a month to take counsel (the longest a cautious man waits); the answer is the rule's. */
function put(state: WorldState, delta: WorldDelta) {
  const sent = applyDeltas(state, [delta], context(ROME));
  expect(sent.rejected).toEqual([]);
  const message = sent.world.diplomacy.at(-1)!;
  const arrived = advanceWorldTo(sent.world, { day: message.deliveredOnDay! + 30, minute: 540 });
  return { sent, message, arrived };
}

/** What Hieron would say, by rule, and the world after he says it. */
function answered(arrived: WorldState, messageId: string, who = HIERON) {
  const message = arrived.diplomacy.find((m) => m.id === messageId)!;
  const decision = answerByRule(arrived, message, inputOf(arrived), () => arrived.characters.find((c) => c.id === who));
  if (decision === null) return { decision, after: null };
  const after = applyDeltas(arrived, [...decision.deltas], { ...context(who, arrived.instant), now: arrived.instant });
  expect(after.rejected).toEqual([]);
  return { decision, after };
}

const pactBetween = (state: WorldState) => agreementsBetween(state.polityAgreements, "rome", "syracuse").find((a) => a.kind === "trade_pact");
const embargoBetween = (state: WorldState) => agreementsBetween(state.polityAgreements, "rome", "syracuse").find((a) => a.kind === "embargo");

describe("a trade pact is written for", () => {
  it("is only a letter when it is sent: nothing is agreed until it is answered", () => {
    const { sent, message } = put(generous(world()), offer({ forDays: 1_825 }));
    expect(message.kind).toBe("trade_offer");
    expect(message.trade?.tariffCapBps).toBe(2_500);
    expect(message.forDays).toBe(1_825);
    expect(pactBetween(sent.world)).toBeUndefined();
    expect(tradeTermsBetween(sent.world, "rome", "syracuse").pact).toBeNull();
  });

  it("opens the pact, with the terms written, when the king says yes", () => {
    const { message, arrived } = put(generous(world()), offer({ trade: { tariffCapBps: 2_500, mostFavoured: false, exempt: ["grain"], goods: [] }, forDays: 1_825 }));
    const { decision, after } = answered(arrived, message.id);
    expect(decision?.deltas[0]).toMatchObject({ op: "diplomatic_message_answer", answer: "accepted" });
    const pact = pactBetween(after!.world)!;
    expect(pact.trade).toMatchObject({ tariffCapBps: 2_500, exempt: ["grain"], mostFavoured: false });
    expect(pact.sourceMessageId).toBe(message.id);
    expect(pact.untilStep).toBe(arrived.elapsedStep + 1_825);
    expect(after!.world.diplomacy.find((m) => m.id === message.id)).toMatchObject({ status: "answered", answer: "accepted", agreementId: pact.id });
    expect(tradeTermsBetween(after!.world, "rome", "syracuse").pact?.tariffCapBps).toBe(2_500);
  });

  it("answers by who the king is: the same letter is taken by an open hand and turned down by a tight one", () => {
    const ask = offer({ trade: { tariffCapBps: 300, mostFavoured: true, exempt: ["grain", "textiles", "oil_wine"], goods: [] } });
    const open = put(generous(world()), ask);
    const tight = put(miser(world()), ask);
    const yes = answered(open.arrived, open.message.id);
    const no = answered(tight.arrived, tight.message.id);
    // He would haggle but he does not shut the door; the other will not sign what costs him so much.
    expect(yes.decision?.deltas[0]).toMatchObject({ answer: "countered" });
    expect(no.decision?.deltas[0]).toMatchObject({ answer: "refused" });
    expect(pactBetween(no.after!.world)).toBeUndefined();
    // And the same man says the same thing every time he is asked.
    const again = answered(open.arrived, open.message.id);
    expect(JSON.stringify(again.decision?.deltas)).toBe(JSON.stringify(yes.decision?.deltas));
  });

  it("comes back with other terms when the king would deal on them, and only the writer's yes to those opens the pact", () => {
    const { message, arrived } = put(generous(world()), offer({ trade: { tariffCapBps: 500, mostFavoured: true, exempt: ["grain", "textiles"], goods: [] } }));
    const { decision, after } = answered(arrived, message.id);
    const delta = decision!.deltas[0] as Extract<WorldDelta, { op: "diplomatic_message_answer" }>;
    expect(delta.answer).toBe("countered");
    expect(delta.counterTrade).toBeDefined();
    // His cap is above the one asked and under his own rate, and he gave away the most-favoured status.
    expect(delta.counterTrade!.tariffCapBps!).toBeGreaterThan(500);
    expect(delta.counterTrade!.tariffCapBps!).toBeLessThan(3_000);
    expect(delta.counterTrade!.mostFavoured).toBe(false);
    // Nothing is agreed yet: the answer is a letter back, which is Rome's to take.
    expect(pactBetween(after!.world)).toBeUndefined();
    const back = after!.world.diplomacy.at(-1)!;
    expect(back).toMatchObject({ kind: "trade_offer", fromPolityId: "syracuse", toPolityId: "rome", toCharacterId: ROME, inReplyToMessageId: message.id });
    expect(back.trade).toEqual(delta.counterTrade);
    expect(after!.world.diplomacy.find((m) => m.id === message.id)).toMatchObject({ status: "answered", answer: "countered" });
    // Rome takes the new terms.
    const reply = advanceWorldTo(after!.world, { day: back.deliveredOnDay!, minute: 540 });
    const taken = applyDeltas(reply, [WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: back.id, answer: "accepted", answerText: "Rome agrees.", reason: "Rome agrees." })], { ...context(ROME, reply.instant), now: reply.instant });
    expect(taken.rejected).toEqual([]);
    expect(pactBetween(taken.world)!.trade?.tariffCapBps).toBe(delta.counterTrade!.tariffCapBps);
  });

  it("does not counter a counter: a bargain is at most two letters", () => {
    const { message, arrived } = put(generous(world()), offer({ trade: { tariffCapBps: 500, mostFavoured: false, exempt: [], goods: [] } }));
    const first = answered(arrived, message.id);
    const back = first.after!.world.diplomacy.at(-1)!;
    // Rome writes the king's terms back to him, a little worse for him: he takes it or leaves it.
    const lower = { ...back, fromPolityId: "rome", toPolityId: "syracuse", fromCharacterId: ROME, toCharacterId: HIERON, trade: { tariffCapBps: 500, mostFavoured: false, exempt: [], goods: [] } };
    const state = { ...first.after!.world, diplomacy: [...first.after!.world.diplomacy.slice(0, -1), lower] };
    const verdict = letterVerdict(state, lower, hieron(state));
    expect(verdict?.counter).toBeUndefined();
  });

  it("refuses to sign over a war, and a refusal opens nothing", () => {
    const warring = withAgreements(generous(world()), agreement("war", "rome", "syracuse"));
    const { message, arrived } = put(warring, offer({}));
    const { decision, after } = answered(arrived, message.id);
    expect(decision?.deltas[0]).toMatchObject({ answer: "refused" });
    expect(pactBetween(after!.world)).toBeUndefined();
    expect(after!.world.diplomacy.find((m) => m.id === message.id)).toMatchObject({ status: "answered", answer: "refused" });
    expect((decision!.deltas[0] as { answerText: string }).answerText).toMatch(/war|cross/i);
  });

  it("is warmer to a neighbour it trusts, and cooler to one it does not", () => {
    const base = generous(world());
    const asked = { trade: { tariffCapBps: 1_500, mostFavoured: false, exempt: [], goods: [] } };
    const trusted = { ...base, polityStances: [{ polityId: "syracuse", towardPolityId: "rome", trustScore: 60, lastShiftReason: "friends", lastShiftAtStep: 0 }] };
    const distrusted = { ...base, polityStances: [{ polityId: "syracuse", towardPolityId: "rome", trustScore: -60, lastShiftReason: "enemies", lastShiftAtStep: 0 }] };
    const warm = put(trusted, offer(asked));
    const cold = put(distrusted, offer(asked));
    expect(answered(warm.arrived, warm.message.id).decision?.deltas[0]).toMatchObject({ answer: "accepted" });
    expect(answered(cold.arrived, cold.message.id).decision?.deltas[0]).toMatchObject({ answer: "refused" });
  });

  it("takes free bread gladly when its own people are short of it, and haggles over it when they are not", () => {
    // Every hub's granary at a third of what it ought to hold.
    const bare = (state: WorldState): WorldState => ({
      ...state,
      economy: { ...state.economy!, markets: state.economy!.markets.map((hub) => ({ ...hub, goods: hub.goods.map((entry) => (entry.good === "grain" ? { ...entry, stock: Math.round(entry.target * 0.3) } : entry)) })) },
    });
    const ask = offer({ trade: { tariffCapBps: 2_000, mostFavoured: false, exempt: ["grain"], goods: [] } });
    const fed = put(miser(world()), ask);
    const starving = put(bare(miser(world())), ask);
    expect(answered(fed.arrived, fed.message.id).decision?.deltas[0]).toMatchObject({ answer: "countered" });
    expect(answered(starving.arrived, starving.message.id).decision?.deltas[0]).toMatchObject({ answer: "accepted" });
  });

  it("revises the pact that stands, in place, when the revision is accepted", () => {
    const standing = withAgreements(generous(world()), agreement("trade_pact", "rome", "syracuse", { trade: { tariffCapBps: 2_800, mostFavoured: false, exempt: [], goods: [] } }));
    const { message, arrived } = put(standing, offer({ subject: "Better terms for our pact", trade: { tariffCapBps: 2_400, mostFavoured: false, exempt: [], goods: [] } }));
    const { after } = answered(arrived, message.id);
    const pacts = agreementsBetween(after!.world.polityAgreements, "rome", "syracuse").filter((a) => a.kind === "trade_pact");
    expect(pacts).toHaveLength(1);
    expect(pacts[0]!.id).toBe("trade_pact_rome_syracuse");
    expect(pacts[0]!.trade?.tariffCapBps).toBe(2_400);
    expect(pacts[0]!.sourceMessageId).toBe(message.id);
    expect(after!.factProposals.some((fact) => fact.kind === "treaty_amended")).toBe(true);
  });

  it("lifts an embargo the king laid when the pact he accepts is written over it", () => {
    const shut = withAgreements(generous(world()), agreement("embargo", "syracuse", "rome", { trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] } }));
    expect(tradeTermsBetween(shut, "rome", "syracuse").closed).toBe("embargo");
    // He laid it himself and is not easy to move: a tight hand will not, a friend will.
    const kind = put(shut, offer({ subject: "Lift your embargo", trade: { tariffCapBps: 2_900, mostFavoured: false, exempt: [], goods: [] } }));
    const friendly = { ...kind.arrived, polityStances: [{ polityId: "syracuse", towardPolityId: "rome", trustScore: 80, lastShiftReason: "friends", lastShiftAtStep: 0 }] };
    const lifted = answered(friendly, kind.message.id);
    expect(lifted.decision?.deltas[0]).toMatchObject({ answer: "accepted" });
    expect(embargoBetween(lifted.after!.world)).toBeUndefined();
    expect(tradeTermsBetween(lifted.after!.world, "rome", "syracuse").closed).toBeNull();
    const cold = put(withAgreements(miser(world()), agreement("embargo", "syracuse", "rome", { trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] } })), offer({ trade: { tariffCapBps: 500, mostFavoured: false, exempt: [], goods: [] } }));
    expect(answered(cold.arrived, cold.message.id).decision?.deltas[0]).toMatchObject({ answer: "refused" });
  });
});

describe("a letter to the wrong man", () => {
  const general = (state: WorldState): Character => state.characters.find((c) => c.polityId === "syracuse" && c.alive && c.id !== HIERON && c.officeId === "syracusan-strategos")!;

  it("is stamped with who does decide it, and is answered by pointing there", () => {
    const state = generous(world());
    const wrong = general(state);
    const { message, arrived } = put(state, offer({ toCharacterRef: wrong.id }));
    expect(message.decidedBy).toBe(HIERON);
    const { decision, after } = answered(arrived, message.id, wrong.id);
    const delta = decision!.deltas[0] as Extract<WorldDelta, { op: "diplomatic_message_answer" }>;
    // Neither a yes nor a no: he does not speak for Syracuse in this, and says who does.
    expect(delta.answer).toBe("countered");
    expect(delta.counterTrade).toBeUndefined();
    expect(delta.answerText).toContain("Hieron II");
    expect(pactBetween(after!.world)).toBeUndefined();
    // No offer of his own goes back, and the writer loses no trust for having written to the wrong man.
    expect(after!.world.diplomacy.filter((m) => m.kind === "trade_offer")).toHaveLength(1);
    expect(trustOf(after!.world, "rome", "syracuse")).toBeGreaterThanOrEqual(trustOf(arrived, "rome", "syracuse"));
  });

  it("is not stamped when it goes to the one who decides", () => {
    expect(put(generous(world()), offer({})).message.decidedBy).toBeUndefined();
  });

  it("holds a model's yes to a pact it was not his to give: the one hard impossibility the engine keeps", () => {
    const state = generous(world());
    const wrong = general(state);
    const { message, arrived } = put(state, offer({ toCharacterRef: wrong.id }));
    const model = WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: message.id, answer: "accepted", answerText: "Agreed, gladly.", reason: "Agreed." });
    const held = holdAnswerToAuthority(arrived, wrong.id, model);
    expect(held.act).toMatchObject({ op: "diplomatic_message_answer", answer: "countered" });
    expect(held.act).not.toHaveProperty("counterTrade");
    expect(held.brought).toMatch(/not his to decide/);
    // Terms of his own, from a man who does not decide it, are dropped as well; only the pointing is left.
    const terms = WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: message.id, answer: "countered", answerText: "Write to Hieron II instead.", reason: "Not mine.", counterTrade: { tariffCapBps: 900, mostFavoured: false, exempt: [], goods: [] } });
    expect(holdAnswerToAuthority(arrived, wrong.id, terms).act).not.toHaveProperty("counterTrade");
    // And the same yes from the one who does decide is not held.
    expect(holdAnswerToAuthority(arrived, HIERON, model)).toEqual({ act: model, brought: null });
  });
});

describe("a model's answer to an offer of trade", () => {
  it("stands as the model wrote it when it is not what his books say: the verdict is only counsel", () => {
    const { message, arrived } = put(generous(world()), offer({ trade: { tariffCapBps: 500, mostFavoured: true, exempt: ["grain", "textiles"], goods: [] } }));
    const model = WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: message.id, answer: "accepted", answerText: "Agreed in every part.", reason: "Agreed." });
    // By his books he would sign on other terms: that is what the model is told.
    const verdict = letterVerdict(arrived, arrived.diplomacy.find((m) => m.id === message.id)!, hieron(arrived))!;
    expect(verdict.counter).toBeDefined();
    expect(adviceOnALetter(verdict)).toMatch(/counsel/);
    // But the model had him accept, and he accepts: the answer is not turned into a counter.
    const held = holdAnswerToAuthority(arrived, HIERON, model);
    expect(held).toEqual({ act: model, brought: null });
    const after = applyDeltas(arrived, [held.act], { ...context(HIERON, arrived.instant), now: arrived.instant });
    expect(after.rejected).toEqual([]);
    expect(pactBetween(after.world)).toMatchObject({ trade: { tariffCapBps: 500, mostFavoured: true } });
  });

  it("opens no pact when the model refuses what his books would have signed", () => {
    const { message, arrived } = put(generous(world()), offer({}));
    const verdict = letterVerdict(arrived, arrived.diplomacy.find((m) => m.id === message.id)!, hieron(arrived))!;
    expect(verdict.accepted).toBe(true);
    const model = WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: message.id, answer: "refused", answerText: "Not now.", reason: "Not now." });
    const held = holdAnswerToAuthority(arrived, HIERON, model);
    expect(held.act).toEqual(model);
    const after = applyDeltas(arrived, [held.act], { ...context(HIERON, arrived.instant), now: arrived.instant });
    expect(pactBetween(after.world)).toBeUndefined();
    expect(after.world.diplomacy.find((m) => m.id === message.id)).toMatchObject({ status: "answered", answer: "refused" });
  });
});

describe("an embargo is announced", () => {
  const notice = (more: Record<string, unknown> = {}): WorldDelta => offer({
    kind: "embargo_notice", subject: "Open your markets to our merchants, or ours are shut to yours",
    terms: "Rome asks that Syracuse lower its customs on Roman goods. If it will not, Rome shuts its markets to Syracuse.",
    trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: ["grain"] }, ...more,
  });

  it("is a threat and not a bargain: sending it lays nothing, and it carries its own consequence", () => {
    const { sent, message } = put(generous(world()), notice());
    expect(message.onRefusal).toBe("embargo");
    expect(message.proposes ?? []).toEqual([]);
    expect(embargoBetween(sent.world)).toBeUndefined();
    expect(tradeTermsBetween(sent.world, "rome", "syracuse").closed).toBeNull();
  });

  it("is laid when it is refused, by the power that gave it, on the goods it named", () => {
    const { message, arrived } = put(miser(world()), notice());
    const { decision, after } = answered(arrived, message.id);
    expect(decision?.deltas[0]).toMatchObject({ answer: "refused" });
    const embargo = embargoBetween(after!.world)!;
    expect(embargo).toMatchObject({ polityId: "rome", otherPolityId: "syracuse", sourceMessageId: message.id });
    expect(embargo.trade?.goods).toEqual(["grain"]);
    expect(tradeTermsBetween(after!.world, "rome", "syracuse").forbidden).toEqual(["grain"]);
    expect(after!.factProposals.some((fact) => fact.kind === "embargo_laid")).toBe(true);
  });

  it("is not laid when the demand is met, and is not laid twice", () => {
    // A king whose markets live by Rome's trade, and who is not proud, gives way.
    const frightened = withMind(world(), HIERON, { sociability: 70, honesty: 70 }, { wealth: 30, status: 5, revenge: 5, duty: 5, security: 95 });
    const laden: WorldState = { ...frightened, economy: { ...frightened.economy!, tradeLanes: [{ fromPolityId: "rome", toPolityId: "syracuse", value: 9_000 }, { fromPolityId: "syracuse", toPolityId: "rome", value: 4_000 }] } };
    const { message, arrived } = put(laden, notice({ trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] } }));
    const { decision, after } = answered(arrived, message.id);
    expect(decision?.deltas[0]).toMatchObject({ answer: "accepted" });
    expect(embargoBetween(after!.world)).toBeUndefined();
    expect(after!.world.diplomacy.find((m) => m.id === message.id)).toMatchObject({ answer: "accepted" });
  });

  it("is laid when the answer never comes", () => {
    const { sent, message } = put(generous(world()), notice({ replyWithinDays: 30, trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] } }));
    const due = message.replyDueByStep!;
    const read = { ...sent.world, elapsedStep: due, diplomacy: sent.world.diplomacy.map((m) => ({ ...m, putToRecipientOnDay: 1 })) };
    const ticked = runDeterministicTick({ world: read, toDay: due, ids: createIdFactory("embargo-silence"), warfare: definition.warfare });
    expect(embargoBetween(ticked.world)).toMatchObject({ polityId: "rome", otherPolityId: "syracuse", sourceMessageId: message.id });
    expect(tradeTermsBetween(ticked.world, "rome", "syracuse").closed).toBe("embargo");
    expect(ticked.factProposals.some((fact) => fact.kind === "embargo_laid")).toBe(true);
  });

  it("breaks the pact that stood, and costs the embargoer trust, when it is carried out", () => {
    const pact = agreement("trade_pact", "rome", "syracuse", { trade: { tariffCapBps: 2_000, mostFavoured: false, exempt: [], goods: [] } });
    const { message, arrived } = put(miser(withAgreements(world(), pact)), notice({ trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] } }));
    const before = trustOf(arrived, "syracuse", "rome");
    const { after } = answered(arrived, message.id);
    expect(pactBetween(after!.world)).toBeUndefined();
    expect(embargoBetween(after!.world)).toBeDefined();
    expect(trustOf(after!.world, "syracuse", "rome")).toBeLessThan(before);
  });

  it("is not offered while the war has closed the border, or an embargo already stands", () => {
    const state = world();
    expect(readTradeDesk(state, ROME, definition.government.offices).powers.find((p) => p.polityId === "syracuse")!.proposals.embargo.allowed).toBe(true);
    const shut = withAgreements(state, agreement("embargo", "rome", "syracuse"));
    expect(readTradeDesk(shut, ROME, definition.government.offices).powers.find((p) => p.polityId === "syracuse")!.proposals.embargo.why).toMatch(/already laid/);
    const war = withAgreements(state, agreement("war", "rome", "syracuse"));
    expect(readTradeDesk(war, ROME, definition.government.offices).powers.find((p) => p.polityId === "syracuse")!.proposals.embargo.allowed).toBe(false);
  });
});

describe("the sheet says who decides, and starts the terms from what stands", () => {
  const desk = (state: WorldState) => readTradeDesk(state, ROME, definition.government.offices);

  it("names the one who answers for each power, and why", () => {
    const syracuse = desk(world()).powers.find((p) => p.polityId === "syracuse")!;
    expect(syracuse.addressee).toMatchObject({ characterId: HIERON, name: "Hieron II" });
    expect(syracuse.addressee!.why.length).toBeGreaterThan(10);
    // It is the very person the engine addresses a letter to a power to.
    const { message } = put(world(), offer({ toCharacterRef: null }));
    expect(message.toCharacterId).toBe(syracuse.addressee!.characterId);
  });

  it("starts a new pact from the player's own customs, and a revision from the pact that stands", () => {
    const fresh = desk(withCustoms(world(), "rome", 1_600)).powers.find((p) => p.polityId === "syracuse")!;
    expect(fresh.proposals.pact.start.tariffCapBps).toBe(800);
    expect(fresh.proposals.revise.allowed).toBe(false);
    const carthage = desk(world()).powers.find((p) => p.polityId === "carthage")!;
    expect(carthage.pact?.tariffCapBps).toBe(500);
    expect(carthage.proposals.pact.allowed).toBe(false);
    expect(carthage.proposals.revise).toMatchObject({ allowed: true, start: { tariffCapBps: 400 } });
  });

  it("offers to lift only an embargo the other has laid on you", () => {
    const state = withAgreements(world(), agreement("embargo", "syracuse", "rome"));
    const syracuse = desk(state).powers.find((p) => p.polityId === "syracuse")!;
    expect(syracuse.embargoOnUs).toEqual({ goods: [] });
    expect(syracuse.proposals.lift.allowed).toBe(true);
    expect(desk(world()).powers.find((p) => p.polityId === "syracuse")!.proposals.lift.allowed).toBe(false);
  });

  it("says when the player does not speak for his government", () => {
    expect(desk(world()).speaksForUs.yes).toBe(true);
    const private_ = readTradeDesk(world(), "manius-curius", definition.government.offices);
    expect(private_.speaksForUs.yes).toBe(false);
    expect(private_.speaksForUs.why).toMatch(/government/);
  });
});
