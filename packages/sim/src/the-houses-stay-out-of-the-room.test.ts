import { describe, expect, it } from "vitest";
import { CAST_ENTER_AT, economyOf, type WorldState } from "@chronica/shared";
import { playerInterests } from "./cognition-policy";
import { reviewCast, salienceOf } from "./cast";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { definition, logged, opening } from "./fiscal-test-kit";
import { decideFiscal, fiscalSliceLine } from "./fiscal-officers";
import { atDay, input, withChest, withIncome, withWar } from "./fiscal-test-kit";

/**
 * "A banker of Neapolis is not a person the model is asked about, unless the consul has gone to him."
 *
 * Seventeen houses, with a head and an heir each, are thirty-four more people in a world of three hundred. They run
 * on rules (`merchant-houses.ts`), and nothing about them may reach the model's room uninvited: not the cast of
 * those it is asked about, not the set of people whose province it is asked about, not the page of the world it reads.
 * A house that the player's own circle touches -- a letter to its head, a loan he asked for -- is another matter,
 * and is a person like any other.
 */

const PLAYER = "gaius-genucius";
const slice = (world: WorldState, actor = PLAYER, polity = "rome"): string => renderWorldSlice(buildWorldSlice({
  world, clock: definition.clock, offices: definition.government.offices, actorRef: { kind: "character", id: actor }, actorPolityId: polity,
  orderText: "Look to the republic", facts: [], dueEvents: [], pendingEvents: [],
}));

describe("the houses stay out of the room", () => {
  const world = opening();
  const houses = economyOf(world).houses;
  const folk = new Set(houses.flatMap((house) => [house.headCharacterId, world.characters.find((character) => character.id === house.headCharacterId)!.heirCharacterId!]));

  it("are not in the standing cast, and not near enough to it to be promoted", () => {
    const cast = reviewCast(world, PLAYER, 12);
    expect(cast.cast.members.some((member) => folk.has(member.characterId))).toBe(false);
    for (const id of folk) expect(salienceOf(world, world.characters.find((character) => character.id === id)!, PLAYER).score).toBeLessThan(CAST_ENTER_AT);
  });

  it("are background people to the model even in the province the consul stands in, unless his own circle touches them", () => {
    const rome = houses.find((house) => house.kind === "publicani")!;
    const head = world.characters.find((character) => character.id === rome.headCharacterId)!;
    const consul = world.characters.find((character) => character.id === PLAYER)!;
    expect(head.locationProvinceId).toBe(consul.locationProvinceId);
    const interests = playerInterests(world, PLAYER, definition.government.offices);
    expect(interests.detailOf(head.id)).toBe("background");
    expect(interests.eligibleCharacterIds.has(head.id)).toBe(false);
    // A man of the senate who lives where the consul does is as near as ever.
    const senator = world.characters.find((character) => character.polityId === "rome" && character.id !== PLAYER && character.locationProvinceId === consul.locationProvinceId && !folk.has(character.id))!;
    expect(interests.detailOf(senator.id)).not.toBe("background");
    // And when the consul writes to the head of the house he is one of the consul's own people, a person like any other.
    const written: WorldState = { ...world, characters: world.characters.map((character) => (character.id === PLAYER ? { ...character, relations: [...character.relations, { subjectCharacterId: head.id, causes: [{ id: "borrowed", label: "He lent the consul money for the war.", score: 12, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null, dimensions: { trust: 12 } }] }] } : character)) };
    expect(playerInterests(written, PLAYER, definition.government.offices).detailOf(head.id)).toBe("personal");
  });

  it("add nothing to the page the consul reads, and a power's accounts add one short line a month or two after they are touched", () => {
    const bare = slice(world);
    // The same world with the seventeen houses and everybody in them taken out of it altogether.
    const gone: WorldState = {
      ...world,
      economy: { ...economyOf(world), houses: [] },
      characters: world.characters.filter((character) => !folk.has(character.id)),
      material: { ...world.material, accounts: world.material.accounts.filter((account) => !account.id.startsWith("house-")) },
    };
    const without = slice(gone);
    expect(bare.length).toBe(without.length);
    // Carthage's officer has raised its tax in a war; a ruler the model plays there reads one line more, and Rome's consul none.
    const poor = withIncome(withChest(withWar(opening(), "carthage", "rome"), "carthage", 2_000, 90_000), "carthage", 0.1);
    const day = [120, 150, 180, 210, 240, 270].find((at) => decideFiscal(input(atDay(poor, at))).some((decision) => decision.polityId === "carthage"))!;
    const decision = decideFiscal(input(atDay(poor, day))).find((found) => found.polityId === "carthage")!;
    const after = logged(atDay(poor, day), decision);
    expect(slice(after).length).toBe(slice(atDay(poor, day)).length);
    const line = fiscalSliceLine(after, "carthage")!;
    expect(line.length).toBeLessThan(260);
    const hanno = slice(after, "hanno-carthage", "carthage");
    expect(hanno).toContain("Its accounts: raised the rate");
    expect(hanno.length - slice(atDay(poor, day), "hanno-carthage", "carthage").length).toBeLessThan(300);
    // And two months on it is gone again.
    expect(slice(atDay(after, day + 100), "hanno-carthage", "carthage")).not.toContain("Its accounts:");
    expect(fiscalSliceLine(after, "rome")).toBeNull();
  });

  it("are a few in a hundred of the people in the world, and no more than twenty houses", () => {
    expect(folk.size).toBeLessThanOrEqual(2 * 20);
    expect(folk.size / world.characters.length).toBeLessThan(0.08);
    expect(houses.length).toBeLessThanOrEqual(20);
  });
});
