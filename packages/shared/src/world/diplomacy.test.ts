import { describe, expect, it } from "vitest";
import { applyDiplomaticAnswerToStance, deriveDiplomaticEscalations, type DiplomaticMessage, type PolityStance } from "./diplomacy";

// Regression: a rejected ultimatum used to have nothing tracking it -- the
// offended power's only reaction was whatever the Game Master happened to
// improvise, which in practice was often nothing at all, turn after turn.
// This pins the deterministic, fact-only escalation trigger down: it must
// fire on a real repeated refusal and never on a single one, an accepted
// message, or an unrelated thread.

function message(overrides: Partial<DiplomaticMessage> & { id: string }): DiplomaticMessage {
  return {
    kind: "ultimatum",
    fromPolityId: "carthage",
    fromCharacterId: "hanno",
    toPolityId: "rome",
    toCharacterId: null,
    subject: "Withdraw from Sicily",
    terms: "Carthage demands Rome withdraw its forces from Sicily immediately.",
    sentAtStep: 1,
    replyDueByStep: null,
    status: "awaiting_reply",
    answer: null,
    answerText: null,
    answeredAtStep: null,
    inReplyToMessageId: null,
    visibility: "polity",
    ...overrides,
  };
}

describe("deriveDiplomaticEscalations", () => {
  it("does not fire on a single refusal", () => {
    const messages = [message({ id: "m1", status: "answered", answer: "refused", answeredAtStep: 2 })];
    expect(deriveDiplomaticEscalations(messages, 2)).toEqual([]);
  });

  it("does not fire on an accepted message, however many prior refusals exist on other threads", () => {
    const messages = [message({ id: "m1", status: "answered", answer: "accepted", answeredAtStep: 2 })];
    expect(deriveDiplomaticEscalations(messages, 2)).toEqual([]);
  });

  it("fires when the same fromPolity/toPolity thread has now been refused twice in a row", () => {
    const messages = [
      message({ id: "m1", status: "answered", answer: "refused", answeredAtStep: 1 }),
      message({ id: "m2", inReplyToMessageId: "m1", status: "answered", answer: "refused", answeredAtStep: 2 }),
    ];
    const escalations = deriveDiplomaticEscalations(messages, 2);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      senderCharacterId: "hanno",
      senderPolityId: "carthage",
      recipientPolityId: "rome",
      refusalCount: 2,
      messageId: "m2",
    });
  });

  it("counts being ignored the same as being refused", () => {
    const messages = [
      message({ id: "m1", status: "answered", answer: "ignored", answeredAtStep: 1 }),
      message({ id: "m2", inReplyToMessageId: "m1", status: "answered", answer: "refused", answeredAtStep: 2 }),
    ];
    expect(deriveDiplomaticEscalations(messages, 2)[0]?.refusalCount).toBe(2);
  });

  it("counts a longer chain correctly and only reports it once, on the newest link", () => {
    const messages = [
      message({ id: "m1", status: "answered", answer: "refused", answeredAtStep: 1 }),
      message({ id: "m2", inReplyToMessageId: "m1", status: "answered", answer: "refused", answeredAtStep: 3 }),
      message({ id: "m3", inReplyToMessageId: "m2", status: "answered", answer: "refused", answeredAtStep: 5 }),
    ];
    const escalations = deriveDiplomaticEscalations(messages, 5);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.messageId).toBe("m3");
    expect(escalations[0]?.refusalCount).toBe(3);
  });

  it("stops counting once the chain crosses to a different power pair", () => {
    const messages = [
      message({ id: "m1", fromPolityId: "syracuse", toPolityId: "rome", status: "answered", answer: "refused", answeredAtStep: 1 }),
      message({ id: "m2", inReplyToMessageId: "m1", fromPolityId: "carthage", toPolityId: "rome", status: "answered", answer: "refused", answeredAtStep: 2 }),
    ];
    // m2 replies to m1, but m1 is a different sender -- the thread does not
    // carry across powers, so this is still just one refusal for Carthage.
    expect(deriveDiplomaticEscalations(messages, 2)).toEqual([]);
  });

  it("only reports escalations answered this exact step, not old history replayed every turn", () => {
    const messages = [
      message({ id: "m1", status: "answered", answer: "refused", answeredAtStep: 1 }),
      message({ id: "m2", inReplyToMessageId: "m1", status: "answered", answer: "refused", answeredAtStep: 2 }),
    ];
    // Same messages, but asking about a later step: nothing was answered
    // *this* step, so nothing should fire again.
    expect(deriveDiplomaticEscalations(messages, 6)).toEqual([]);
  });

  it("ignores a message still awaiting a reply", () => {
    const messages = [message({ id: "m1", status: "awaiting_reply" })];
    expect(deriveDiplomaticEscalations(messages, 1)).toEqual([]);
  });
});

// Regression: a thread that went quiet used to leave no trace once it
// stopped being "the most recent reply" -- a Game Master reading turn thirty
// had no way to see the accumulated weight of thirty turns of behaviour, only
// whatever the last message happened to say. PolityStance is the accumulator.

describe("applyDiplomaticAnswerToStance", () => {
  it("does nothing for a message with no answer yet", () => {
    const msg = message({ id: "m1", status: "awaiting_reply" });
    expect(applyDiplomaticAnswerToStance([], msg, 1)).toEqual([]);
  });

  it("raises the sender's trust in the recipient on acceptance", () => {
    const msg = message({ id: "m1", status: "answered", answer: "accepted", answeredAtStep: 1 });
    const stances = applyDiplomaticAnswerToStance([], msg, 1);
    expect(stances).toHaveLength(1);
    expect(stances[0]).toMatchObject({ polityId: "carthage", towardPolityId: "rome" });
    expect(stances[0]?.trustScore).toBeGreaterThan(0);
  });

  it("lowers the sender's trust in the recipient on refusal, and further on being ignored", () => {
    const refused = applyDiplomaticAnswerToStance([], message({ id: "m1", status: "answered", answer: "refused", answeredAtStep: 1 }), 1);
    expect(refused[0]?.trustScore).toBeLessThan(0);

    const ignored = applyDiplomaticAnswerToStance([], message({ id: "m1", status: "answered", answer: "ignored", answeredAtStep: 1 }), 1);
    expect(ignored[0]?.trustScore).toBeLessThan(refused[0]!.trustScore);
  });

  it("accumulates across repeated answers rather than resetting each time", () => {
    let stances: readonly PolityStance[] = [];
    for (let step = 1; step <= 3; step++) {
      stances = applyDiplomaticAnswerToStance(stances, message({ id: `m${step}`, status: "answered", answer: "refused", answeredAtStep: step }), step);
    }
    expect(stances).toHaveLength(1);
    // Three refusals in a row should be more negative than one.
    const single = applyDiplomaticAnswerToStance([], message({ id: "m1", status: "answered", answer: "refused", answeredAtStep: 1 }), 1)[0]!.trustScore;
    expect(stances[0]?.trustScore).toBeLessThan(single);
    expect(stances[0]?.lastShiftAtStep).toBe(3);
  });

  it("is directed: the recipient's trust in the sender is untouched by the recipient's own answer", () => {
    const msg = message({ id: "m1", status: "answered", answer: "accepted", answeredAtStep: 1 });
    const stances = applyDiplomaticAnswerToStance([], msg, 1);
    expect(stances.find((s) => s.polityId === "rome" && s.towardPolityId === "carthage")).toBeUndefined();
  });

  it("clamps to the -100..100 range rather than drifting unbounded", () => {
    let stances: readonly PolityStance[] = [];
    for (let step = 1; step <= 20; step++) {
      stances = applyDiplomaticAnswerToStance(stances, message({ id: `m${step}`, status: "answered", answer: "accepted", answeredAtStep: step }), step);
    }
    expect(stances[0]?.trustScore).toBeLessThanOrEqual(100);
  });
});
