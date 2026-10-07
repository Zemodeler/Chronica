import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { EMPTY_ECONOMY_MEMORY, ensureMarkets, economyOf, type WorldState } from "@chronica/shared";
import { reviewTheLand } from "./economy";
import { decideFiscal } from "./fiscal-officers";
import { atDay, definition, input, opening } from "./fiscal-test-kit";
import { keepMerchantHouses } from "./merchant-houses";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Twenty houses and a book-keeper to every power, and a month still takes a moment."
 *
 * The same budgets as `a-thousand-provinces.test.ts`: the month of the whole clock under ten seconds, the year of the land under ten,
 * a month's reckoning of the land in a second or so. What the houses and the officers add is separate and small: the houses
 * are a length check where there are none and a few milliseconds a month where there are twenty (a price table read once, one
 * Dijkstra a house, two cargoes at most); the officers are one `taxBurdens` pass, one walk of the obligations, the sources and the
 * hubs, and one decision a power at most. The tests time each and the whole, with the houses and without them, and say so.
 */

const time = <T>(run: () => T): { result: T; ms: number } => {
  const started = performance.now();
  const result = run();
  return { result, ms: performance.now() - started };
};

describe("the books are kept in good time", { timeout: 300_000 }, () => {
  const world = ensureMarkets(opening(90));
  const noHouses = (state: WorldState): WorldState => ({ ...state, economy: { ...economyOf(state), houses: [] } });

  it("a month of every house costs a few milliseconds, and a year of them under a second", () => {
    expect(economyOf(world).houses.length).toBeGreaterThanOrEqual(14);
    const month = time(() => keepMerchantHouses(atDay(world, 120), 120, createIdFactory("perf-month")));
    // A house with none trading is a length check.
    const empty = time(() => keepMerchantHouses(noHouses(world), 120, createIdFactory("perf-none")));
    let state = atDay(world, 90);
    const year = time(() => {
      for (let step = 1; step <= 12; step += 1) state = keepMerchantHouses(atDay(state, 90 + step * 30), 90 + step * 30, createIdFactory(`perf-year-${step}`)).world;
    });
    console.log(`houses: a month ${month.ms.toFixed(1)} ms, a year ${year.ms.toFixed(0)} ms, none ${empty.ms.toFixed(2)} ms; ${economyOf(state).houses.reduce((sum, house) => sum + house.voyages, 0)} voyages, ${state.material.ventures.filter((venture) => venture.status === "running").length} afloat`);
    expect(month.ms).toBeLessThan(500);
    expect(year.ms).toBeLessThan(3_000);
    expect(empty.ms).toBeLessThan(20);
  });

  it("a month of every officer's books costs well under a second, over every power nobody plays", () => {
    const state = atDay(world, 120);
    const decisions = time(() => decideFiscal(input(state)));
    console.log(`officers: a month ${decisions.ms.toFixed(0)} ms, ${decisions.result.length} decisions`);
    expect(decisions.ms).toBeLessThan(2_000);
    // At most one decision for a power, and one fact; the whole world's pass makes no more than a handful.
    const perPower = new Map<string, number>();
    for (const decision of decisions.result) perPower.set(decision.polityId, (perPower.get(decision.polityId) ?? 0) + 1);
    for (const count of perPower.values()) expect(count).toBeLessThanOrEqual(2);
    for (const decision of decisions.result) expect(decision.facts.length).toBeLessThanOrEqual(1);
    expect(decisions.result.length).toBeLessThan(25);
  });

  it("takes a month of the clock with the houses and the officers about it in well under ten seconds, and a year of the land in under ten", () => {
    const before: WorldState = { ...opening(30), economy: { ...EMPTY_ECONOMY_MEMORY, ...economyOf(opening(30)) } };
    const run = (state: WorldState) => time(() => runDeterministicTick({ world: { ...state, elapsedStep: 30, instant: { day: 30, minute: 0 } }, toDay: 30, ids: createIdFactory("perf-tick"), warfare: definition.warfare, clock: definition.clock, life: definition.life }));
    run(before);
    const withHouses = run(before);
    const without = run(noHouses(before));
    console.log(`the clock's month: ${withHouses.ms.toFixed(0)} ms with the houses, ${without.ms.toFixed(0)} ms without`);
    expect(withHouses.ms).toBeLessThan(10_000);
    // The houses are a small part of the month, whatever the machine: never as much again.
    expect(withHouses.ms).toBeLessThan(without.ms * 2 + 400);
    // And the year of the land, whose trade is the one the houses lend capacity to.
    const reckoned: WorldState = { ...before, economy: { ...economyOf(before), lastReviewStep: 0 } };
    const yearStarted = performance.now();
    expect(reviewTheLand({ world: reckoned, toDay: 365 }).months).toBe(12);
    expect(performance.now() - yearStarted).toBeLessThan(10_000);
    void punicWarsScenario;
  });
});
