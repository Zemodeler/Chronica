import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, emitFacts, ensureProvinceMaterial, newsDaysBetween, type Fact, type FactDraft, type WorldState } from "@chronica/shared";
import { distanceFactor, farBusinessFloor, keepFarNewsHome, newsReachOf, TELLING_BAR } from "./far-news";
import { newsRelations, powersDealtWith } from "./far-powers";

/**
 * Far news, weighed by how far off it happened and what its powers are to the
 * player (L16). Forty days of the Codex play-test wrote 487 facts, and a war
 * between two Greek leagues reached a Roman consul at 42 against a bar of 40.
 */

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const PLAYER = "gaius-genucius";

let factCounter = 0;
function fact(overrides: Partial<FactDraft>): Fact {
  const draft: FactDraft = {
    time: { day: 0, minute: 0 }, atStep: 0, kind: "event", summary: "Something happened.", affectedEntities: [], resourceChanges: [],
    authorityChange: undefined, visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    evidence: null, eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0, ...overrides,
  };
  return emitFacts([draft], () => `far-fact-${(factCounter += 1)}`)[0]!;
}

/** Powers with ground, none of it within a fortnight of anything Rome holds, and nothing between them and Rome. */
function strangers(world: WorldState): string[] {
  const relations = newsRelations(world, PLAYER)!;
  const roman = world.map.provinces.filter((province) => province.controllerPolityId === "rome").map((province) => province.id);
  return world.map.polities.map((polity) => polity.id).filter((polityId) => {
    if (relations.has(polityId)) return false;
    const ground = world.map.provinces.filter((province) => province.controllerPolityId === polityId);
    return ground.length > 0 && ground.every((province) => roman.every((seat) => newsDaysBetween(world, province.id, seat) >= 16));
  });
}

describe("far news", () => {
  it("fades with the road: all of it near, a fifth from the far side of the world", () => {
    expect(distanceFactor(null)).toBe(1);
    expect(distanceFactor(3)).toBe(1);
    expect(distanceFactor(13)).toBeCloseTo(0.5);
    expect(distanceFactor(30)).toBe(0.2);
  });

  it("weighs the powers by what they are to the player, more narrowly than the slice's dealings", () => {
    const world = opening();
    const relations = newsRelations(world, PLAYER)!;
    expect(relations.get("rome")).toBe(1);
    // The slice's "dealt with" takes in most of the map; news takes in far fewer.
    expect(relations.size).toBeLessThan(powersDealtWith(world, PLAYER)!.size);
    for (const value of relations.values()) expect([0.5, 0.8, 1]).toContain(value);
    expect(strangers(world).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a war between two far strangers home, which once reached Rome at 42 against a bar of 40", () => {
    const world = opening();
    const [a, b] = strangers(world);
    const war = fact({ kind: "war_declared", summary: "Two far kings go to war.", affectedEntities: [{ kind: "polity", id: a! }, { kind: "polity", id: b! }] });
    const facts = [war];
    keepFarNewsHome(facts, 0, world, PLAYER);
    expect(facts[0]!.visibility).toBe("polity");
  });

  it("weighs a fact that names no power by the powers of whoever and wherever it names", () => {
    const world = opening();
    const [stranger] = strangers(world);
    const where = world.map.provinces.find((province) => province.controllerPolityId === stranger)!;
    const wedding = fact({ kind: "wedding", summary: "A far chief marries.", affectedEntities: [{ kind: "province", id: where.id }] });
    const facts = [wedding];
    keepFarNewsHome(facts, 0, world, PLAYER, new Map([[wedding.id, 50]]));
    expect(facts[0]!.visibility).toBe("polity");
  });

  it("never keeps the player's own news from him, however small", () => {
    const world = opening();
    const reach = newsReachOf(world, PLAYER)!;
    const ownGround = world.map.provinces.find((province) => province.controllerPolityId === "rome")!;
    const facts = [
      fact({ kind: "harvest", summary: "A thin harvest in Roman country.", affectedEntities: [{ kind: "province", id: ownGround.id }] }),
      fact({ kind: "letter_sent", summary: "The consul writes home.", affectedEntities: [{ kind: "character", id: PLAYER }] }),
      fact({ kind: "province_raided", summary: "Raiders in Roman country.", affectedEntities: [{ kind: "polity", id: strangers(world)[0]! }, { kind: "province", id: ownGround.id }] }),
    ];
    keepFarNewsHome(facts, 0, world, PLAYER, new Map(facts.map((candidate) => [candidate.id, 5])));
    for (const kept of facts) expect(kept.visibility).toBe("public");
    expect(reach.seats).toContain(ownGround.id);
  });

  it("writes down only the weighty business of powers that are nothing to the player", () => {
    const world = opening();
    const relations = newsRelations(world, PLAYER);
    const [stranger] = strangers(world);
    expect(farBusinessFloor(relations, [stranger!, null])).toBe(TELLING_BAR);
    expect(farBusinessFloor(relations, ["rome", stranger!])).toBeUndefined();
    expect(farBusinessFloor(null, [stranger!])).toBeUndefined();
  });
});
