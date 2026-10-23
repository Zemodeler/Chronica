import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, kmBetween, type CovertPlot, type WorldState } from "@chronica/shared";
import { peopleAround, plotsOf, salienceContextOf } from "./cast";
import { ASK_REACH_KM, createCognitionPolicy, playerInterests } from "./cognition-policy";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { routeAmbientActors } from "./attention";
import type { SimModelPort } from "./ports";

/**
 * Far people are never asked (the user's rule, 2026-10-08): model calls are for the plots and plans of people near the player and for the rotating cast around him
 * (the nemesis, his friends, the voices of the wider world); everybody else runs on the rules. A whole power is no longer "regional": the test is the man's own.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const PLAYER = "gaius-genucius";
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const person = (world: WorldState, id: string) => world.characters.find((character) => character.id === id)!;
const plotOf = (sponsor: string, target: string): CovertPlot => ({
  id: `plot-${sponsor}`, kind: "assassination", targetCharacterId: target, sponsorCharacterId: sponsor, agentCharacterId: null, spend: 0, cover: "A fever.", successOddsBps: 4_000, secrecyBps: 6_000,
  openedAtStep: 0, resolvesAtStep: 120, storylineId: null, outcome: null, resolvedAtStep: null,
} as unknown as CovertPlot);
const kmFromPlayer = (world: WorldState, id: string): number => kmBetween(world, person(world, PLAYER).locationProvinceId, person(world, id).locationProvinceId) ?? Number.POSITIVE_INFINITY;
/** A man far from the player, with nothing at all to do with him. */
const farMan = (world: WorldState): string => world.characters.find((character) => character.alive && character.id !== PLAYER && kmFromPlayer(world, character.id) > 3 * ASK_REACH_KM
  && !world.cast.members.some((member) => member.characterId === character.id) && playerInterests(world, PLAYER, offices).detailOf(character.id) === "background")!.id;

describe("far people are never asked", () => {
  it("makes a whole power background, whatever its generals and councillors are doing", () => {
    const world = opening();
    const interests = playerInterests(world, PLAYER, offices);
    // Of the opening's nine hundred, only the player's own circle and the near are ever askable.
    const askable = world.characters.filter((character) => interests.detailOf(character.id) !== "background");
    expect(askable.length).toBeLessThan(40);
    for (const character of askable) {
      const near = interests.nearPlaces.has(character.locationProvinceId);
      const circle = interests.people.has(character.id);
      expect(near || circle, `${character.name} is asked and is neither near nor of his circle`).toBe(true);
    }
    // And the router never offers one of the rest, plot or no plot.
    const id = farMan(world);
    const plotted: WorldState = { ...world, covertPlots: [plotOf(id, "gnaeus-cornelius")] };
    const now = playerInterests(plotted, PLAYER, offices);
    expect(now.detailOf(id)).toBe("background");
    expect(now.eligibleCharacterIds.has(id)).toBe(false);
    const routed = routeAmbientActors({ world: plotted, cognitionEligible: now.eligibleCharacterIds, facts: [], offices, excludeCharacterIds: [PLAYER], max: 50 });
    expect(routed.map((actor) => actor.characterId)).not.toContain(id);
    expect(createCognitionPolicy().shouldAsk({ ref: { kind: "character", id }, characterId: id, name: "x", level: "focused", impetus: "own_business", score: 90, pressing: true, knownFacts: [], why: "x" }, plotted, now, new Map(), new Map())).toBe(false);
  });

  it("asks a man near the player only with a plot or plan of his own, and the men who deal with him always", () => {
    const world = opening();
    const circle = peopleAround(world, person(world, PLAYER), { letters: false });
    const interests = playerInterests(world, PLAYER, offices);
    // The cast rule (2026-10-08): the consul's colleague is of the player's office, so he is askable by his dealing, plot or none.
    expect(circle.has("gnaeus-cornelius")).toBe(true);
    expect(interests.detailOf("gnaeus-cornelius")).toBe("personal");
    // A man who is near and of nobody's circle, with no plot and no plan, is not.
    const near = world.characters.find((character) => character.alive && character.id !== PLAYER && !circle.has(character.id) && interests.nearPlaces.has(character.locationProvinceId)
      && !world.cast.members.some((member) => member.characterId === character.id) && interests.detailOf(character.id) === "background"
      && plotsOf(world, character, PLAYER, salienceContextOf(world, PLAYER)).length === 0)!;
    expect(near).toBeDefined();
    // With a plot that touches the player (laid against his colleague), he is.
    const plotted: WorldState = { ...world, covertPlots: [plotOf(near.id, "gnaeus-cornelius")] };
    expect(playerInterests(plotted, PLAYER, offices).detailOf(near.id)).toBe("personal");
    // A plot that touches nobody of his is nothing: it was a plot before 2026-10-08 and is not now.
    const aside: WorldState = { ...world, covertPlots: [plotOf(near.id, farMan(world))] };
    expect(playerInterests(aside, PLAYER, offices).detailOf(near.id)).toBe("background");
  });

  it("keeps the cast, the nemesis and a shared thread askable wherever they are, and a kept relation only as a near man with a plot", () => {
    const world = opening();
    const id = farMan(world);
    expect(playerInterests(world, PLAYER, offices).detailOf(id)).toBe("background");
    const seated: WorldState = { ...world, cast: { ...world.cast, members: [{ characterId: id, seat: "world", sinceStep: 0, salience: 30, why: "rules a power the player deals with", belowFor: 0, reviews: 0 }] } };
    expect(playerInterests(seated, PLAYER, offices).detailOf(id)).toBe("personal");
    // A relation with a kept cause is not a dealing (2026-10-08: it was in the circle wherever the man stood).
    const related: WorldState = { ...world, characters: world.characters.map((character) => (character.id === PLAYER
      ? { ...character, relations: [...character.relations, { subjectCharacterId: id, causes: [{ id: "c1", label: "An old creditor.", score: 10, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] } : character)) };
    expect(playerInterests(related, PLAYER, offices).detailOf(id)).toBe("background");
    const storied: WorldState = { ...world, storylines: [...world.storylines, { id: "s-far", title: "A quarrel", participantIds: [PLAYER, id], provinceId: null, phase: "brewing", stakes: "x", history: [], nextDevelopment: "x", visibility: "private", updatedAtStep: 0, closedAtStep: null } as never] };
    expect(playerInterests(storied, PLAYER, offices).detailOf(id)).toBe("personal");
    // A man he has ordered is of his circle for the order's life; a letter's far reader is not (he is asked once, at the sending: `a-far-letter-is-not-re-woken`).
    const lettered: WorldState = { ...world, diplomacy: [...world.diplomacy, { id: "m-far", kind: "letter", fromPolityId: "rome", fromCharacterId: PLAYER, toPolityId: person(world, id).polityId ?? "rome", toCharacterId: id, subject: "x", terms: "x", sentAtStep: 0, replyDueByStep: 30, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "private", onRefusal: null } as never] };
    expect(playerInterests(lettered, PLAYER, offices).detailOf(id)).toBe("background");
  });

  it("asks nobody far in a month of the world, whatever his power is doing", async () => {
    const world = opening();
    const asked = new Set<string>();
    const port: SimModelPort = { complete(operation, _system, user) {
      if (operation === "simulate_cognition") { for (const match of user.matchAll(/^## .+ \[([^\]]+)\]$/gm)) asked.add(match[1]!); return Promise.resolve('{"actors":[]}'); }
      return Promise.resolve(JSON.stringify({ intent: { summary: "Wait", domains: ["administration"] }, narrativeSummary: "Time passes.", deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
    } };
    const result = await runSimulationBurst({ world, clock: definition.clock, offices, warfare: definition.warfare, burstId: "far-month", gameId: "far-month", actorRef: { kind: "character", id: PLAYER },
      actorPolityId: "rome", orderText: "Let a month pass.", spanDays: 30, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET });
    expect(asked.size).toBeGreaterThan(0);
    const reach = playerInterests(result.world, PLAYER, offices);
    const seated = new Set(result.world.cast.members.map((member) => member.characterId));
    for (const id of asked) {
      const circle = seated.has(id) || reach.people.has(id) || reach.nearPlaces.has(person(result.world, id).locationProvinceId);
      expect(circle, `${person(result.world, id).name} is far, uncast, and was asked`).toBe(true);
    }
  }, 120_000);
});
