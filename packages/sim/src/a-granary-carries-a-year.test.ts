import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  EMPTY_ECONOMY_MEMORY,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  calendarYearOf,
  dayOfCalendarDate,
  ensureMarkets,
  ensureProvinceMaterial,
  marketEntry,
  marketGeography,
  marketPriceBps,
  ordinaryCrop,
  provinceGrounds,
  type ProvinceMaterial,
  type WorldState,
} from "@chronica/shared";
import { HARVEST_MONTH, reviewTheLand } from "./economy";
import { stockTheHarvest } from "./markets";
import { bareOfCharges } from "./bare-of-charges";

/**
 * A granary carries a year (phase C of the economy rework).
 *
 * A harvest reset how fed a province was, from a table, the day it came in: a
 * drought starved it whatever it had held and a bumper year left nothing for
 * the next. Now the harvest fills the hub's granary and the months empty it, so
 * what a country has to eat is what it laid by. A drought a country can bear
 * with the grain it carried over only makes bread dear; two droughts running,
 * with the granary emptied by the first, are what famine is.
 *
 * The years are driven by hand here (a crop of this share of an ordinary one is
 * stocked on harvest day, the months are reckoned between) so that a test can
 * have the droughts it wants, where the world's own weather has them when it
 * has them (`a-bad-harvest`).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const LATIUM = PUNIC_IDS.rome;
const opening = (): WorldState => bareOfCharges(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const row = (world: WorldState, id: string): ProvinceMaterial => world.material.provinceMaterial.find((material) => material.provinceId === id)!;

/** A harvest day in the scenario's calendar, for the astronomical year. */
const harvestDayOf = (year: number): number => dayOfCalendarDate({ ...calendarYearOf(year), month: HARVEST_MONTH, day: 1 }, clock);

/** The grain each hub's country grows in an ordinary year, times a share: a drought's, a fair year's. */
function cropAt(world: WorldState, share: number): Map<string, number> {
  const geography = marketGeography(world);
  const grounds = provinceGrounds(world);
  const provinces = new Map(world.map.provinces.map((province) => [province.id, province]));
  const crops = new Map<string, number>();
  for (const material of world.material.provinceMaterial) {
    const hub = geography.hubOf.get(material.provinceId)!;
    crops.set(hub, (crops.get(hub) ?? 0) + ordinaryCrop(material, provinces.get(material.provinceId)!, grounds.get(material.provinceId)!) * share);
  }
  return crops;
}

interface Year {
  /** Lowest food security Latium reached in the year after this harvest. */
  readonly leanest: number;
  /** Dearest grain in Latium's market in that year. */
  readonly dearest: number;
  /** Grain in store in Latium's market the day before the next harvest, in months of what it uses. */
  readonly monthsLeft: number;
  /** People in Latium at that day. */
  readonly people: number;
  /** Price the day after the next harvest, if it was a fair one, and what the market held. */
  readonly world: WorldState;
}

/**
 * A world on the day of a harvest, the harvest stocked at this share of an ordinary one, and the twelve
 * reckonings to the next harvest run; and what Latium went through on the way. The automatic harvest is
 * switched off so each year is the one the test asks for.
 */
function theYear(start: WorldState, harvestDay: number, share: number): Year {
  let world = stockTheHarvest(start, cropAt(start, share));
  let leanest = 10_000;
  let dearest = 0;
  let day = harvestDay;
  const next = harvestDay + 365;
  while (day + 30 <= next - 1) {
    day += 30;
    world = reviewTheLand({ world, toDay: day, clock }).world;
    leanest = Math.min(leanest, row(world, LATIUM).foodSecurityBps);
    dearest = Math.max(dearest, marketPriceBps(world, LATIUM, "grain"));
  }
  const entry = marketEntry(world, LATIUM, "grain")!;
  return { leanest, dearest, monthsLeft: entry.stock / entry.demand, people: row(world, LATIUM).population, world };
}

/** The eve of a harvest day: markets open with what a country holds just before the crop, the automatic harvest held off. */
function eveOf(year: number): { world: WorldState; day: number } {
  const day = harvestDayOf(year);
  const opened = ensureMarkets(opening(), 1 / 30);
  return { world: { ...opened, economy: { ...EMPTY_ECONOMY_MEMORY, ...opened.economy, lastReviewStep: day, lastHarvestYear: 10_000 } }, day };
}

const FIRST_YEAR = ((): number => {
  for (let year = -280; year < -200; year += 1) if (harvestDayOf(year) > 40) return year;
  throw new Error("no year");
})();

describe("a granary carries a year", () => {
  it("holds over from one year to the next what a fair crop leaves above a year's bread", () => {
    const { world, day } = eveOf(FIRST_YEAR);
    const one = theYear(world, day, 1.04);
    const two = theYear(one.world, day + 365, 1.04);
    const three = theYear(two.world, day + 730, 1.04);
    // A reserve of months is left in the granary on the eve of every harvest, not a bare floor and not a year's: the grain carried over.
    for (const year of [one, two, three]) {
      expect(year.monthsLeft).toBeGreaterThan(4);
      expect(year.monthsLeft).toBeLessThan(10);
    }
    // And a fair year's crop leaves bread at its ordinary price all through the year: nobody went hungry.
    expect(one.leanest).toBeGreaterThanOrEqual(6_000);
    expect(one.dearest).toBeLessThan(14_000);
    // What was left over in the first year is still there in the second: the same granary, not a new one.
    expect(Math.abs(two.monthsLeft - one.monthsLeft)).toBeLessThan(1.5);
  });

  it("makes bread dear in a drought and starves nobody who has a granary to draw on", () => {
    const { world, day } = eveOf(FIRST_YEAR);
    const drought = theYear(world, day, 0.55);
    // The price climbs as the granary runs down toward the next crop...
    expect(drought.dearest).toBeGreaterThan(18_000);
    // ... but nobody is below the line at which people begin to die, and the people are as many as they were.
    expect(drought.leanest).toBeGreaterThanOrEqual(4_000);
    expect(drought.people).toBeGreaterThanOrEqual(row(world, LATIUM).population * 0.99);
    // The granary is low on the eve of the next crop (the reserve of half a year has been spent, less what dear bread talked people out of)...
    expect(drought.monthsLeft).toBeLessThan(3);
    // ... and a fair crop after it makes bread cheap again within a few months.
    const recovery = theYear(drought.world, day + 365, 1.04);
    expect(recovery.world).toBeDefined();
    expect(marketPriceBps(recovery.world, LATIUM, "grain")).toBeLessThan(drought.dearest * 0.7);
  });

  it("starves the country that has two droughts running, as one never could", () => {
    const { world, day } = eveOf(FIRST_YEAR);
    const first = theYear(world, day, 0.55);
    const second = theYear(first.world, day + 365, 0.55);
    // The second drought meets a granary the first emptied: grain at the market's ceiling, and below the line of famine.
    expect(second.dearest).toBeGreaterThanOrEqual(35_000);
    expect(second.leanest).toBeLessThan(4_000);
    expect(second.monthsLeft).toBeLessThan(0.5);
    // And people die of it: fewer in Latium than the year before.
    expect(second.people).toBeLessThan(first.people);
    // The first drought alone did not do that.
    expect(first.leanest).toBeGreaterThanOrEqual(4_000);
  });
});
