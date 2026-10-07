import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldStateSchema,
  calendarDateOf,
  calendarYearOf,
  dayOfCalendarDate,
  astronomicalYearOf,
  EMPTY_ECONOMY_MEMORY,
  drawStock,
  ensureMarkets,
  ensureProvinceMaterial,
  marketGeography,
  ordinaryCrop,
  polityGrainPriceBps,
  provinceGrainPriceBps,
  provinceGrounds,
  reckonTaxCapacity,
  stockIn,
  type ProvinceMaterial,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { HARVEST_MONTH, harvestIn, harvestYield } from "./economy";

/**
 * A bad harvest, and what the land does with the months between.
 *
 * Nobody was ever born and nobody ever starved: a province was counted once,
 * from its towns, and a famine below the hunger line was a word in a fact.
 * The harvest was a card the narrator might draw. These walk the calendar and
 * watch the engine do it instead.
 *
 * Phase C of the economy rework changed what a harvest is. It used to reset a
 * province's food security from a table (a drought left it at a quarter of
 * ordinary, whatever it had held the year before), so a drought starved a
 * province the day it came in and a good year erased every memory of the last.
 * It now fills the granary of the market the province trades in
 * (`sim/markets.ts`): its crop is its people's ordinary crop times the year's
 * weather in its country and its own luck, the months eat it, and how fed a
 * province is follows what the granary holds. These tests were updated for it,
 * not loosened: the harvest still comes once a year in its month and says so
 * power by power, a drought is still the year's news and still makes bread
 * dear; what it no longer does is starve a country that has a granary to
 * draw on (`a-granary-carries-a-year` has the two droughts that do).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const LATIUM = PUNIC_IDS.rome;
const CAMPANIA = PUNIC_IDS.capua;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const row = (world: WorldState, id: string): ProvinceMaterial => world.material.provinceMaterial.find((material) => material.provinceId === id)!;
const setRow = (world: WorldState, id: string, change: Partial<ProvinceMaterial>): WorldState => ({
  ...world,
  material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((material) => (material.provinceId === id ? { ...material, ...change } : material)) },
});

/** Tick month by month from day 0 to `toDay`, with the calendar. */
function walk(world: WorldState, toDay: number, step = 30) {
  let current = world;
  const kinds: string[] = [];
  const summaries: string[] = [];
  for (let day = step; day <= toDay; day += step) {
    const ticked = runDeterministicTick({ world: current, toDay: day, ids: createIdFactory(`walk-${day}`), warfare: definition.warfare, clock });
    expect(WorldStateSchema.safeParse(ticked.world).success).toBe(true);
    current = ticked.world;
    kinds.push(...ticked.factProposals.map((fact) => String(fact.kind)));
    summaries.push(...ticked.factProposals.map((fact) => fact.summary));
  }
  return { world: current, kinds, summaries };
}

/** The first day of the next harvest month after the epoch. */
function nextHarvestDay(): number {
  for (let day = 1; day < 800; day += 1) {
    const date = calendarDateOf({ day, minute: 0 }, clock);
    if (date.month === HARVEST_MONTH && date.day === 1) return day;
  }
  throw new Error("no harvest month");
}

/** A world a day before the harvest of `year`, its markets open and its granaries as low as they run before a crop: a season's reserve and the day's bread. */
function onTheEveOf(year: number): { world: WorldState; day: number } {
  const day = dayOfCalendarDate({ ...calendarYearOf(year), month: HARVEST_MONTH, day: 1 }, clock);
  const opened = ensureMarkets(opening(), 1 / 30);
  const waiting: WorldState = { ...opened, economy: { ...EMPTY_ECONOMY_MEMORY, ...opened.economy, lastReviewStep: day - 1, lastHarvestYear: year - 1 } };
  return { world: waiting, day };
}

/** The first year, from the first harvest on, in which the weather in Latium's country is of this kind. */
function firstYearOf(kind: string): number {
  const first = astronomicalYearOf(calendarDateOf({ day: nextHarvestDay(), minute: 0 }, clock));
  return Array.from({ length: 400 }, (_, index) => first + index).find((candidate) => harvestIn(opening(), LATIUM, candidate) === kind)!;
}

describe("a bad harvest", () => {
  it("comes in once a year, in its month, and fills the granary of the market each province trades in", () => {
    const harvestDay = nextHarvestDay();
    const before = walk(opening(), harvestDay - 1, harvestDay - 1);
    const after = runDeterministicTick({ world: before.world, toDay: harvestDay + 1, ids: createIdFactory("harvest"), warfare: definition.warfare, clock });
    const year = astronomicalYearOf(calendarDateOf({ day: harvestDay, minute: 0 }, clock));
    expect(after.world.economy?.lastHarvestYear).toBe(year);
    // The granary of Latium's market took in what its country grew: its people's ordinary crop times the year's
    // weather and each province's luck.
    const geography = marketGeography(after.world);
    const hub = geography.hubOf.get(LATIUM)!;
    const grounds = provinceGrounds(after.world);
    const provinces = new Map(after.world.map.provinces.map((province) => [province.id, province]));
    const crop = geography.country.get(hub)!.reduce((sum, id) => {
      const material = row(after.world, id);
      return sum + ordinaryCrop(material, provinces.get(id)!, grounds.get(id)!) * harvestYield(hub, id, year);
    }, 0);
    const held = stockIn(before.world, LATIUM, "grain");
    const now = stockIn(after.world, LATIUM, "grain");
    expect(now).toBeGreaterThan(held);
    expect(Math.abs(now - held - crop) / crop).toBeLessThan(0.01);
    // And a second tick the same summer brings in nothing more.
    const again = runDeterministicTick({ world: after.world, toDay: harvestDay + 20, ids: createIdFactory("again"), warfare: definition.warfare, clock });
    expect(again.factProposals.some((fact) => fact.kind === "harvest_failed" || fact.kind === "harvest")).toBe(false);
  });

  it("fails somewhere in a year of drought, and says so power by power", () => {
    // The first year the rolls give Latium's country a drought, and the day it comes in.
    const year = firstYearOf("drought");
    expect(year).toBeDefined();
    const { world: waiting, day } = onTheEveOf(year);
    const ticked = runDeterministicTick({ world: waiting, toDay: day, ids: createIdFactory("drought"), warfare: definition.warfare, clock });
    const failed = ticked.factProposals.find((fact) => fact.kind === "harvest_failed" && (fact.affectedRefs ?? []).some((ref) => ref.id === "rome"));
    // One line for the power, naming a few of its provinces: a drought over seventy is news in a country.
    expect(failed?.summary).toMatch(/^The harvest failed in .+ more of Roman Republic's provinces: drought/);
    expect(failed?.affectedRefs).toContainEqual({ kind: "polity", id: "rome" });
    // The crop is dear (a drought's grain is half a year's), and the granary, not the sky, now decides whether anyone starves:
    // a fair year's harvest on the same eve leaves it cheap.
    const fair = onTheEveOf(firstYearOf("fair"));
    const fairTicked = runDeterministicTick({ world: fair.world, toDay: fair.day, ids: createIdFactory("fair"), warfare: definition.warfare, clock });
    expect(provinceGrainPriceBps(ticked.world, LATIUM)).toBeGreaterThan(provinceGrainPriceBps(fairTicked.world, LATIUM) + 3_000);
    expect(provinceGrainPriceBps(ticked.world, LATIUM)).toBeGreaterThan(12_500);
    expect(polityGrainPriceBps(ticked.world, "rome")).toBeGreaterThan(polityGrainPriceBps(fairTicked.world, "rome"));
    // Droughts and gluts are both there, over the years: the harvest is not always fair.
    const first = astronomicalYearOf(calendarDateOf({ day: nextHarvestDay(), minute: 0 }, clock));
    const kinds = new Set(Array.from({ length: 40 }, (_, index) => harvestIn(opening(), LATIUM, first + index)));
    expect(kinds.has("drought") || kinds.has("poor")).toBe(true);
    expect(kinds.has("bumper") || kinds.has("good")).toBe(true);
  });

  it("kills the hungry, and the hungry who fled settle in the quiet country next door", () => {
    // Latium starving and full of people who have left their farms; its
    // neighbour, the Campanian plain, fed and quiet. (A province's food is
    // still a row, which the month's reckoning draws toward what its market's
    // granary says; a province struck into hunger stays hungry for a few
    // months while its neighbours, in a market that is full, are fed.)
    // A fifth of its people off their land: the recovery pass sends home a
    // hundredth of a province's people a day, so fewer than that are home
    // before the month is out and never go anywhere.
    let world = setRow(opening(), LATIUM, { foodSecurityBps: 1_000, displacedPopulation: 80_000 });
    world = setRow(world, CAMPANIA, { foodSecurityBps: 9_000, stabilityBps: 8_000 });
    const neighbours = world.map.edges.some((edge) => (edge.from === LATIUM && edge.to === CAMPANIA) || (edge.to === LATIUM && edge.from === CAMPANIA));
    const people = row(world, LATIUM).population;
    const campanians = row(world, CAMPANIA).population;
    const walked = walk(world, 90);
    expect(row(walked.world, LATIUM).population).toBeLessThan(people - 400);
    expect(walked.kinds).toContain("famine");
    if (neighbours) {
      expect(row(walked.world, CAMPANIA).population).toBeGreaterThan(campanians);
      expect(walked.kinds).toContain("migration");
    }
  });

  it("grows a fed and quiet people, slowly", () => {
    const people = row(opening(), CAMPANIA).population;
    const year = walk(setRow(opening(), CAMPANIA, { foodSecurityBps: 9_000, stabilityBps: 8_000 }), 360);
    const grown = row(year.world, CAMPANIA).population;
    // About half a per cent a year: more, but not much more.
    expect(grown).toBeGreaterThan(people);
    expect(grown).toBeLessThan(people * 1.02);
  });

  it("reckons what a province can pay from its people and what war has left of them", () => {
    const burned = setRow(opening(), LATIUM, { warDamageBps: 5_000 });
    const walked = walk(burned, 60);
    const material = row(walked.world, LATIUM);
    expect(material.taxCapacity).toBe(reckonTaxCapacity(material));
    expect(material.taxCapacity).toBeLessThan(row(opening(), LATIUM).taxCapacity);
  });

  it("prices grain off what the granary holds, not off how fed the people are", () => {
    const world = ensureMarkets(opening());
    const ordinary = polityGrainPriceBps(world, "rome");
    expect(ordinary).toBe(10_000);
    // A row written hungry changes nothing about the price: it is the stock that is dear or cheap.
    const hungryRow = setRow(setRow(world, LATIUM, { foodSecurityBps: 2_000 }), CAMPANIA, { foodSecurityBps: 2_000 });
    expect(polityGrainPriceBps(hungryRow, "rome")).toBe(ordinary);
    // Draw the granary of Latium's market down to a fifth and the price is the market's ceiling.
    const held = stockIn(world, LATIUM, "grain");
    const lean = drawStock(world, LATIUM, "grain", held * 0.8).world;
    expect(provinceGrainPriceBps(lean, LATIUM)).toBeGreaterThan(30_000);
    expect(polityGrainPriceBps(lean, "rome")).toBeGreaterThan(ordinary);
  });

  it("does nothing to a world with no provinces to reckon", () => {
    const bare: WorldState = { ...opening(), map: { ...opening().map, provinces: [], edges: [] }, material: { ...opening().material, provinceMaterial: [] } };
    const ticked = runDeterministicTick({ world: bare, toDay: 400, ids: createIdFactory("bare"), warfare: definition.warfare, clock });
    expect(ticked.factProposals.some((fact) => ["famine", "migration", "harvest", "harvest_failed"].includes(String(fact.kind)))).toBe(false);
  });
});
