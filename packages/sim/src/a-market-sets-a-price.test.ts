import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  GOODS,
  GOOD_IDS,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  drawStock,
  ensureMarkets,
  ensureProvinceMaterial,
  marketGeography,
  marketPriceBps,
  marketsOf,
  priceBpsFrom,
  priceInDrachmae,
  stockIn,
  takeCaptives,
  type Force,
  type GoodId,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { breadWhereItStands } from "./grain";
import { reviewTheLand } from "./economy";
import { createIdFactory } from "./ports";

/**
 * A market sets a price (phase C of the economy rework).
 *
 * Grain's price was read off how fed a province was and nothing was bought or
 * sold. There are now six goods, each with a stock in the hub of the market a
 * province trades in; the price is what that stock says against what the hub
 * ought to hold: dear as it runs short, cheap as it piles up, within bounds of
 * the good's own. These pin the arithmetic (a price from a stock), what moves
 * it (what a country makes, what its people use, what an army buys, what a
 * sack brings to market), that it stays between its bounds, and that it is the
 * same on every run.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = PUNIC_IDS.rome;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const spec = (good: GoodId) => GOODS.find((candidate) => candidate.id === good)!;

/** Thirty-day months of the land's own reckoning, the harvest left out (a world with no calendar grows its grain evenly). */
function pass(world: WorldState, count: number): WorldState {
  let current = reviewTheLand({ world, toDay: 0 }).world;
  for (let month = 1; month <= count; month += 1) current = reviewTheLand({ world: current, toDay: month * 30 }).world;
  return current;
}

describe("a price from a stock", () => {
  it("is the good's ordinary price where the hub holds what it ought, dear where it holds less, cheap where it holds more", () => {
    for (const good of GOODS) {
      expect(priceBpsFrom(good, 1_000, 1_000)).toBe(10_000);
      expect(priceBpsFrom(good, 500, 1_000)).toBeGreaterThan(10_000);
      expect(priceBpsFrom(good, 2_000, 1_000)).toBeLessThan(10_000);
      // A hub with nobody to use the good has no price to speak of.
      expect(priceBpsFrom(good, 0, 0)).toBe(10_000);
    }
    // Grain answers a shortage nearly one for one; oil and wine less.
    expect(priceBpsFrom(spec("grain"), 500, 1_000)).toBeGreaterThan(priceBpsFrom(spec("oil_wine"), 500, 1_000));
  });

  it("stays between the good's floor and ceiling however little or much there is", () => {
    for (const good of GOODS) {
      expect(priceBpsFrom(good, 0, 1_000)).toBe(good.ceilingBps);
      expect(priceBpsFrom(good, 1_000_000, 1_000)).toBe(good.floorBps);
      for (const stock of [1, 10, 100, 700, 1_300, 5_000, 90_000]) {
        const price = priceBpsFrom(good, stock, 1_000);
        expect(price).toBeGreaterThanOrEqual(good.floorBps);
        expect(price).toBeLessThanOrEqual(good.ceilingBps);
      }
    }
  });

  it("is calibrated to the age: a drachma a modius, a slave at two hundred", () => {
    const world = ensureMarkets(opening());
    expect(priceInDrachmae(world, LATIUM, "grain")).toBeCloseTo(1, 6);
    expect(priceInDrachmae(world, LATIUM, "slaves")).toBeCloseTo(200, 6);
    expect(GOODS.map((good) => good.id)).toEqual([...GOOD_IDS]);
    expect(GOODS.length).toBe(6);
  });
});

describe("what moves a price", () => {
  const latiumHub = (world: WorldState): string => marketGeography(world).hubOf.get(LATIUM)!;
  const country = (world: WorldState): ReadonlySet<string> => new Set(marketGeography(world).country.get(latiumHub(world))!);

  it("makes a good dearer where the country that supplies it has been laid waste", () => {
    const world = ensureMarkets(opening());
    const ours = country(world);
    const burned: WorldState = {
      ...world,
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (ours.has(row.provinceId) ? { ...row, warDamageBps: 6_000 } : row)) },
    };
    const calm = pass(world, 6);
    const waste = pass(burned, 6);
    // Less is made, and what is made is less: every good the hub's own ground produces is dearer than where it is left alone.
    const dearer = GOOD_IDS.filter((good) => good !== "slaves" && marketPriceBps(waste, LATIUM, good) > marketPriceBps(calm, LATIUM, good));
    expect(dearer.length).toBeGreaterThanOrEqual(3);
    expect(dearer).toContain("textiles");
  });

  it("makes a good dearer where more people want it", () => {
    const world = ensureMarkets(opening());
    const ours = country(world);
    const crowded: WorldState = {
      ...world,
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (ours.has(row.provinceId) ? { ...row, population: row.population * 3 } : row)) },
    };
    // The same stocks, three times the mouths: the stock a hub holds is months of what is used.
    const before = marketPriceBps(pass(world, 3), LATIUM, "textiles");
    const after = marketPriceBps(pass(crowded, 3), LATIUM, "textiles");
    expect(after).toBeGreaterThan(before);
  });

  it("is raised, at once, by an army that buys the hub's bread, and the granary is the smaller for it", () => {
    const world = ensureMarkets(opening());
    const force = world.material.forces.find((candidate) => candidate.id === "roman-field-army") as Force;
    const start: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.map((candidate) => (candidate.id === force.id ? { ...candidate, provisionedThroughStep: 2, provisionStatus: "provisioned" as const } : candidate)) } };
    const before = marketPriceBps(start, force.locationId, "grain");
    const stock = stockIn(start, force.locationId, "grain");
    const bought = breadWhereItStands(start, start.material.forces.find((candidate) => candidate.id === force.id)!, "buy", 30, 2);
    expect(bought.days).toBeGreaterThan(0);
    expect(stockIn(bought.world, force.locationId, "grain")).toBeLessThan(stock);
    expect(marketPriceBps(bought.world, force.locationId, "grain")).toBeGreaterThan(before);
    // A second army pays more for the same bread than the first.
    const second = breadWhereItStands(bought.world, bought.world.material.forces.find((candidate) => candidate.id === force.id)!, "buy", 30, 2);
    expect(second.cost / second.days).toBeGreaterThan(bought.cost / bought.days);
  });

  it("is lowered, for slaves, by a sack that brings captives to market, and by nothing else in a month of peace", () => {
    const world = ensureMarkets(opening());
    const before = marketPriceBps(world, LATIUM, "slaves");
    const captive = takeCaptives(world, LATIUM, 40_000);
    expect(stockIn(captive, LATIUM, "slaves")).toBeGreaterThan(stockIn(world, LATIUM, "slaves"));
    expect(marketPriceBps(captive, LATIUM, "slaves")).toBeLessThan(before);
    // A country supplies some of its own slaves and the frontier trickles more (v58), so a market floats; emptied of what it holds it is dearer, and a war puts more on it (`captives-fill-the-slave-market.test.ts`).
    expect(marketPriceBps(drawStock(world, LATIUM, "slaves", 1e12).world, LATIUM, "slaves")).toBeGreaterThan(before);
  });
});

describe("the same on every run", () => {
  it("gives the same stocks and prices to two worlds reckoned the same way, in any order of asking", () => {
    const a = pass(ensureMarkets(opening()), 4);
    const b = pass(ensureMarkets(opening()), 4);
    expect(JSON.stringify(marketsOf(a))).toBe(JSON.stringify(marketsOf(b)));
    // Every figure is an integer, so a world serialises the same on every machine.
    for (const hub of marketsOf(a)) for (const entry of hub.goods) {
      expect(Number.isInteger(entry.stock)).toBe(true);
      expect(Number.isInteger(entry.priceBps)).toBe(true);
      expect(Number.isInteger(entry.target)).toBe(true);
    }
  });

  it("keeps every price between its bounds through a decade of months, a siege's worth of stock lost, and a glut", () => {
    let world = ensureMarkets(opening());
    // One hub emptied, another filled to the brim.
    const hubs = marketGeography(world).hubs;
    for (const good of GOOD_IDS) world = drawStock(world, hubs[0]!, good, 1e12).world;
    const rich = { ...world, economy: { ...world.economy!, markets: world.economy!.markets.map((hub) => (hub.hubId === hubs[1] ? { ...hub, goods: hub.goods.map((entry) => ({ ...entry, stock: entry.target * 20 })) } : hub)) } };
    const walked = pass(rich, 24);
    for (const hub of marketsOf(walked)) for (const entry of hub.goods) {
      const good = spec(entry.good);
      expect(entry.priceBps).toBeGreaterThanOrEqual(good.floorBps);
      expect(entry.priceBps).toBeLessThanOrEqual(good.ceilingBps);
    }
  });
});

describe("a cargo records the good it carries", () => {
  it("sails with the good that pays best between its two ports", () => {
    const as = (): ApplyContext => ({
      now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "leptines-syracuse" }, offices: definition.government.offices, warfare: definition.warfare,
      terrains: definition.map.terrains, ids: createIdFactory("market-cargo"), gameId: "game-1",
    });
    const result = applyDeltas(opening(), [WorldDeltaSchema.parse({
      op: "trade_venture_open", localId: "the_run", title: "The Messana run", ownerCharacterRef: "leptines-syracuse", fromProvinceId: PUNIC_IDS.syracuse, toProvinceId: PUNIC_IDS.messana,
      band: "marked", paidFromAccountRef: "leptines-purse", reason: "Leptines puts a ship and a cargo of oil on the strait.",
    })], as());
    expect(result.rejected).toEqual([]);
    const venture = result.world.material.ventures[0]!;
    expect(venture.cargo?.good).toBeDefined();
    expect(GOOD_IDS).toContain(venture.cargo!.good);
  });
});
