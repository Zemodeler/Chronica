import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas, createIdFactory, type SimModelPort } from "@chronica/sim";
import { answerNewLetters } from "./letter-answer-now";

/**
 * The letter route, below the database: what a letter does the moment it is sent.
 *
 * Writing is asking, as speaking is: each letter the player has just written is
 * put in its reader's hands by the model at once, whoever he is. The answer is
 * decided now and kept for its day; the player is told how many days; and where
 * the call fails or the coins are short the letter is pending, as it always was.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const ROME = "gaius-genucius";
const HIERON = "hieron-ii";
const rules = { warfare: definition.warfare, terrains: definition.map.terrains, gameId: "game-web-letters" };
const offices = definition.government.offices;
const before = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

function written(world: WorldState, to: string): WorldState {
  const sent = applyDeltas(world, [WorldDeltaSchema.parse({
    op: "diplomatic_message_send", localId: "letter", kind: "letter", fromPolityId: "rome", fromCharacterRef: ROME,
    toPolityId: world.characters.find((c) => c.id === to)!.polityId, toCharacterRef: to, subject: "A word", terms: "Rome would have your friendship.",
    replyWithinDays: null, inReplyToRef: null, visibility: "private", reason: "The consul writes.",
  })], { now: world.instant, actorRef: { kind: "character", id: ROME }, offices, ...rules, ids: createIdFactory("web-letter"), playerCharacterId: ROME });
  expect(sent.rejected).toEqual([]);
  return sent.world;
}

const asked = (say: (id: string) => string): { port: SimModelPort; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    port: {
      complete: (operation, _system, user) => {
        calls.push(operation);
        const id = /\[(message-[^\]]+)\]/.exec(user)?.[1] ?? "";
        const reader = /\[([a-z0-9-]+)\]/.exec(user)![1]!;
        return Promise.resolve(JSON.stringify({ actors: [{ actorRef: { kind: "character", id: reader }, proposal: { deltas: [{ op: "diplomatic_message_answer", messageRef: id, answer: "accepted", answerText: say(id), reason: "He answers." }], facts: [] } }] }));
      },
    },
  };
};

const input = (world: WorldState, after: WorldState, port: SimModelPort | null) => ({
  before: world, after, writerId: ROME, clock: definition.clock, offices, port, knownFacts: [], rules, ids: createIdFactory("web-answer"),
});

describe("a letter, the moment it is sent", () => {
  it("is put to its reader by the model at once, and the player is told when the answer will come", async () => {
    const world = before();
    const model = asked(() => "Hieron takes your hand.");
    const sent = written(world, HIERON);
    const result = await answerNewLetters(input(world, sent, model.port));
    // One call, and the commit says so.
    expect(model.calls).toEqual(["simulate_cognition"]);
    expect(result.calls).toBe(1);
    const [note] = result.notes;
    expect(note).toMatchObject({ readerName: "Hieron II", calls: 1 });
    if (note!.state === "coming") {
      expect(note!.words).toMatch(/answer will come in \d+ days?/);
      expect(result.world.diplomacy.at(-1)!.heldAnswer).toBeDefined();
      expect(result.world.diplomacy.at(-1)!.status).toBe("awaiting_reply");
    } else {
      // A reader with no road to wait for has answered already.
      expect(note!.state).toBe("answered");
      expect(result.world.diplomacy.at(-1)).toMatchObject({ status: "answered", answerText: "Hieron takes your hand." });
    }
  });

  it("goes as it always went when no model can be reached: pending, with nothing called and nothing promised", async () => {
    const world = before();
    const sent = written(world, HIERON);
    const result = await answerNewLetters(input(world, sent, null));
    expect(result.calls).toBe(0);
    expect(result.notes[0]).toMatchObject({ state: "pending", inDays: null });
    expect(result.notes[0]!.words).toMatch(/when the world next moves/);
    expect(result.world.diplomacy.at(-1)!.heldAnswer).toBeUndefined();
    expect(result.world.diplomacy.at(-1)!.status).toBe("awaiting_reply");
  });

  it("says plainly that the coins were short, and keeps the letter pending", async () => {
    const world = before();
    const sent = written(world, HIERON);
    const refused: SimModelPort = { complete: () => Promise.reject(Object.assign(new Error("Not enough coins."), { name: "InsufficientCoinsError" })) };
    const result = await answerNewLetters(input(world, sent, refused));
    expect(result.notes[0]!.state).toBe("pending");
    expect(result.notes[0]!.words).toMatch(/coins/);
    expect(result.calls).toBe(0);
  });

  it("keeps it pending, and counts the call, when the model's answer is not a thing the engine can read", async () => {
    const world = before();
    const sent = written(world, HIERON);
    const junk: SimModelPort = { complete: () => Promise.resolve("this is not an answer") };
    const result = await answerNewLetters(input(world, sent, junk));
    expect(result.notes[0]!.state).toBe("pending");
    expect(result.calls).toBeGreaterThanOrEqual(1);
  });

  it("answers only the letters the act wrote: a world with nothing new asks nobody", async () => {
    const world = before();
    const model = asked(() => "Yes.");
    const result = await answerNewLetters(input(world, world, model.port));
    expect(model.calls).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.calls).toBe(0);
  });
});
