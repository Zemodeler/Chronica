import { describe, expect, it } from "vitest";
import {
  WorldDeltaSchema, coinageInWords, coinageOfPolity, conversionBps, exchangeRateBps, isBillon, mercenaryGracePeriods, mercenaryWageBps, priceLevelBpsOf, standardOf, type WorldState,
} from "@chronica/shared";
import { applyDecision, atDay, opening, withWar } from "./fiscal-test-kit";
import { monthOfCoinage } from "./coinage";
import type { StatecraftDecision } from "./statecraft";

/**
 * "Carthage strikes billon."
 *
 * Carthage paid its hired men in coin struck for them, on the Attic weight, because they would take no lighter; and by the end of the Mercenary War the
 * treasury was striking billon, silver with bronze in it, for it had nothing else to strike. Struck down twice by a sixth, the shekel is billon: prices
 * follow it up over the months, the money-changers give less of Rome's coin for it, and the companies it pays want their wage in what the coin was struck to
 * be worth, at once, and wait the less for it (the indexing is `mercenary-pay.ts`).
 */

const strike = (world: WorldState, day: number): WorldState => {
  const delta = WorldDeltaSchema.parse({ op: "coinage_debase", coinageId: "carthaginian_shekel", targetSilverBps: null, stepBps: -1_700, reason: "The treasurer has the mint strike lighter coin: the war has emptied the chest." });
  const actor = world.characters.find((character) => character.polityId === "carthage" && character.alive)!;
  const decision = { polityId: "carthage", actorCharacterId: actor.id, act: "fiscal", targetPolityId: null, why: "coinage: struck lighter", deltas: [delta], facts: [] } as unknown as StatecraftDecision;
  const struck = applyDecision(atDay(world, day), decision, day);
  expect(struck.rejected).toEqual([]);
  return struck.world;
};

/** The months' pass run over `months` months from `from`, the way the world runs it. */
function throughMonths(start: WorldState, from: number, months: number): WorldState {
  let world = start;
  for (let n = 1; n <= months; n += 1) {
    const day = from + n * 30;
    world = monthOfCoinage(atDay(world, day), [day], day).world;
  }
  return world;
}

describe("Carthage strikes billon", () => {
  const base = withWar(opening(), "carthage", "rome");
  const once = strike(base, 120);
  const twice = strike(throughMonths(once, 120, 3), 480);

  it("calls a coin billon when a quarter of its silver is gone, and not before", () => {
    expect(isBillon(coinageOfPolity(base, "carthage"))).toBe(false);
    expect(isBillon(coinageOfPolity(once, "carthage"))).toBe(false);
    const coin = coinageOfPolity(twice, "carthage");
    expect(isBillon(coin)).toBe(true);
    expect(coin.silverBps).toBeLessThan(standardOf(coin) * 0.75);
    expect(coin.silverBps).toBeGreaterThan(standardOf(coin) * 0.6);
    expect(coinageInWords(coin)).toMatch(/billon/);
    expect(coin.history).toHaveLength(2);
  });

  it("lifts prices over the months after the strike, toward what the lighter silver says and never past it", () => {
    const coin = coinageOfPolity(twice, "carthage");
    const target = Math.round((10_000 * standardOf(coin)) / coin.silverBps);
    expect(priceLevelBpsOf(twice, "carthage")).toBeLessThan(target);
    const later = throughMonths(twice, 480, 12);
    expect(priceLevelBpsOf(later, "carthage")).toBeGreaterThan(priceLevelBpsOf(twice, "carthage"));
    expect(priceLevelBpsOf(later, "carthage")).toBeLessThanOrEqual(target);
    expect(priceLevelBpsOf(later, "carthage")).toBeLessThan(15_000);
  });

  it("buys fewer of Rome's coin among the money-changers, and costs more to send abroad", () => {
    const sound = coinageOfPolity(base, "carthage");
    const billon = coinageOfPolity(throughMonths(twice, 480, 12), "carthage");
    const rome = coinageOfPolity(base, "rome");
    expect(exchangeRateBps(throughMonths(twice, 480, 12), billon.id, rome.id)).toBeLessThan(exchangeRateBps(base, sound.id, rome.id));
    expect(billon.premiumBps).toBeLessThan(sound.premiumBps);
    expect(conversionBps(throughMonths(twice, 480, 12), billon.id, rome.id)).toBeLessThanOrEqual(conversionBps(base, sound.id, rome.id));
  });

  it("makes the hired companies ask more of its pay and wait less for it", () => {
    const contract = base.material.contracts.find((candidate) => candidate.role === "mercenary" && candidate.employerAccountId === "carthage-treasury")!;
    expect(mercenaryWageBps(base, contract, 0)).toBe(10_000);
    expect(mercenaryWageBps(twice, contract, 0)).toBeGreaterThan(13_000);
    expect(mercenaryGracePeriods(base, contract)).toBe(2);
    expect(mercenaryGracePeriods(twice, contract)).toBe(0);
  });

  it("does not run away: two strikes in a war are a third of the silver at most, and the year's cooldown holds the rest", () => {
    const coin = coinageOfPolity(twice, "carthage");
    expect(coin.silverBps).toBeGreaterThanOrEqual(Math.round(standardOf(coin) * 0.6));
    expect(priceLevelBpsOf(throughMonths(twice, 480, 36), "carthage")).toBeLessThanOrEqual(Math.round((10_000 * standardOf(coin)) / coin.silverBps));
  });
});
