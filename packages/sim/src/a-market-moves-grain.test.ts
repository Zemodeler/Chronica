import { describe, expect, it } from "vitest";
import { GOODS, economyOf, goodIndex, marketGeography } from "@chronica/shared";
import { reviewTheLand } from "./economy";
import { CROSSING_CAPACITY_SHARE, GRAIN_PROTECTED_MONTHS, LAND_HAUL_BPS_PER_100_KM } from "./trade-flows";
import { HUBS, bareNeighbours, bookOf, flow, inflowOf, opening, outflowOf, priceOf, setStock, stockOf } from "./trade-test-kit";

/**
 * A market moves grain (phase D of the economy rework).
 *
 * Every hub used to be a country of its own: a drought at one was a famine
 * there however full the granary next door. Goods now move between
 * neighbouring hubs, from the cheap market to the dear one, until the gap in
 * price is no more than what it costs to carry them. These pin that: a hub
 * that has run short is relieved from the next one, no more than the road can
 * carry and the seller can spare moves, a small gap does not pay, and what a
 * hub needs to reach the harvest is never sold.
 */

const GRAIN = goodIndex("grain");
const { carthage, utica } = HUBS;

describe("a market moves grain", () => {
  it("relieves a hub that has run short from the hub next to it", () => {
    const world = opening();
    const book = bookOf(world);
    setStock(book, utica, "grain", 0.3);
    const before = priceOf(book, utica, "grain");
    const sourceBefore = stockOf(book, carthage, "grain");
    flow(world, book);
    expect(inflowOf(book, utica, "grain")).toBeGreaterThan(0);
    expect(outflowOf(book, carthage, "grain")).toBeGreaterThan(0);
    expect(priceOf(book, utica, "grain")).toBeLessThan(before);
    expect(stockOf(book, carthage, "grain")).toBeLessThan(sourceBefore);
    // Grain is conserved: what left one stock is what reached another.
    const total = [...book.values()].reduce((sum, hub) => sum + hub.inflow[GRAIN]!, 0);
    const sent = [...book.values()].reduce((sum, hub) => sum + hub.outflow[GRAIN]!, 0);
    expect(total).toBe(sent);
  });

  it("relieves it a little more each month, and the gap closes to what the carrying costs", () => {
    const world = opening();
    const book = bookOf(world);
    setStock(book, utica, "grain", 0.3);
    bareNeighbours(world, book, utica, [carthage], "grain");
    const prices = [priceOf(book, utica, "grain")];
    // The carriers' capacity is a share of the hub's use a month, so a deep shortage takes a year or two to make good.
    for (let month = 0; month < 40; month += 1) {
      flow(world, book);
      prices.push(priceOf(book, utica, "grain"));
    }
    for (let month = 1; month < prices.length; month += 1) expect(prices[month]!).toBeLessThanOrEqual(prices[month - 1]!);
    // At the end the gap between the two is no more than a short haul over a developed road.
    const haul = (35 / 100) * LAND_HAUL_BPS_PER_100_KM.grain * 1.3;
    expect(priceOf(book, utica, "grain") - priceOf(book, carthage, "grain")).toBeLessThanOrEqual(haul);
    expect(priceOf(book, utica, "grain")).toBeLessThan(prices[0]! * 0.8);
  });

  it("moves no more in a month than the roads into the hub can carry", () => {
    const world = opening();
    const book = bookOf(world);
    setStock(book, utica, "grain", 0);
    flow(world, book);
    const demand = book.get(utica)!.demand[GRAIN]!;
    // Capacity is a share of what the buying hub uses in a month, by each way in, at most half as much again for a developed road.
    const ways = marketGeography(world).neighbours.get(utica)!;
    const most = ways.reduce((sum, way) => sum + demand * CROSSING_CAPACITY_SHARE[way.crossing] * 1.5, 0);
    expect(inflowOf(book, utica, "grain")).toBeGreaterThan(0);
    expect(inflowOf(book, utica, "grain")).toBeLessThanOrEqual(most);
    // The famine is far larger than the month's relief: the hub is still short.
    expect(stockOf(book, utica, "grain")).toBeLessThan(book.get(utica)!.target[GRAIN]! * 0.5);
  });

  it("does not move grain for a gap the carrying would eat", () => {
    const world = opening();
    const book = bookOf(world);
    // A hub eight in a hundred short: dearer, but by less than two hundred kilometres of road costs.
    setStock(book, HUBS.capua, "grain", 0.9);
    const gap = priceOf(book, HUBS.capua, "grain") - priceOf(book, HUBS.rome, "grain");
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan((200 / 100) * LAND_HAUL_BPS_PER_100_KM.grain * 0.75);
    flow(world, book);
    expect(inflowOf(book, HUBS.capua, "grain") + outflowOf(book, HUBS.capua, "grain")).toBe(0);
  });

  it("never sells what a hub needs to reach the harvest, however dear it is elsewhere", () => {
    const world = opening();
    const book = bookOf(world, 6);
    setStock(book, utica, "grain", 0);
    // Every neighbour holds exactly what its people need until the harvest and the protected months: nothing is spare.
    for (const near of marketGeography(world).neighbours.get(utica)!) {
      const hub = book.get(near.hubId)!;
      hub.stock[GRAIN] = (6 + GRAIN_PROTECTED_MONTHS) * hub.demand[GRAIN]!;
    }
    flow(world, book, 6);
    expect(inflowOf(book, utica, "grain")).toBe(0);
    for (const near of marketGeography(world).neighbours.get(utica)!) {
      const hub = book.get(near.hubId)!;
      expect(hub.stock[GRAIN]!).toBeGreaterThanOrEqual((6 + GRAIN_PROTECTED_MONTHS) * hub.demand[GRAIN]! - 1e-6);
    }
  });

  it("carries the dearer goods of a poor market too: the same rule for every good", () => {
    const world = opening();
    const book = bookOf(world);
    for (const spec of GOODS) {
      if (spec.id === "grain") continue;
      setStock(book, utica, spec.id, 0.15);
    }
    flow(world, book);
    for (const spec of GOODS) {
      if (spec.id === "grain" || spec.id === "slaves") continue;
      expect(inflowOf(book, utica, spec.id), spec.id).toBeGreaterThan(0);
    }
  });

  it("relieves a hub with two droughts' empty granary through the month's own pass", () => {
    const opened = opening();
    // Utica's country emptied; its neighbour's full. Six months of the land's own reckoning, trade included.
    const book = bookOf(opened);
    setStock(book, utica, "grain", 0.15);
    const hub = book.get(utica)!;
    const world = {
      ...opened,
      economy: {
        ...economyOf(opened),
        markets: economyOf(opened).markets.map((entry) => (entry.hubId !== utica
          ? entry
          : { ...entry, goods: entry.goods.map((good) => (good.good === "grain" ? { ...good, stock: Math.round(hub.stock[GRAIN]!) } : good)) })),
      },
    };
    let current = reviewTheLand({ world, toDay: 0 }).world;
    for (let month = 1; month <= 6; month += 1) current = reviewTheLand({ world: current, toDay: month * 30 }).world;
    const after = economyOf(current).markets.find((entry) => entry.hubId === utica)!.goods[GRAIN]!;
    // Without a neighbour to send it, a hub this short for six months with its own country's output only could not have recovered.
    expect(after.stock).toBeGreaterThan(Math.round(hub.stock[GRAIN]!));
    expect(after.priceBps).toBeLessThan(hub.price[GRAIN]!);
    // And the hubs that sent it did not starve themselves doing it.
    const sender = economyOf(current).markets.find((entry) => entry.hubId === carthage)!.goods[GRAIN]!;
    expect(sender.stock).toBeGreaterThan(sender.demand * GRAIN_PROTECTED_MONTHS);
  });
});
