import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type CastMember, type WorldState } from "@chronica/shared";
import { FAR_REST_DAYS, NEAR_WORLD_REST_DAYS, aFarManRests, aSeedIsWithinReach, anOwnerIsNear, circleOf, touchedByThePlayer } from "./far-cast-rests";
import { playerInterests } from "./cognition-policy";
import { createCognitionMemory } from "./cognition-memory";
import type { NarratorSeed } from "./narrator";
import { powersNearThePlayer } from "./far-powers";

/**
 * A far man in the cast rests between asks: Hanno of Carthage was asked twenty and thirty times in a run, a ruler of the Boii and a Massalia priest
 * as often. He is asked, then left to the rules for `FAR_REST_DAYS` unless the player's own business touches him.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const PLAYER = "gaius-genucius";
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const seated = (characterId: string, seat: CastMember["seat"]): CastMember => ({ characterId, seat, sinceStep: 0, salience: 40, why: "x", belowFor: 0, reviews: 0 });

/** A character far from the player: the first living man of a power he does not deal with. */
const farRuler = (world: WorldState): string => {
  const near = powersNearThePlayer(world, PLAYER)!;
  const interests = playerInterests(world, PLAYER, offices);
  return world.characters.find((character) => character.alive && character.polityId !== null && !near.has(character.polityId) && !interests.nearPlaces.has(character.locationProvinceId))!.id;
};

describe("far cast men rest between asks", () => {
  it("leaves a far man of the world's seat to the rules for the rest, and asks him when it is over", () => {
    const world = opening();
    const id = farRuler(world);
    const member = seated(id, "world");
    const interests = playerInterests(world, PLAYER, offices);
    const circle = circleOf(world, PLAYER);
    const touched = touchedByThePlayer(world, PLAYER);
    const now = world.elapsedStep;
    expect(aFarManRests(world, member, interests, circle, touched, null)).toBe(false);
    expect(aFarManRests(world, member, interests, circle, touched, now - 1)).toBe(true);
    expect(aFarManRests(world, member, interests, circle, touched, now - (FAR_REST_DAYS - 1))).toBe(true);
    expect(aFarManRests(world, member, interests, circle, touched, now - FAR_REST_DAYS)).toBe(false);
  });

  it("never rests the player's own chain, his friends or the one set against him", () => {
    const world = opening();
    const id = farRuler(world);
    const interests = playerInterests(world, PLAYER, offices);
    for (const seat of ["nemesis", "chain", "friend"] as const) {
      expect(aFarManRests(world, seated(id, seat), interests, circleOf(world, PLAYER), new Set(), world.elapsedStep - 1)).toBe(false);
    }
  });

  it("asks him at once when a letter or an order of the player's is with him", () => {
    const world = opening();
    const id = farRuler(world);
    const interests = playerInterests(world, PLAYER, offices);
    expect(aFarManRests(world, seated(id, "world"), interests, circleOf(world, PLAYER), new Set([id]), world.elapsedStep - 1)).toBe(false);
  });

  it("rests a near man of the world's seat for a shorter while", () => {
    const world = opening();
    const interests = playerInterests(world, PLAYER, offices);
    const circle = circleOf(world, PLAYER);
    const nearId = world.characters.find((character) => character.alive && character.id !== PLAYER && interests.nearPlaces.has(character.locationProvinceId) && !circle.has(character.id))!.id;
    const member = seated(nearId, "world");
    expect(aFarManRests(world, member, interests, circle, new Set(), world.elapsedStep - (NEAR_WORLD_REST_DAYS - 1))).toBe(true);
    expect(aFarManRests(world, member, interests, circle, new Set(), world.elapsedStep - NEAR_WORLD_REST_DAYS)).toBe(false);
  });

  it("keeps when each man was last asked across bursts, for the length of the rest", () => {
    const memory = createCognitionMemory([{ characterId: "a", context: "x", reason: "y", atStep: 100, weight: 1, version: 1 }, { characterId: "b", context: "x", reason: "y", atStep: 40, weight: 1, version: 1 }], 120);
    const kept = memory.snapshot(120).map((review) => review.characterId);
    expect(kept).toContain("a");
    expect(kept).not.toContain("b");
    expect(memory.lastAskedStep("a")).toBe(100);
  });

  it("writes no rule for a far people's arrangement and shows the orchestrator no far stirring", () => {
    const world = opening();
    const id = farRuler(world);
    const interests = playerInterests(world, PLAYER, offices);
    const circle = circleOf(world, PLAYER);
    expect(anOwnerIsNear(world, { kind: "character", id }, PLAYER, interests, circle, powersNearThePlayer(world, PLAYER))).toBe(false);
    expect(anOwnerIsNear(world, { kind: "character", id: PLAYER }, PLAYER, interests, circle, powersNearThePlayer(world, PLAYER))).toBe(true);
    const far = world.characters.find((character) => character.id === id)!;
    const seed = (characterId: string | null, provinceId: string | null, inPlayerRealm = false): NarratorSeed => ({
      key: "k", kind: "person_problem", archetype: "illness", severity: "minor", secret: false, oneShot: true, inPlayerRealm, repeated: false, pressureId: null, why: "x", brief: "x",
      target: { provinceId, provinceName: null, polityId: null, polityName: null, characterId, characterName: null, otherPolityId: null, otherPolityName: null, forceId: null, forceName: null, forceIsNaval: false },
    });
    expect(aSeedIsWithinReach(seed(id, far.locationProvinceId), interests, circle, PLAYER)).toBe(false);
    expect(aSeedIsWithinReach(seed(PLAYER, null), interests, circle, PLAYER)).toBe(true);
    expect(aSeedIsWithinReach(seed(id, far.locationProvinceId, true), interests, circle, PLAYER)).toBe(true);
  });
});
