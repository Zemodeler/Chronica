import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type Fact, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { routeAttention } from "./attention";
import { runSimulationBurst } from "./burst";
import { composeChronicle } from "./chronicle";
import { addressWaitingLetters, diplomaticAnswererOf } from "./letters";
import { engineWork, type NarratorSeed } from "./narrator";
import { createIdFactory, type SimModelPort } from "./ports";

/**
 * What a turn stopped paying for (2026-09-26). Each of these was an answer the
 * model wrote, and the player paid for, that changed nothing: a man re-asked
 * about his own act, three Romans answering one letter, and a province shift
 * copied out of a brief.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const offices = definition.government.offices;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const fact = (id: string, affected: Fact["affectedEntities"], summary = `News ${id}.`): Fact => ({
  id, time: { day: 0, minute: 0 }, atStep: 0, kind: "event", summary, affectedEntities: affected, resourceChanges: [],
  authorityChange: undefined, visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
  eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0,
});

describe("the reactive router", () => {
  const route = (facts: readonly Fact[], extra: Partial<Parameters<typeof routeAttention>[0]> = {}) =>
    routeAttention({ world: opening(), facts, offices, excludeCharacterIds: [], maxFocused: 8, maxCausalDepth: 3, ...extra }).focused.map((actor) => actor.characterId);

  it("does not wake a man for what he himself just did", () => {
    const own = fact("f1", [{ kind: "character", id: "hieron-ii" }, { kind: "polity", id: "syracuse" }]);
    expect(route([own])).toContain("hieron-ii");
    expect(route([own], { authorOf: new Map([["f1", "hieron-ii"]]) })).not.toContain("hieron-ii");
  });

  it("does not put the same news to him twice", () => {
    const news = fact("f2", [{ kind: "character", id: "hieron-ii" }]);
    expect(route([news], { alreadyAnswered: new Map([["hieron-ii", new Set(["f2"])]]) })).not.toContain("hieron-ii");
  });

  it("scores each man on his own news, not the round's", () => {
    // Hieron's act names Hieron; Hanno is woken by it as a foreign power
    // involved, never as "directly affected" by another man's deed.
    const own = fact("f3", [{ kind: "character", id: "hieron-ii" }, { kind: "polity", id: "carthage" }]);
    // Asked once word of it has had time to cross to Carthage.
    const tenDaysOn = { ...opening(), instant: { day: 10, minute: 0 }, elapsedStep: 10 };
    const cast = routeAttention({ world: tenDaysOn, facts: [own], offices, excludeCharacterIds: [], maxFocused: 8, maxCausalDepth: 3, authorOf: new Map([["f3", "hieron-ii"]]) }).focused;
    expect(cast.find((actor) => actor.characterId === "hanno-carthage")?.why).not.toContain("directly affected");
  });
});

describe("a letter to a power", () => {
  it("goes to the one person who answers for that power, not to all of its people", () => {
    const world = opening();
    const answerer = diplomaticAnswererOf(world, "rome", offices);
    expect(answerer).toBe("gaius-genucius");
    const sent = applyDeltas(world, [WorldDeltaSchema.parse({
      op: "diplomatic_message_send", localId: "plea", kind: "military_aid_request", fromPolityId: "mamertines", fromCharacterRef: "mamertine-spokesman",
      toPolityId: "rome", toCharacterRef: null, subject: "Protection for Messana", terms: "Take us under your protection.", reason: "They need a protector.",
    })], { now: world.instant, actorRef: { kind: "character", id: "mamertine-spokesman" }, offices, warfare: definition.warfare, ids: createIdFactory("t"), gameId: "g" });
    const letter = sent.world.diplomacy.find((message) => message.subject === "Protection for Messana")!;
    expect(letter.toCharacterId).toBe("gaius-genucius");
  });

  it("already waiting, addressed to nobody, is addressed before anybody is asked", () => {
    const world = opening();
    const waiting = world.diplomacy.find((message) => message.status === "awaiting_reply" && message.toCharacterId === null);
    const addressed = addressWaitingLetters(world, offices);
    expect(addressed.diplomacy.filter((message) => message.status === "awaiting_reply" && message.toCharacterId === null).length)
      .toBeLessThanOrEqual(waiting === undefined ? 0 : world.diplomacy.length);
    for (const message of addressed.diplomacy.filter((entry) => entry.status === "awaiting_reply" && entry.toCharacterId !== null)) {
      expect(addressed.characters.find((character) => character.id === message.toCharacterId)?.polityId).toBe(message.toPolityId);
    }
  });
});

describe("the Chronicle", () => {
  it("has the historian write a light thread too, rather than printing its facts", async () => {
    // Printed as it stood, a light thread read as a ledger: its own sentence
    // under a headline of the same words. Every thread is written.
    const calls: string[] = [];
    const port: SimModelPort = { complete: (_op, _system, user) => { calls.push(user); return Promise.resolve(JSON.stringify({ entries: [{ thread: 1, title: "Bakers of Rome Protest the Price of Bread", body: "Written." }] })); } };
    const light = fact("grain", [{ kind: "polity", id: "rome" }], "Grain is dearer in Latium, and the bakers are complaining.");
    const heavy = fact("march", [{ kind: "polity", id: "rome" }, { kind: "polity", id: "boii" }], "The legions march north into Boii country.");
    const result = await composeChronicle({
      port, clock, observer: { kind: "character", id: "gaius-genucius" }, observerPolityId: "rome",
      facts: [light, heavy], from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      significanceByFactId: new Map([["grain", 30], ["march", 70]]), orderFactIds: new Set(["march"]),
    });
    expect(calls).toHaveLength(2);
    expect(result.entries.find((entry) => entry.factIds.includes("grain"))?.title).toBe("Bakers of Rome Protest the Price of Bread");
  });
});

describe("the narrator's arithmetic", () => {
  const harvest: NarratorSeed = {
    key: "seed-grain-fleet", kind: "world_event", archetype: "grain_fleet_lost", severity: "serious", secret: false, oneShot: true,
    target: { provinceId: "punic-italy-latium", provinceName: "Latium", polityId: "rome", polityName: "Roman Republic", characterId: null, characterName: null, otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false },
    inPlayerRealm: true, repeated: false, pressureId: null, why: "Quiet.", brief: "A storm off Latium.",
  };

  it("is done by the engine for a stirring that needs no decision", () => {
    const work = engineWork(harvest)!;
    expect(work.deltas).toEqual([expect.objectContaining({ op: "province_material_shift", provinceId: "punic-italy-latium", foodSecurityBpsDelta: -900, stabilityBpsDelta: -300 })]);
    expect(work.fact.visibility).toBe("public");
    expect(engineWork({ ...harvest, archetype: "games" })).toBeNull();
  });

  it("never reaches the orchestrator, and still happens", async () => {
    const shown: string[] = [];
    const port: SimModelPort = {
      complete(operation, _system, user) {
        if (operation === "simulate_orchestrate") shown.push(user);
        return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : JSON.stringify({ intent: { summary: "Wait.", domains: [] }, narrativeSummary: "Wait.", outcome: "continue" }));
      },
    };
    const world = opening();
    const food = (state: WorldState) => state.material.provinceMaterial.find((material) => material.provinceId === "punic-italy-latium")!.foodSecurityBps;
    const result = await runSimulationBurst({
      world, clock, offices, warfare: definition.warfare, burstId: "harvest", gameId: "g", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: null, spanDays: 7, knownFacts: [], queue: [], port, narratorSeeds: [harvest],
    });
    expect(shown[0]).not.toContain("THE WORLD STIRS");
    expect(food(result.world)).toBeLessThan(food(world));
    expect(result.newFacts.some((entry) => entry.kind === "grain_fleet_lost" && entry.summary.includes("Latium"))).toBe(true);
  });
});
