import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { executeWorkflow } from "../executor";
import type { WorldState } from "../../world/world-state";

// A letter is a real object in the world. The regression these guard: a
// player writing to a neighbouring power had nothing his order could become,
// so it was filed as an unsupported attempt and nobody ever answered him.

const world = (): WorldState => structuredClone(firstPunicWarScenario.initialWorld);

const SENDER = "marcus-atilius";
const ROME = "rome";
const CARTHAGE = "carthage";
const HANNO = "hanno";

function send(w: WorldState, overrides: Record<string, unknown> = {}) {
  return executeWorkflow(
    {
      actionId: "send_diplomatic_message",
      actorId: SENDER,
      parameters: {
        messageId: "msg-1",
        kind: "alliance_offer",
        fromPolityId: ROME,
        fromCharacterId: SENDER,
        toPolityId: CARTHAGE,
        toCharacterId: HANNO,
        subject: "Common cause against the Mamertines",
        terms: "Rome proposes a joint understanding over Messana.",
        ...overrides,
      },
    },
    w,
    1,
  );
}

describe("sending a diplomatic message", () => {
  it("records the approach and leaves it awaiting an answer", () => {
    const outcome = send(world());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const message = outcome.world.diplomacy.find((candidate) => candidate.id === "msg-1");
    expect(message?.status).toBe("awaiting_reply");
    expect(message?.answer).toBeNull();
  });

  it("decides nothing on the recipient's behalf", () => {
    const outcome = send(world());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // No alliance, no treaty, no change to any relation: an offer is an offer.
    const before = world();
    expect(outcome.world.map.politicalRelations).toEqual(before.map.politicalRelations);
    expect(outcome.world.conflicts).toEqual(before.conflicts);
  });

  it("succeeds even for a sender who does not belong to the power they write for", () => {
    const outcome = send(world(), { fromPolityId: CARTHAGE, toPolityId: "syracuse", toCharacterId: null });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.diplomacy.find((candidate) => candidate.id === "msg-1")?.fromPolityId).toBe(CARTHAGE);
  });

  it("succeeds sending to a recipient who is no longer alive", () => {
    const w = world();
    w.characters = w.characters.map((character) =>
      character.id === HANNO ? { ...character, alive: false, diedAtStep: 0 } : character,
    );
    const outcome = send(w);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.diplomacy.find((candidate) => candidate.id === "msg-1")?.toCharacterId).toBe(HANNO);
  });
});

describe("answering one", () => {
  const sent = () => {
    const outcome = send(world());
    if (!outcome.ok) throw new Error("setup failed");
    return outcome.world;
  };

  it("closes the message with the recipient's own answer", () => {
    const outcome = executeWorkflow(
      {
        actionId: "answer_diplomatic_message",
        actorId: HANNO,
        parameters: {
          messageId: "msg-1",
          answer: "refused",
          answeredByCharacterId: HANNO,
          answerText: "Carthage has no interest in Roman arrangements over Sicilian ground.",
        },
      },
      sent(),
      2,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const message = outcome.world.diplomacy[0];
    expect(message?.status).toBe("answered");
    expect(message?.answer).toBe("refused");
    expect(message?.answeredAtStep).toBe(2);
  });

  it("succeeds even for someone speaking for the wrong power", () => {
    const outcome = executeWorkflow(
      {
        actionId: "answer_diplomatic_message",
        actorId: SENDER,
        parameters: { messageId: "msg-1", answer: "accepted", answeredByCharacterId: SENDER, answerText: "Rome accepts its own offer." },
      },
      sent(),
      2,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.world.diplomacy.find((candidate) => candidate.id === "msg-1")?.status).toBe("answered");
  });

  it("lists what is actually awaiting a reply when the id is wrong", () => {
    const outcome = executeWorkflow(
      {
        actionId: "answer_diplomatic_message",
        actorId: HANNO,
        parameters: { messageId: "msg-nonexistent", answer: "accepted", answeredByCharacterId: HANNO, answerText: "Yes." },
      },
      sent(),
      2,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("msg-1");
  });
});
