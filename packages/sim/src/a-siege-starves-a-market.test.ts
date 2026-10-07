import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  EMPTY_ECONOMY_MEMORY,
  ScenarioDefinitionSchema,
  SiegeSchema,
  WorldStateSchema,
  astronomicalYearOf,
  calendarDateOf,
  ensureMarkets,
  ensureProvinceMaterial,
  marketEntry,
  marketGeography,
  marketPriceBps,
  type Siege,
  type WorldState,
} from "@chronica/shared";
import { HARVEST_MONTH, reviewTheLand } from "./economy";

/**
 * A siege starves a market (phase C of the economy rework).
 *
 * A besieged city had a food security figure, which a siege lowered by a fixed
 * amount a month. It now has a market: the carters will not go through the
 * lines, so little of what its country grows reaches it, and whoever lies about
 * it takes a share of what it holds each month; the people inside go on
 * eating. Bread spikes inside the walls, and not in the next market along; when
 * the siege is lifted its country can carry again, and the next harvest fills
 * the granary.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const LATIUM = PUNIC_IDS.rome;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const siegeOf = (provinceId: string, status: Siege["status"]): Siege => SiegeSchema.parse({
  id: `siege-${provinceId}`, forceId: "an-army", provinceId, besiegerPolityId: "carthage", defenderPolityId: "rome",
  startedAtStep: 0, pressedToStep: 0, reportedAtStep: 0, status,
});

/** The first day of the next harvest month in the calendar, and the year it is in. */
const HARVEST_DAY = ((): number => {
  for (let day = 1; day < 800; day += 1) {
    const date = calendarDateOf({ day, minute: 0 }, clock);
    if (date.month === HARVEST_MONTH && date.day === 1) return day;
  }
  throw new Error("no harvest");
})();
const HARVEST_YEAR = astronomicalYearOf(calendarDateOf({ day: HARVEST_DAY, minute: 0 }, clock));

describe("a siege starves a market", () => {
  // The markets open as they would on the first day of the game, with the harvest still to come at its day.
  const opened = ensureMarkets(opening(), HARVEST_DAY / 30);
  const base: WorldState = { ...opened, economy: { ...EMPTY_ECONOMY_MEMORY, ...opened.economy, lastReviewStep: 0, lastHarvestYear: HARVEST_YEAR - 1 } };
  // Latium's market, and a hub that is not it nor next to it.
  const geography = marketGeography(base);
  const hub = geography.hubOf.get(LATIUM)!;
  const other = geography.hubs.find((candidate) => candidate !== hub && (geography.neighbours.get(hub) ?? []).every((near) => near.hubId !== candidate))!;
  const grain = (world: WorldState, provinceId: string): number => marketPriceBps(world, provinceId, "grain");
  const reckon = (world: WorldState, fromDay: number, toDay: number): WorldState => {
    let current = world;
    for (let day = fromDay + 30; day <= toDay; day += 30) current = reviewTheLand({ world: current, toDay: day, clock }).world;
    return current;
  };

  it("spikes the price of bread inside the lines, and not in a market the army is not at", () => {
    const before = grain(base, hub);
    const beforeOther = grain(base, other);
    expect(before).toBe(10_000);
    const sieged = reckon({ ...base, sieges: [siegeOf(hub, "active")] }, 0, 90);
    expect(grain(sieged, hub)).toBeGreaterThan(2 * before);
    // Whoever lay about it took a share of what it held: far less is in the granary than the people ate.
    const held = marketEntry(sieged, hub, "grain")!;
    const start = marketEntry(base, hub, "grain")!;
    expect(held.stock).toBeLessThan(start.stock - 3 * start.demand);
    // A market the army is not at is much as it was.
    expect(Math.abs(grain(sieged, other) - beforeOther)).toBeLessThan(2_500);
    // And without the siege the same three months leave bread at its price.
    expect(grain(reckon(base, 0, 90), hub)).toBeLessThan(1.3 * before);
  });

  it("recovers when the siege is lifted and the next harvest comes in", () => {
    const sieged = reckon({ ...base, sieges: [siegeOf(hub, "active")] }, 0, 90);
    const peak = grain(sieged, hub);
    expect(peak).toBeGreaterThan(20_000);
    // Lifted: the carters come again, and the people have what is left. Then the harvest, in its month, and two more.
    const lifted = reckon({ ...sieged, sieges: [siegeOf(hub, "lifted")] }, 90, HARVEST_DAY + 60);
    expect(lifted.economy!.lastHarvestYear).toBe(HARVEST_YEAR);
    const after = grain(lifted, hub);
    // Well below the siege's peak: the market is a market again, and not still at its ceiling.
    expect(after).toBeLessThan(peak * 0.7);
    expect(after).toBeLessThan(24_000);
    // A hub kept under siege through the harvest does not recover: most of what its country grew cannot reach it.
    const kept = reckon({ ...sieged, sieges: [siegeOf(hub, "active")] }, 90, HARVEST_DAY + 60);
    expect(grain(kept, hub)).toBeGreaterThan(after + 6_000);
  });

  it("starves a hub the more the longer the siege goes on", () => {
    const run = (days: number): number => grain(reckon({ ...base, sieges: [siegeOf(hub, "active")] }, 0, days), hub);
    expect(run(30)).toBeLessThan(run(60));
    expect(run(60)).toBeLessThan(run(90));
  });
});
