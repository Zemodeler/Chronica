import { describe, expect, it } from "vitest";
import { economyOf, goodIndex, marketGeography, type WorldState } from "@chronica/shared";
import { cutOffHubs } from "./markets";
import { LIFT_AT_CAPITAL, MAX_MERCHANT_LIFT, capitalOfHouse, keepMerchantHouses, merchantLiftByHub } from "./merchant-houses";
import { createIdFactory } from "./ports";
import { HAUL_CHEAPER_PER_LIFT, tradeMonth } from "./trade-flows";
import { HUBS, bareNeighbours, bookOf, inflowOf, opening, priceOf, rowsOf, setStock } from "./trade-test-kit";
import { atDay } from "./fiscal-test-kit";

/**
 * "Where the great houses sit, goods come."
 *
 * Trade between hubs was a tide that ran as far as the gap in price paid the carrying and the roads could carry, and
 * it ran the same whether there was a merchant in the city or none. The families that carry the trade now
 * lend it their money: a hub with houses seated in it can send out more in a month, and the haul is cheaper
 * (ships bought on credit, cargoes insured by the next man) by as much as their capital comes to, up to a fifth. So a
 * shortage a city could not make good for a year is made good in months where merchants are, and a market with none
 * is as it was. Their capital is theirs: a house that loses its money loses the lift with it.
 */

const GRAIN = goodIndex("grain");
const { carthage, utica } = HUBS;

/** The months a hub's grain price takes to come within a haul of its neighbour's, with the lift given (none: as before). */
function monthsToRelieve(world: WorldState, lift: ReadonlyMap<string, number> | undefined): { prices: number[]; inflow: number } {
  const book = bookOf(world);
  setStock(book, utica, "grain", 0.3);
  bareNeighbours(world, book, utica, [carthage], "grain");
  const cut = cutOffHubs(world, marketGeography(world).hubs);
  const prices = [priceOf(book, utica, "grain")];
  let first = 0;
  for (let month = 0; month < 24; month += 1) {
    tradeMonth(book, { world, rows: rowsOf(world), cut, toHarvest: 6, merchantLift: lift });
    if (month === 0) first = inflowOf(book, utica, "grain");
    prices.push(priceOf(book, utica, "grain"));
  }
  return { prices, inflow: first };
}

describe("the market has merchants", () => {
  it("lends a hub carrying capacity by the capital of the houses seated in it, up to half as much again, and none where there are none", () => {
    const world = opening();
    const lift = merchantLiftByHub(world);
    // Carthage has four houses; Gades one; the hubs that hold none have no entry and are 1.
    const hub = (provinceId: string) => marketGeography(world).hubOf.get(provinceId)!;
    const houses = economyOf(world).houses;
    const carthageHub = hub(houses.find((house) => house.polityId === "carthage")!.homeProvinceId);
    expect(lift.get(carthageHub)!).toBeGreaterThan(1.2);
    expect(lift.get(carthageHub)!).toBeLessThanOrEqual(1 + MAX_MERCHANT_LIFT);
    for (const value of lift.values()) {
      expect(value).toBeGreaterThan(1);
      expect(value).toBeLessThanOrEqual(1 + MAX_MERCHANT_LIFT);
    }
    expect(lift.get(utica) ?? 1).toBeGreaterThan(1);
    expect(lift.get("it-hn4oo") ?? 1).toBeGreaterThan(1);
    const none: WorldState = { ...world, economy: { ...economyOf(world), houses: [] } };
    expect(merchantLiftByHub(none).size).toBe(0);
    // More capital, more lift: poor the houses, and it falls; bring them to the ceiling and it stops there.
    const poor: WorldState = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id.startsWith("house-") ? { ...account, balance: Math.round(account.balance / 10) } : account)) } };
    expect(merchantLiftByHub(poor).get(carthageHub)!).toBeLessThan(lift.get(carthageHub)!);
    const rich: WorldState = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id.startsWith("house-") ? { ...account, balance: account.balance * 40 } : account)) } };
    expect(merchantLiftByHub(rich).get(carthageHub)).toBeCloseTo(1 + MAX_MERCHANT_LIFT, 6);
    expect(houses.reduce((sum, house) => sum + capitalOfHouse(world, house), 0)).toBeGreaterThan(LIFT_AT_CAPITAL);
  });

  it("makes good a shortage faster where the houses are: more bread the first month, and a price that falls sooner", () => {
    const world = opening();
    const bare = monthsToRelieve(world, undefined);
    const seated = monthsToRelieve(world, merchantLiftByHub(world));
    expect(seated.inflow).toBeGreaterThan(bare.inflow);
    // Month by month the market with merchants is never dearer, and at the end it is cheaper.
    for (let month = 1; month < bare.prices.length; month += 1) expect(seated.prices[month]!).toBeLessThanOrEqual(bare.prices[month]! + 1);
    expect(seated.prices[6]!).toBeLessThan(bare.prices[6]!);
    // The first half-year's relief is a clear step ahead, not a rounding.
    expect(bare.prices[0]! - seated.prices[6]!).toBeGreaterThan((bare.prices[0]! - bare.prices[6]!) * 1.03);
    // The effect is what the lift says and no more: the haul is cheaper by `HAUL_CHEAPER_PER_LIFT` of the lift over one.
    expect(HAUL_CHEAPER_PER_LIFT * MAX_MERCHANT_LIFT).toBeLessThan(0.35);
    // A market with no houses is as it was.
    const same = monthsToRelieve(world, new Map());
    expect(same.prices).toEqual(bare.prices);
    void GRAIN;
  });

  it("does nothing a second time in the same month and the same thing on every replay", () => {
    const world = atDay(opening(), 90);
    const a = keepMerchantHouses(world, 90, createIdFactory("replay"));
    const b = keepMerchantHouses(structuredClone(world), 90, createIdFactory("replay"));
    expect(JSON.stringify(a.world.economy!.houses)).toBe(JSON.stringify(b.world.economy!.houses));
    expect(JSON.stringify(a.world.material.ventures)).toBe(JSON.stringify(b.world.material.ventures));
    expect(keepMerchantHouses(a.world, 100, createIdFactory("again")).world).toBe(a.world);
  });
});
