import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, economyOf, type WorldState } from "@chronica/shared";
import { reviewTheLand } from "./economy";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { reliefNews, tradeSummary } from "./trade-summary";
import { HUBS, POWERS, agreement, bookOf, flow, opening, setStock, withAgreements, withCustoms } from "./trade-test-kit";

/**
 * A power hears of its trade (phase D of the economy rework).
 *
 * Whoever governs is told, in a line a power and never one a hub, whom it
 * trades with, what it sells and buys, what customs it lays, which pacts and
 * embargoes stand and whether trade is easing or worsening a shortage; and
 * the powers hear of ships of grain reaching a dear market, once a year at
 * most. Nothing is said where there is nothing to say.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const render = (world: WorldState, polity = "syracuse", character = "hieron-ii"): string => renderWorldSlice(buildWorldSlice({
  world, clock: definition.clock, offices: definition.government.offices, actorRef: { kind: "character", id: character }, actorPolityId: polity,
  orderText: null, facts: [], dueEvents: [], pendingEvents: [],
}));
const pact = agreement("trade_pact", POWERS.carthage, POWERS.syracuse, { trade: { tariffCapBps: 500, mostFavoured: false, exempt: [], goods: [] } });
const WAR = agreement("war", POWERS.carthage, POWERS.syracuse);

/** A few months of the land's own reckoning, trade included. */
function season(world: WorldState, count: number): WorldState {
  let current = reviewTheLand({ world, toDay: 0 }).world;
  for (let month = 1; month <= count; month += 1) current = reviewTheLand({ world: current, toDay: month * 30 }).world;
  return current;
}

describe("a power hears of its trade", () => {
  it("says nothing where no customs, pact or embargo stands and nothing dear is moving", () => {
    // The Mamertines lay no customs and hold no pact; nothing is moving yet in a world that has not been reckoned.
    expect(tradeSummary(opening(), "mamertines")).toBeNull();
    // Syracuse opens laying customs, and is told so (the opening's customs are the age's, v49); Rome its pacts.
    expect(tradeSummary(opening(), POWERS.syracuse)).toMatch(/customs 10% on foreign goods/);
    expect(tradeSummary(opening(), POWERS.rome)).toMatch(/pacts with Carthage \(cap 5%\) and Massalia \(cap 2\.5%\)/);
    expect(render(opening())).toContain("Trade: customs 10% on foreign goods");
  });

  it("names the customs it lays, its pacts and the embargoes laid on it or by it", () => {
    const world = withAgreements(withCustoms(opening(), POWERS.syracuse, 1_500), pact, agreement("embargo", POWERS.rome, POWERS.syracuse, { trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: ["metals"] } }));
    const line = tradeSummary(world, POWERS.syracuse)!;
    expect(line).toMatch(/customs 15% on foreign goods/);
    expect(line).toContain("pacts with Carthage (cap 5%)");
    expect(line).toMatch(/Roman Republic has embargoed metals with us/);
    expect(tradeSummary(world, POWERS.rome)).toMatch(/we have embargoed metals with /);
    // And it reaches the page whoever governs reads.
    expect(render(world)).toContain("Trade:");
  });

  it("says a pact is held by war, and names the chief partners once goods have crossed", () => {
    const held = withAgreements(opening(), pact, WAR);
    expect(tradeSummary(held, POWERS.syracuse)).toMatch(/Carthage \(held by war\)/);
    const ran = season(withAgreements(withCustoms(opening(), POWERS.syracuse, 800), pact), 3);
    expect(economyOf(ran).tradeLanes.length).toBeGreaterThan(0);
    expect(tradeSummary(ran, POWERS.syracuse)).toMatch(/partners /);
  });

  it("says what trade is easing: dear goods that came in", () => {
    const world = opening();
    const book = bookOf(world);
    setStock(book, HUBS.syracuse, "grain", 0.3);
    flow(world, book);
    // Written back into the world's markets as the monthly pass would.
    const hub = book.get(HUBS.syracuse)!;
    const eased: WorldState = {
      ...world,
      economy: { ...economyOf(world), markets: economyOf(world).markets.map((entry) => (entry.hubId !== HUBS.syracuse ? entry : { ...entry, goods: entry.goods.map((good, index) => ({ ...good, stock: Math.round(hub.stock[index]!), priceBps: 16_000, inflow: Math.round(hub.inflow[index]!), outflow: 0 })) })) },
    };
    expect(tradeSummary(eased, POWERS.syracuse)).toMatch(/eases dear goods in/);
  });
});

describe("a power hears of ships of grain", () => {
  const relief = new Map([["syracuse", { units: 40_000, from: new Set(["carthage"]) }], ["rome", { units: 500, from: new Set(["carthage"]) }]]);

  it("is told as a line a power, for what came by sea to a dear market, and not for a trickle", () => {
    const news = reliefNews(opening(), relief, 100);
    expect(news.facts).toHaveLength(1);
    expect(news.facts[0]!.kind).toBe("relief_ship");
    expect(news.facts[0]!.summary).toMatch(/Syracuse/);
    expect(news.facts[0]!.summary).toMatch(/Carthage/);
    expect(news.told).toEqual([{ polityId: "syracuse", otherPolityId: "carthage", kind: "relief", atStep: 100 }]);
  });

  it("is not told again within a year", () => {
    const world = opening();
    const told: WorldState = { ...world, economy: { ...economyOf(world), tradeNews: [{ polityId: "syracuse", otherPolityId: "carthage", kind: "relief", atStep: 100 }] } };
    expect(reliefNews(told, relief, 200).facts).toEqual([]);
    expect(reliefNews(told, relief, 100 + 361).facts).toHaveLength(1);
  });
});
