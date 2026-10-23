import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { VOICE_CAP, keepsTheSubstance, lettersToVoice, voiceLetters } from "./letter-voice";
import type { SimModelPort } from "./ports";

const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

function letter(id: string, overrides: Partial<DiplomaticMessage> = {}): DiplomaticMessage {
  return {
    id, kind: "ultimatum", fromPolityId: "carthage", fromCharacterId: "hannibal-gisco", toPolityId: "rome", toCharacterId: null,
    subject: "An ultimatum", terms: "Give back the ground within 30 days, or war.", sentAtStep: 100, replyDueByStep: 130,
    status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity", onRefusal: "war",
    ...overrides,
  };
}

/** A world in which the rules wrote these letters to Rome, the player's power, today. */
function withLetters(messages: DiplomaticMessage[], rulesWrote = true): WorldState {
  const world = opening();
  return {
    ...world,
    diplomacy: [...world.diplomacy, ...messages],
    statecraft: { ...world.statecraft, log: rulesWrote ? messages.map((m) => ({ day: m.sentAtStep, polityId: m.fromPolityId, actorCharacterId: m.fromCharacterId, act: "letter" as const, targetPolityId: m.toPolityId, why: "wrote" })) : [] },
  };
}

const model = (answer: (user: string) => string): SimModelPort & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, complete: (_operation, _system, user) => { calls.push(user); return Promise.resolve(answer(user)); } };
};

describe("which letters the model is asked to word", () => {
  it("is only the letters the rules wrote to the player's power, not yet worded, most threatening first", () => {
    const world = withLetters([letter("a", { kind: "protest", onRefusal: null }), letter("b"), letter("c", { kind: "warning", onRefusal: null })]);
    expect(lettersToVoice(world, "gaius-genucius", "rome").map((m) => m.id)).toEqual(["b", "c", "a"]);
  });

  it("leaves out letters to other powers, letters from the player's own, and letters nobody's rules wrote", () => {
    expect(lettersToVoice(withLetters([letter("a", { toPolityId: "syracuse" })]), "gaius-genucius", "rome")).toEqual([]);
    expect(lettersToVoice(withLetters([letter("a", { fromPolityId: "rome" })]), "gaius-genucius", "rome")).toEqual([]);
    // A letter the model already wrote, as a person, is not worded again.
    expect(lettersToVoice(withLetters([letter("a")], false), "gaius-genucius", "rome")).toEqual([]);
    expect(lettersToVoice(withLetters([letter("a", { voicedByModel: true })]), "gaius-genucius", "rome")).toEqual([]);
  });

  it("is never more than the cap in a turn", () => {
    const many = Array.from({ length: 9 }, (_, i) => letter(`m${i}`, { sentAtStep: 100 + i }));
    expect(lettersToVoice(withLetters(many), "gaius-genucius", "rome")).toHaveLength(VOICE_CAP);
  });
});

describe("the model words a letter and may not change what it says", () => {
  const body = "Carthage has borne this long, and now writes plainly: restore what is ours within thirty days. If you will not, there will be war between us, and we are ready for it.";

  it("keeps a deadline and a threat of war, and rejects a letter that drops either", () => {
    const message = letter("a");
    expect(keepsTheSubstance(message, body, 30)).toBe(true);
    expect(keepsTheSubstance(message, "Carthage writes in friendship and hopes for the best.", 30)).toBe(false);
    expect(keepsTheSubstance(message, "Restore it within thirty days, and we will think kindly of you.", 30)).toBe(false);
  });

  it("makes one call for all the letters, applies the ones that keep their substance, and leaves the rest as the template had them", async () => {
    const a = letter("a"), b = letter("b", { subject: "Another", sentAtStep: 99 });
    const world = withLetters([a, b]);
    const port = model(() => JSON.stringify({ letters: [
      { id: "a", subject: "Carthage to Rome", body },
      { id: "b", subject: "Carthage again", body: "A friendly note that asks for nothing at all and threatens nothing either, only goodwill and more goodwill, without any term." },
    ] }));
    const result = await voiceLetters({ world, port, playerCharacterId: "gaius-genucius", playerPolityId: "rome", messages: lettersToVoice(world, "gaius-genucius", "rome") });
    expect(port.calls).toHaveLength(1);
    expect(result.calls).toBe(1);
    expect(result.voiced).toBe(1);
    const after = (id: string) => result.world.diplomacy.find((m) => m.id === id)!;
    expect(after("a").terms).toBe(body);
    expect(after("a").subject).toBe("Carthage to Rome");
    expect(after("b").terms).toBe(b.terms);
    // Neither is asked of the model again.
    expect(after("a").voicedByModel).toBe(true);
    expect(after("b").voicedByModel).toBe(true);
    expect(lettersToVoice(result.world, "gaius-genucius", "rome")).toEqual([]);
  });

  it("keeps the template when the model fails or answers with nonsense, and never throws", async () => {
    const world = withLetters([letter("a")]);
    const broken = await voiceLetters({ world, port: model(() => "I cannot do that."), playerCharacterId: "gaius-genucius", playerPolityId: "rome", messages: lettersToVoice(world, "gaius-genucius", "rome") });
    expect(broken.voiced).toBe(0);
    expect(broken.failure).not.toBeNull();
    expect(broken.world.diplomacy.find((m) => m.id === "a")!.terms).toBe(letter("a").terms);
    const failing: SimModelPort = { complete: () => Promise.reject(new Error("the allowance is spent")) };
    const spent = await voiceLetters({ world, port: failing, playerCharacterId: "gaius-genucius", playerPolityId: "rome", messages: lettersToVoice(world, "gaius-genucius", "rome") });
    expect(spent.voiced).toBe(0);
    expect(spent.failure).toContain("allowance");
  });

  it("makes no call at all when there is nothing to word", async () => {
    const port = model(() => "{}");
    const result = await voiceLetters({ world: opening(), port, playerCharacterId: "gaius-genucius", playerPolityId: "rome", messages: [] });
    expect(result.calls).toBe(0);
    expect(port.calls).toHaveLength(0);
  });

  it("tells the model who is writing and what the letter must say, and not what the player knows", async () => {
    const world = withLetters([letter("a")]);
    const port = model(() => JSON.stringify({ letters: [] }));
    await voiceLetters({ world, port, playerCharacterId: "gaius-genucius", playerPolityId: "rome", messages: lettersToVoice(world, "gaius-genucius", "rome") });
    expect(port.calls[0]).toContain("LETTER [a] (ultimatum)");
    expect(port.calls[0]).toContain("Give back the ground within 30 days, or war.");
    expect(port.calls[0]).toContain("Deadline: 30 days.");
    expect(port.calls[0]).toContain("it is war");
  });
});

describe("the player's own people's dispatches ride in the same call", () => {
  it("words a dispatch in the man's voice, in one call with the letters, keeping his name on it", async () => {
    const world = withLetters([letter("a")]);
    const sender = world.characters.find((c) => c.alive && c.id !== "gaius-genucius")!;
    const port = model(() => JSON.stringify({ letters: [
      { id: "a", subject: "Carthage to Rome", body: "Carthage has borne this long, and now writes plainly: restore what is ours within thirty days. If you will not, there will be war between us, and we are ready." },
      { id: "fact-1", subject: "A report", body: "The men at the river are short of bread, and I do not know how long they will hold. Send grain, or tell me where to find it." },
    ] }));
    const result = await voiceLetters({ world, port, playerCharacterId: "gaius-genucius", playerPolityId: "rome", messages: lettersToVoice(world, "gaius-genucius", "rome"), dispatches: [{ id: "fact-1", sender, substance: `${sender.name} writes: Bread is short.` }] });
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]).toContain("LETTER [fact-1] (a report to his commander)");
    expect(result.voiced).toBe(2);
    expect(result.dispatches.get("fact-1")).toBe(`${sender.name} writes: The men at the river are short of bread, and I do not know how long they will hold. Send grain, or tell me where to find it.`);
  });

  it("words dispatches alone when there are no letters, and drops a body too short to be a letter", async () => {
    const world = opening();
    const sender = world.characters.find((c) => c.alive)!;
    const port = model(() => JSON.stringify({ letters: [{ id: "fact-1", subject: "A report", body: "Short." }] }));
    const result = await voiceLetters({ world, port, playerCharacterId: "gaius-genucius", playerPolityId: "rome", messages: [], dispatches: [{ id: "fact-1", sender, substance: "Bread is short." }] });
    expect(result.calls).toBe(1);
    expect(result.dispatches.size).toBe(0);
  });
});
