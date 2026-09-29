import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type WorldState } from "../index";
import { buildStation, factsKnownToStation } from "../authority/station";
import { emitFacts, factsKnownTo, factsVisibleTo, type Fact, type FactDraft } from "./facts";
import { kmBetween } from "./movement";
import { MAX_NEWS_DAYS, newsArrivalsAt, newsArrivesAt, newsDaysBetween, whereItHappened, whereTheyHear } from "./news";

/**
 * A battle in Sicily is not known in Rome the hour it is fought.
 *
 * `knowableAtInstant` was one instant for the whole world, and nobody set it
 * but the model, so news was everywhere at once. Now it travels the province
 * graph at a courier's pace from where it happened to where its reader is.
 */

const offices = ScenarioDefinitionSchema.parse(punicWarsScenario.definition).government.offices;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const provinceOf = (state: WorldState, settlementId: string): string =>
  state.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === settlementId))!.id;

let counter = 0;
function fact(overrides: Partial<FactDraft>): Fact {
  return emitFacts([{
    time: { day: 0, minute: 0 }, atStep: 0, kind: "battle", summary: "A battle.", affectedEntities: [], resourceChanges: [], authorityChange: undefined,
    visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, evidence: null,
    eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0, ...overrides,
  }], () => `news-${(counter += 1)}`)[0]!;
}

/** Somebody standing in that province. */
function standingIn(state: WorldState, provinceId: string): { world: WorldState; id: string } {
  const person = state.characters.find((character) => character.alive && character.polityId === "rome")!;
  return { world: { ...state, characters: state.characters.map((character) => (character.id === person.id ? { ...character, locationProvinceId: provinceId } : character)) }, id: person.id };
}

describe("the road news travels", () => {
  it("is longer to Carthage than to Messana, and nothing is further than a month", () => {
    const state = world();
    const rome = provinceOf(state, "settlement-rome");
    const messana = provinceOf(state, "settlement-messana");
    const carthage = provinceOf(state, "settlement-carthage");
    const athens = provinceOf(state, "settlement-athens");
    expect(newsDaysBetween(state, rome, rome)).toBe(0);
    const toMessana = newsDaysBetween(state, rome, messana);
    expect(toMessana).toBeGreaterThan(0);
    expect(newsDaysBetween(state, rome, carthage)).toBeGreaterThan(toMessana);
    expect(newsDaysBetween(state, messana, rome)).toBe(toMessana);
    expect(newsDaysBetween(state, rome, athens)).toBeLessThanOrEqual(MAX_NEWS_DAYS);
  });

  it("holds nothing back on a map that draws no road between two places", () => {
    // The small scenario joins Sicily to nothing: it cannot say how far Rome
    // is, and a world without borders is not one where nobody hears anything.
    const small = WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
    const rome = provinceOf(small, "settlement-rome");
    const consulIn = small.characters.find((character) => character.id === "marcus-atilius")!.locationProvinceId;
    expect(kmBetween(small, rome, consulIn)).toBeNull();
    expect(newsDaysBetween(small, rome, consulIn)).toBe(0);
  });

  it("starts where the fact names a place, a man or an army, and at a power's capital when it names only powers", () => {
    const state = world();
    const messana = provinceOf(state, "settlement-messana");
    expect(whereItHappened(state, { affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "province", id: messana }] })).toEqual([messana]);
    expect(whereItHappened(state, { affectedEntities: [{ kind: "polity", id: "carthage" }, { kind: "polity", id: "rome" }] })).toEqual([provinceOf(state, "settlement-carthage")]);
    expect(whereItHappened(state, { affectedEntities: [] })).toEqual([]);
    expect(whereTheyHear(state, { kind: "polity", id: "rome" })).toBe(provinceOf(state, "settlement-rome"));
  });

  it("reaches a man in Rome days after a battle at Messana, and a man at Messana at once", () => {
    const state = world();
    const messana = provinceOf(state, "settlement-messana");
    const battle = fact({ affectedEntities: [{ kind: "province", id: messana }] });
    const inRome = standingIn(state, provinceOf(state, "settlement-rome"));
    const atMessana = standingIn(state, messana);
    const days = newsDaysBetween(state, messana, provinceOf(state, "settlement-rome"));
    expect(newsArrivesAt(atMessana.world, battle, { kind: "character", id: atMessana.id })).toBe(0);
    expect(newsArrivesAt(inRome.world, battle, { kind: "character", id: inRome.id })).toBe(days * 1440);

    const reader = { kind: "character" as const, id: inRome.id };
    expect(factsVisibleTo([battle], reader, { day: days - 1, minute: 0 }, inRome.world)).toEqual([]);
    expect(factsVisibleTo([battle], reader, { day: days, minute: 0 }, inRome.world)).toEqual([battle]);
    // Without the world there is no road, only the fact's own instant.
    expect(factsVisibleTo([battle], reader, { day: 0, minute: 0 })).toEqual([battle]);
  });

  it("never arrives before the fact's own travel time, however near", () => {
    const state = world();
    const messana = provinceOf(state, "settlement-messana");
    const atMessana = standingIn(state, messana);
    const rumour = fact({ affectedEntities: [{ kind: "province", id: messana }], discovery: { state: "rumoured", knowableAtInstant: { day: 9, minute: 0 }, discoveredBy: [] } });
    expect(factsVisibleTo([rumour], { kind: "character", id: atMessana.id }, { day: 8, minute: 0 }, atMessana.world)).toEqual([]);
    expect(factsVisibleTo([rumour], { kind: "character", id: atMessana.id }, { day: 9, minute: 0 }, atMessana.world)).toEqual([rumour]);
  });

  it("brings a government's dispatches to its people on the same road, and its witnesses at once", () => {
    const state = world();
    const messana = provinceOf(state, "settlement-messana");
    const inRome = standingIn(state, provinceOf(state, "settlement-rome"));
    const dispatch = fact({ visibility: "polity", discovery: { state: "polity", knowableAtInstant: null, discoveredBy: [] }, affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "province", id: messana }] });
    const reader = { kind: "character" as const, id: inRome.id };
    expect(factsKnownTo([dispatch], reader, "rome", { day: 0, minute: 0 }, inRome.world)).toEqual([]);
    expect(factsKnownTo([dispatch], reader, "rome", { day: MAX_NEWS_DAYS, minute: 0 }, inRome.world)).toEqual([dispatch]);
    const station = buildStation({ world: inRome.world, characterId: inRome.id, offices });
    expect(factsKnownToStation([dispatch], station, { day: 0, minute: 0 }, inRome.world)).toEqual([]);

    const witnessed = fact({ ...dispatch, discovery: { state: "polity", knowableAtInstant: null, discoveredBy: [{ observerRef: reader, atInstant: { day: 0, minute: 0 }, via: "witnessed" }] } });
    expect(factsKnownTo([witnessed], reader, "rome", { day: 0, minute: 0 }, inRome.world)).toEqual([witnessed]);
  });
});

describe("the days word comes in", () => {
  it("are one for each place a man waits for it, so a burst can stop on each", () => {
    const state = world();
    const messana = provinceOf(state, "settlement-messana");
    const rome = provinceOf(state, "settlement-rome");
    const carthage = provinceOf(state, "settlement-carthage");
    const battle = fact({ time: { day: 3, minute: 0 }, affectedEntities: [{ kind: "province", id: messana }], discovery: { state: "public", knowableAtInstant: { day: 3, minute: 0 }, discoveredBy: [] } });
    const keys = newsArrivalsAt(state, battle, [messana, rome, carthage]);
    expect(keys).toEqual([
      3 * 1440,
      (3 + newsDaysBetween(state, messana, rome)) * 1440,
      (3 + newsDaysBetween(state, messana, carthage)) * 1440,
    ].sort((a, b) => a - b));
    // Each is the day that reader has it, and no sooner.
    expect(keys).toContain(newsArrivesAt(state, battle, { kind: "polity", id: "carthage" }));
  });
});
