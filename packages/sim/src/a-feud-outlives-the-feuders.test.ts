import { describe, expect, it } from "vitest";
import { feudBetween, gensById, modernWordsIn, type DiplomaticMessage } from "@chronica/shared";
import { FEUD_COLDER_BY, FEUD_LIKING_SHIFT, FEUD_NOTICED_AT, feudColdness, feudLikingShift, quarrelBetween } from "./feuds-in-letters";
import { adviceOnALetter, letterVerdict } from "./letter-verdict";
import { writeLetter } from "./letter-craft";
import { voiceLetters } from "./letter-voice";
import type { SimModelPort } from "./ports";
import { FEUD_BEGINS_BPS, FEUD_COOLS_BPS_PER_MONTH, keepGentes } from "./gentes";
import { FEUD_VOTE_MAX, kinOf, leanAsAGens } from "./gens-loyalty";
import { killCharacter } from "./mortality";
import { named, opening, thinks, withDay } from "./gentes-test-kit";

/**
 * A grudge between two men, if it was deep enough and lasted, became a grudge between their families: the Cornelii did not forgive
 * Fabricius his censorship of 275, and their sons did not. It cools by itself, slowly, is fed by the living, and turns a man of one
 * gens against a motion moved by the other's, by a bounded measure.
 */
describe("a feud outlives the feuders", () => {
  const start = opening();

  it("opens with the grudges the sources attest, both ways", () => {
    expect(feudBetween(start, "gens-cornelius", "gens-fabricius")).toBeGreaterThan(0);
    const fabricii = gensById(start, "gens-fabricius")!;
    expect(fabricii.feuds[0]!.reason).toMatch(/ten pounds of silver/);
    expect(feudBetween(start, "gens-fabius", "gens-claudius")).toBeGreaterThan(0);
  });

  it("is made by a living man's deep and lasting ill will toward a man of another gens", () => {
    const a = named(start, "Gaius Claudius Canina");
    const b = named(start, "Lucius Postumius Megellus");
    expect(feudBetween(start, "gens-claudius", "gens-postumius")).toBe(0);
    const hated = thinks(start, a.id, b.id, -80);
    const kept = keepGentes(withDay(hated, 30), 30);
    expect(feudBetween(kept.world, "gens-claudius", "gens-postumius")).toBeGreaterThanOrEqual(FEUD_BEGINS_BPS);
    expect(kept.facts.some((fact) => fact.kind === "gens_feud" && /Claudii/.test(fact.summary))).toBe(true);
  });

  it("cools a little each month, and is still there when both the men who made it are dead", () => {
    const a = named(start, "Gaius Claudius Canina");
    const b = named(start, "Lucius Postumius Megellus");
    let world = keepGentes(withDay(thinks(start, a.id, b.id, -80), 30), 30).world;
    const first = gensById(world, "gens-claudius")!.feuds.find((feud) => feud.againstGensId === "gens-postumius")!.intensityBps;
    // They die; nobody is left to feed it.
    world = killCharacter(withDay(world, 40), a.id, "a fever", 40).world;
    world = killCharacter(world, b.id, "a fever", 41).world;
    world = keepGentes(withDay(world, 70), 70).world;
    const second = gensById(world, "gens-claudius")!.feuds.find((feud) => feud.againstGensId === "gens-postumius")!.intensityBps;
    expect(second).toBeLessThan(first);
    expect(first - second).toBeLessThanOrEqual(FEUD_COOLS_BPS_PER_MONTH + 450);
    // Years on, still hot.
    for (let month = 3; month <= 24; month += 1) world = keepGentes(withDay(world, month * 30 + 10), month * 30 + 10).world;
    const later = gensById(world, "gens-claudius")!.feuds.find((feud) => feud.againstGensId === "gens-postumius")!;
    expect(later.intensityBps).toBeGreaterThan(0);
    expect(later.intensityBps).toBeLessThan(second);
    expect(world.characters.find((character) => character.id === a.id)!.alive).toBe(false);
  });

  it("burns out in the end if nobody stokes it", () => {
    let world = start;
    // The Fabii's old grudge against the Claudii, left to itself for forty years.
    for (let month = 1; month <= 480; month += 1) world = keepGentes(withDay(world, month * 30), month * 30).world;
    expect(feudBetween(world, "gens-fabius", "gens-claudius")).toBe(0);
  });

  it("turns a man of one gens against a motion of the other's, by at most a tenth of the scale", () => {
    const fabricius = named(start, "Gaius Fabricius Luscinus");
    const kin = kinOf(start, { sponsorCharacterId: fabricius.id })!;
    const seats = [{ gensId: "gens-cornelius" }, { gensId: "gens-cornelius" }, { gensId: "gens-valerius" }, {}];
    const leans = leanAsAGens(seats, [20, 20, 20, 20], kin);
    expect(leans[0]).toBeLessThan(20);
    expect(leans[0]).toBe(leans[1]);
    expect(20 - leans[0]!).toBeLessThanOrEqual(FEUD_VOTE_MAX);
    expect(leans[2]).toBe(20);
    expect(leans[3]).toBe(20);
    // The hottest feud costs the most it may.
    const hot = { sponsorGensId: "gens-fabricius", feudOf: () => 10_000 };
    expect(20 - leanAsAGens([{ gensId: "gens-cornelius" }], [20], hot)[0]!).toBe(FEUD_VOTE_MAX);
  });

  it("draws the seats of one gens together behind its first man, a quarter of the way", () => {
    const kin = { sponsorGensId: null, feudOf: () => 0 };
    const seats = [{ gensId: "gens-fabius", leader: true }, { gensId: "gens-fabius" }, { gensId: "gens-fabius" }, { gensId: "gens-valerius" }];
    const leans = leanAsAGens(seats, [40, -20, 0, -20], kin);
    // The mean of the gens, the head counting double: (80 - 20 + 0) / 4 = 15.
    expect(leans[0]).toBeCloseTo(40 + (15 - 40) * 0.25, 5);
    expect(leans[1]).toBeCloseTo(-20 + (15 + 20) * 0.25, 5);
    expect(leans[3]).toBe(-20);
    // No gentes in the world, no pull.
    expect(leanAsAGens(seats, [40, -20, 0, -20], undefined)).toEqual([40, -20, 0, -20]);
  });
});

/**
 * A feud is heard in a letter (v58): the counsel the rules give the man who answers names it, his liking for the writer is a few points
 * the lower, the rules' own letter between the two is cooler and says so, and the model that words a letter for the player is told of it.
 * Words only and bounded: no answer is forced, and no term is changed.
 */
describe("a feud in a letter", () => {
  const start = opening();
  const fabius = named(start, "Quintus Fabius Maximus Gurges");
  const claudius = named(start, "Gaius Claudius Canina");
  const unrelated = named(start, "Manius Curius Dentatus");
  const alliance = (from: string, to: string): DiplomaticMessage => ({
    id: "feud-letter", kind: "alliance_offer", fromPolityId: "rome", fromCharacterId: from, toPolityId: "rome", toCharacterId: to, subject: "An alliance", terms: "Let us stand together.",
    sentAtStep: 100, replyDueByStep: 160, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity", onRefusal: null, proposes: ["alliance"],
  } as DiplomaticMessage);

  it("finds the quarrel between two men of the gentes at feud, and none between others", () => {
    const quarrel = quarrelBetween(start, fabius.id, claudius.id)!;
    expect(quarrel.ours).toBe("the Fabii");
    expect(quarrel.theirs).toBe("the Claudii");
    expect(quarrel.heat).toBeGreaterThanOrEqual(FEUD_NOTICED_AT);
    expect(quarrelBetween(start, fabius.id, unrelated.id)).toBeNull();
    expect(quarrelBetween(start, fabius.id, fabius.id)).toBeNull();
  });

  it("is bounded: it sours liking by at most a few points whatever the heat, and a colder tone by at most a quarter point", () => {
    const hottest = { heat: 10_000, ours: "the Fabii", theirs: "the Claudii", over: "x" };
    expect(feudLikingShift(hottest)).toBe(-FEUD_LIKING_SHIFT);
    expect(feudLikingShift({ ...hottest, heat: 1_000 })).toBeGreaterThan(-FEUD_LIKING_SHIFT);
    expect(feudLikingShift(null)).toBe(0);
    expect(feudColdness(hottest)).toBeLessThanOrEqual(FEUD_COLDER_BY);
    expect(feudColdness(null)).toBe(0);
  });

  it("is named in the counsel the rules give the man who answers, and in none the rules give for a stranger", () => {
    const quarrelled = letterVerdict(start, alliance(claudius.id, fabius.id), fabius)!;
    expect(quarrelled.feud?.theirs).toBe("the Claudii");
    expect(adviceOnALetter(quarrelled)).toMatch(/at feud/);
    expect(adviceOnALetter(quarrelled)).toMatch(/counsel only/);
    const plain = letterVerdict(start, alliance(unrelated.id, fabius.id), fabius)!;
    expect(plain.feud).toBeUndefined();
    expect(adviceOnALetter(plain)).not.toMatch(/at feud/);
    // The counsel is counsel: an answer is still given, the same kinds of answer as without.
    expect(typeof quarrelled.accepted).toBe("boolean");
  });

  it("makes the rules' own letter between the two cooler, with a line saying why", () => {
    const quarrel = quarrelBetween(start, fabius.id, claudius.id)!;
    const facts = { us: "Rome", them: "Rome", matter: "the ground at Rhegium", ask: "that it be given back", days: 30 };
    const without = writeLetter(fabius, 100, "demand", facts, "{us} to {them}");
    const within = writeLetter(fabius, 100, "demand", { ...facts, feud: quarrel }, "{us} to {them}");
    expect(without.body).not.toMatch(/quarrel/);
    expect(within.body).toMatch(/quarrel|forgotten|forget/);
    expect(within.body).toMatch(/Fabii/);
    expect(within.body).toMatch(/Claudii/);
    // The substance is what it was: the same days, the same ask.
    expect(within.body).toMatch(/30/);
    // The same every time.
    expect(writeLetter(fabius, 100, "demand", { ...facts, feud: quarrel }, "{us} to {them}")).toEqual(within);
    // And no modern word has crept into the line.
    expect(modernWordsIn(within.body)).toEqual([]);
  });

  it("is told to the model that words a letter for the player, for the voice and not the substance", async () => {
    const message = { ...alliance(claudius.id, fabius.id), kind: "protest", fromPolityId: "carthage", toPolityId: "rome" } as DiplomaticMessage;
    const world = { ...start, diplomacy: [...start.diplomacy, message] };
    const calls: string[] = [];
    const port: SimModelPort = { complete: (_operation, _system, user) => { calls.push(user); return Promise.resolve(JSON.stringify({ letters: [] })); } };
    await voiceLetters({ world, port, playerCharacterId: fabius.id, playerPolityId: "rome", messages: [message] });
    expect(calls[0]).toMatch(/at feud with the reader's, the Fabii|at feud with the reader's, the Claudii|is at feud with the reader's/);
    expect(calls[0]).toMatch(/do not change what is asked or offered/);
  });
});
