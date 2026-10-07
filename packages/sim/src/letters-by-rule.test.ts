import { beforeAll, describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, type Character, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { readBoard } from "./board";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { writeLetter, toneOf, type Intent } from "./letter-craft";
import { answerByRule, bigMoveCandidates, intendsToBreak, roadToWar, type StatecraftInput } from "./statecraft";
import type { SimModelPort } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "w", deltas: [], facts: [], outcome: "continue" }));
    if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
    return Promise.resolve("{}");
  },
};

let seeded: WorldState;
beforeAll(async () => {
  const result = await runSimulationBurst({
    world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
    clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: "seed", gameId: "letters-by-rule", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
  });
  seeded = result.world;
}, 300_000);

const withMind = (world: WorldState, id: string, temperament: Partial<Character["mind"]["temperament"]>, drives: Partial<Character["mind"]["drives"]>, risk = 50): WorldState =>
  ({ ...world, characters: world.characters.map((c) => (c.id === id ? { ...c, traits: [], mind: { ...c.mind, riskTolerance: risk, temperament: { ...c.mind.temperament, ...temperament }, drives: { ...c.mind.drives, ...drives } } } : c)) });
const rulerOf = (world: WorldState, polityId: string): Character => readDepartments(world).rulers(polityId).find((r) => r.alive)!;
const inputOf = (world: WorldState): StatecraftInput => ({ world, gameId: "letters", excludedPolityIds: new Set(), playedByModel: new Set(), playerCharacterId: null, nearPlayer: null, pressures: [] });

const COURTLY = { sociability: 95, honesty: 90, boldness: 40, caution: 60, cruelty: 10, discipline: 80 };
const COURTLY_DRIVES = { duty: 90, status: 40, revenge: 20, security: 50 };
const BRUTE = { sociability: 5, honesty: 20, boldness: 95, caution: 5, cruelty: 95, discipline: 20 };
const BRUTE_DRIVES = { duty: 20, status: 95, revenge: 85, security: 20 };
const MOUSE = { sociability: 60, honesty: 70, boldness: 5, caution: 95, cruelty: 10, discipline: 60 };
const MOUSE_DRIVES = { duty: 60, status: 15, revenge: 10, security: 95 };

const asMan = (c0: Character, temperament: object, drives: object): Character =>
  ({ ...c0, traits: [], mind: { ...c0.mind, temperament: { ...c0.mind.temperament, ...temperament }, drives: { ...c0.mind.drives, ...drives } } }) as Character;

describe("a ruler writes in his own voice", () => {
  it("sounds different from another man on the same matter, and always the same as himself", () => {
    const [a, b, c] = [seeded.characters[0]!, seeded.characters[1]!, seeded.characters[2]!];
    const courtly = asMan(a, COURTLY, COURTLY_DRIVES);
    const brute = asMan(b, BRUTE, BRUTE_DRIVES);
    const mouse = asMan(c, MOUSE, MOUSE_DRIVES);
    const facts = { us: "Carthage", them: "Rome", matter: "the ground Rome holds that is ours by right", ask: "that you restore it", days: 30 };
    const words = (writer: Character) => writeLetter(writer, 400, "demand", facts, "{us} demands satisfaction of {them}", false);
    expect(new Set([words(courtly).tone, words(brute).tone, words(mouse).tone]).size).toBeGreaterThanOrEqual(2);
    expect(words(courtly).body).not.toBe(words(brute).body);
    expect(words(brute).body).toBe(words(brute).body);
    expect(toneOf(brute, 400, "demand")).toBe("threatening");
    expect(["courteous", "pleading"]).toContain(toneOf(courtly, 400, "demand"));
  });

  it("fills every placeholder and keeps within the length a letter may have, for every kind of letter", () => {
    const writer = seeded.characters[0]!;
    const intents: Intent[] = ["complaint", "demand", "ultimatum", "peace_offer", "peace_accept", "peace_refuse", "talks_accept", "talks_refuse", "alliance_offer", "alliance_accept", "alliance_refuse", "aid_accept", "aid_refuse", "submit", "defy", "stall"];
    for (const intent of intents) {
      const letter = writeLetter(writer, 400, intent, { us: "Syracuse", them: "Carthage", matter: "the Strait", reason: "tired", ask: "that you withdraw", days: 30 }, "{us} writes to {them}");
      expect(letter.body).not.toMatch(/[{}]/);
      expect(letter.subject).not.toMatch(/[{}]/);
      expect(letter.body.length).toBeGreaterThan(10);
      expect(letter.body.length).toBeLessThanOrEqual(1_200);
    }
  });
});

describe("a ruler answers a letter as he is", () => {
  /** A power and a neighbour: the answerer a little the weaker, the sender holds the field. */
  function aQuarrel(): { answerer: string; sender: string } {
    for (const reading of readBoard(seeded).values()) {
      const ruler = readDepartments(seeded).rulers(reading.polityId).find((r) => r.alive);
      const other = reading.neighbours.find((n) => n.ratio > 0.4 && n.ratio < 0.8 && n.relation !== "war" && readDepartments(seeded).rulers(n.polityId).some((r) => r.alive));
      if (ruler !== undefined && other !== undefined) return { answerer: reading.polityId, sender: other.polityId };
    }
    throw new Error("no quarrel on the board");
  }

  const ultimatum = (from: string, to: string, answerer: Character): DiplomaticMessage => ({
    id: "ult-1", kind: "ultimatum", fromPolityId: from, fromCharacterId: rulerOf(seeded, from).id, toPolityId: to, toCharacterId: answerer.id,
    subject: "Give back the ground", terms: "Give it back within thirty days, or war.", sentAtStep: 0, replyDueByStep: 400, status: "awaiting_reply", answer: null, answerText: null,
    answeredAtStep: null, inReplyToMessageId: null, visibility: "polity", onRefusal: "war",
  } as DiplomaticMessage);

  it("gives way to a stronger neighbour's ultimatum if frightened, and defies it if daring or proud", () => {
    const { answerer, sender } = aQuarrel();
    const who = rulerOf(seeded, answerer).id;
    const frightened = withMind(seeded, who, MOUSE, MOUSE_DRIVES, 5);
    const daring = withMind(seeded, who, BRUTE, BRUTE_DRIVES, 98);
    const message = (w: WorldState) => ultimatum(sender, answerer, rulerOf(w, answerer));
    const gaveWay = answerByRule({ ...frightened, instant: { day: 500, minute: 0 }, diplomacy: [message(frightened)] }, message(frightened), inputOf(frightened), (id) => rulerOf(frightened, id));
    const defied = answerByRule({ ...daring, instant: { day: 500, minute: 0 }, diplomacy: [message(daring)] }, message(daring), inputOf(daring), (id) => rulerOf(daring, id));
    expect(gaveWay?.deltas[0]).toMatchObject({ op: "diplomatic_message_answer", answer: "accepted" });
    expect(defied?.deltas[0]).toMatchObject({ op: "diplomatic_message_answer", answer: "refused" });
    expect((gaveWay!.deltas[0] as { answerText: string }).answerText).not.toBe((defied!.deltas[0] as { answerText: string }).answerText);
  });

  it("takes counsel first if cautious: a man of nerve answers the day it comes, a frightened one not yet", () => {
    const { answerer, sender } = aQuarrel();
    const who = rulerOf(seeded, answerer).id;
    const careful = withMind(seeded, who, { ...MOUSE, discipline: 90 }, MOUSE_DRIVES, 5);
    const rash = withMind(seeded, who, { ...BRUTE, discipline: 20 }, BRUTE_DRIVES, 98);
    const day = (w: WorldState): WorldState => ({ ...w, instant: { day: 500, minute: 0 } });
    const msg = (w: WorldState): DiplomaticMessage => ({ ...ultimatum(sender, answerer, rulerOf(w, answerer)), deliveredOnDay: 500, replyDueByStep: 700 });
    expect(answerByRule(day(rash), msg(rash), inputOf(day(rash)), (id) => rulerOf(rash, id))).not.toBeNull();
    expect(answerByRule(day(careful), msg(careful), inputOf(day(careful)), (id) => rulerOf(careful, id))).toBeNull();
  });

  it("lets a man of weak honesty say yes and mean no, which nothing in the world shows", () => {
    const { answerer, sender } = aQuarrel();
    const who = rulerOf(seeded, answerer);
    const liar = withMind(seeded, who.id, { honesty: 2 }, {}, 50);
    const honest = withMind(seeded, who.id, { honesty: 95 }, {}, 50);
    const peaceFor = (w: WorldState, id: string): WorldState => ({
      ...w,
      polityAgreements: [...w.polityAgreements, { id: `peace-${id}`, kind: "peace", polityId: sender, otherPolityId: answerer, terms: "Peace.", sinceStep: 1, untilStep: null, sourceMessageId: id, status: "active", endedAtStep: null, endedReason: null, visibility: "public" } as never],
      diplomacy: [...w.diplomacy, { id, kind: "peace_offer", fromPolityId: sender, fromCharacterId: rulerOf(w, sender).id, toPolityId: answerer, toCharacterId: null, subject: "Peace", terms: "Peace.", sentAtStep: 0, replyDueByStep: null, status: "answered", answer: "accepted", answerText: "Yes.", answeredAtStep: 1, inReplyToMessageId: null, visibility: "polity" } as never],
    });
    let breaks = 0;
    for (let i = 0; i < 200; i += 1) {
      const w = peaceFor(liar, `m-${i}`);
      if (intendsToBreak(w, rulerOf(w, answerer), sender)) breaks += 1;
    }
    expect(breaks).toBeGreaterThan(40);
    expect(breaks).toBeLessThan(200);
    expect(intendsToBreak(peaceFor(honest, "m-1"), rulerOf(honest, answerer), sender)).toBe(false);
  });
});

describe("a power writes before it fights", () => {
  const hungry = (c: Character): Character["mind"] => ({ ...c.mind, riskTolerance: 90, temperament: { ...c.mind.temperament, ...BRUTE, honesty: 80, discipline: 60 }, drives: { ...c.mind.drives, ...BRUTE_DRIVES, duty: 80 } });

  function aCandidate(mind: (c: Character) => Character["mind"]) {
    for (const polity of seeded.map.polities) {
      const ruler = readDepartments(seeded).rulers(polity.id).find((r) => r.alive);
      if (ruler === undefined) continue;
      const world: WorldState = { ...seeded, characters: seeded.characters.map((c) => (c.id === ruler.id ? { ...c, traits: [], mind: mind(c) } : c)), instant: { day: 400, minute: 0 } };
      const found = bigMoveCandidates(inputOf(world), readBoard(world), (id) => readDepartments(world).rulers(id).find((r) => r.alive), (id) => id === polity.id, null).find((c) => c.polityId === polity.id);
      if (found !== undefined) return { world, candidate: found };
    }
    throw new Error("no power can make a war");
  }

  /** The same candidate with a different ruler id each time, so the hash that decides whether he warns is sampled. */
  const sampled = (candidate: ReturnType<typeof aCandidate>["candidate"], i: number) => ({ ...candidate, ruler: { ...candidate.ruler, id: `${candidate.ruler.id}-s${i}` } }) as typeof candidate;

  it("writes first if the ruler gives warning, and a man with no honour gives none", () => {
    const honest = aCandidate(hungry);
    let letters = 0, wars = 0;
    for (let i = 0; i < 40; i += 1) {
      const road = roadToWar(honest.world, sampled(honest.candidate, i), true);
      if (road.step === "letter") letters += 1; else if (road.step === "war") wars += 1;
    }
    expect(letters).toBeGreaterThan(wars);
    const faithless = aCandidate((c) => ({ ...c.mind, temperament: { ...c.mind.temperament, honesty: 5, sociability: 10 }, drives: { ...c.mind.drives, duty: 5, faith: 5 } }));
    let strikes = 0;
    for (let i = 0; i < 40; i += 1) {
      if (roadToWar(faithless.world, sampled(faithless.candidate, i), true).step === "war") strikes += 1;
    }
    expect(strikes).toBeGreaterThan(30);
  });

  it("climbs from complaint to demand to an ultimatum that says it is war if refused", () => {
    const { world, candidate } = aCandidate(hungry);
    const note = (from: string, kind: DiplomaticMessage["kind"], sentAtStep: number, answer: DiplomaticMessage["answer"]): DiplomaticMessage => ({
      id: `n-${kind}`, kind, fromPolityId: candidate.polityId, fromCharacterId: from, toPolityId: candidate.neighbour.polityId, toCharacterId: null,
      subject: "x", terms: "x", sentAtStep, replyDueByStep: sentAtStep + 30, status: answer === null ? "awaiting_reply" : "answered", answer, answerText: null,
      answeredAtStep: answer === null ? null : sentAtStep + 5, inReplyToMessageId: null, visibility: "polity",
    } as DiplomaticMessage);
    /** Some ruler who warns: the first sampled man for whom the road is a letter. */
    const next = (earlier: (from: string) => DiplomaticMessage[]) => {
      for (let i = 0; i < 80; i += 1) {
        const trial = { ...sampled(candidate, i), score: 80 };
        const road = roadToWar({ ...world, diplomacy: [...world.diplomacy, ...earlier(trial.ruler.id)] }, trial, true);
        if (road.step === "letter") return road.decision.deltas[0] as { kind: string; onRefusal?: string };
      }
      return null;
    };
    expect(next(() => [])?.kind).toMatch(/protest|warning|ultimatum/);
    expect(next((from) => [note(from, "protest", 300, "refused")])?.kind).toMatch(/warning|ultimatum/);
    const last = next((from) => [note(from, "protest", 200, "refused"), note(from, "warning", 300, "ignored")]);
    expect(last?.kind).toBe("ultimatum");
    expect(last?.onRefusal).toBe("war");
  });

  it("does not climb while the last letter is unanswered", () => {
    const { world, candidate } = aCandidate(hungry);
    for (let i = 0; i < 20; i += 1) {
      const trial = { ...sampled(candidate, i), score: 90 };
      const pending = { id: "n-1", kind: "protest", fromPolityId: trial.polityId, fromCharacterId: trial.ruler.id, toPolityId: trial.neighbour.polityId, toCharacterId: null, subject: "x", terms: "x", sentAtStep: 390, replyDueByStep: 420, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity" } as unknown as DiplomaticMessage;
      const road = roadToWar({ ...world, diplomacy: [...world.diplomacy, pending] }, trial, true);
      expect(["wait", "war"]).toContain(road.step);
    }
  });
});

import { WorldDeltaSchema } from "@chronica/shared";
import { bindAnswerToNature } from "./nature";

describe("when the model answers a letter for a person, it words their answer and does not reverse it", () => {
  function aQuarrel(): { answerer: string; sender: string } {
    for (const reading of readBoard(seeded).values()) {
      const ruler = readDepartments(seeded).rulers(reading.polityId).find((r) => r.alive);
      const other = reading.neighbours.find((n) => n.ratio > 0.4 && n.ratio < 0.8 && n.relation !== "war" && readDepartments(seeded).rulers(n.polityId).some((r) => r.alive));
      if (ruler !== undefined && other !== undefined) return { answerer: reading.polityId, sender: other.polityId };
    }
    throw new Error("no quarrel on the board");
  }

  it("turns a daring ruler's model-written 'yes' to an ultimatum into the refusal he would give, and leaves an honest 'no' alone", () => {
    const { answerer, sender } = aQuarrel();
    const who = rulerOf(seeded, answerer).id;
    const daring = withMind(seeded, who, BRUTE, BRUTE_DRIVES, 98);
    const message = { id: "ult-1", kind: "ultimatum", fromPolityId: sender, fromCharacterId: rulerOf(daring, sender).id, toPolityId: answerer, toCharacterId: who, subject: "Give it back", terms: "Give it back or war.", sentAtStep: 0, replyDueByStep: 400, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity", onRefusal: "war" } as unknown as DiplomaticMessage;
    const world = { ...daring, instant: { day: 500, minute: 0 }, diplomacy: [message] };
    const yes = WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: "ult-1", answer: "accepted", answerText: "We shall of course comply, with great respect.", agreementKind: null, reason: "Respect." });
    const bound = bindAnswerToNature(world, who, yes);
    expect(bound.act).toMatchObject({ op: "diplomatic_message_answer", answer: "refused" });
    expect((bound.act as { answerText: string }).answerText).not.toContain("comply");
    expect(bound.brought).toMatch(/not in him/);
    const no = WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: "ult-1", answer: "refused", answerText: "Never.", agreementKind: null, reason: "Never." });
    expect(bindAnswerToNature(world, who, no)).toEqual({ act: no, brought: null });
  });

  it("does not touch an answer on a small matter or a plain letter", () => {
    const { answerer, sender } = aQuarrel();
    const who = rulerOf(seeded, answerer).id;
    const message = { id: "l-1", kind: "letter", fromPolityId: sender, fromCharacterId: rulerOf(seeded, sender).id, toPolityId: answerer, toCharacterId: who, subject: "Greetings", terms: "Greetings.", sentAtStep: 0, replyDueByStep: null, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity" } as unknown as DiplomaticMessage;
    const yes = WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: "l-1", answer: "accepted", answerText: "Gladly.", agreementKind: null, reason: "Friendly." });
    expect(bindAnswerToNature({ ...seeded, diplomacy: [message] }, who, yes).brought).toBeNull();
  });
});

import { plainName } from "./letter-craft";

describe("the words of a letter read as a person's", () => {
  it("says a power's name as people say it", () => {
    expect(plainName("Kingdom of Epirus")).toBe("Epirus");
    expect(plainName("Mamertines of Messana")).toBe("the Mamertines");
    expect(plainName("Seleucid Empire")).toBe("the Seleucid Empire");
    expect(plainName("Arab tent-dwellers of the western Iraqi and Syrian steppe (Scenitae)")).toBe("the Scenitae");
    expect(plainName("Rome")).toBe("Rome");
  });

  it("begins every sentence with a capital, whatever was filled into it", () => {
    const writer = seeded.characters[0]!;
    for (const intent of ["complaint", "demand", "ultimatum", "peace_refuse", "alliance_offer"] as const) {
      const letter = writeLetter(writer, 400, intent, { us: "Seleucid Empire", them: "Kingdom of Epirus", matter: "the ground Epirus holds that is ours by right", ask: "that you restore it", days: 30, reason: "tired" }, "{us} to {them}");
      for (const sentence of letter.body.split(/(?<=[.!?])\s+/)) expect(sentence[0]).toBe(sentence[0]!.toUpperCase());
      expect(letter.body).not.toMatch(/Kingdom of Epirus/);
    }
  });
});
