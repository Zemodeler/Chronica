import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldStateSchema,
  calendarDateOf,
  calendarYearOf,
  dayOfCalendarDate,
  astronomicalYearOf,
  EMPTY_ECONOMY_MEMORY,
  ensureProvinceMaterial,
  grainPriceBps,
  polityGrainPriceBps,
  reckonTaxCapacity,
  type ProvinceMaterial,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { HARVEST_MONTH, harvestIn } from "./economy";

/**
 * A bad harvest, and what the land does with the months between.
 *
 * Nobody was ever born and nobody ever starved: a province was counted once,
 * from its towns, and a famine below the hunger line was a word in a fact.
 * The harvest was a card the narrator might draw. These walk the calendar and
 * watch the engine do it instead.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const LATIUM = "punic-italy-latium";
const CAMPANIA = "punic-italy-campanian-plain";
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

describe("a bad harvest", () => {
  it("comes in once a year, in its month, and sets what each province has to eat", () => {
    const harvestDay = nextHarvestDay();
    const before = walk(opening(), harvestDay - 1, harvestDay - 1);
    const after = runDeterministicTick({ world: before.world, toDay: harvestDay + 1, ids: createIdFactory("harvest"), warfare: definition.warfare, clock });
    const year = astronomicalYearOf(calendarDateOf({ day: harvestDay, minute: 0 }, clock));
    expect(after.world.economy?.lastHarvestYear).toBe(year);
    // Every province ate what its own year gave it.
    const bands = { drought: 2_500, poor: 5_500, fair: 8_000, good: 9_000, bumper: 10_000 } as const;
    for (const id of [LATIUM, CAMPANIA]) {
      const material = row(after.world, id);
      const kind = harvestIn(id, year);
      expect(material.foodSecurityBps).toBe(Math.round(bands[kind] * (material.productiveCapacityBps / 10_000) * (1 - material.warDamageBps / 20_000)));
    }
    // And a second tick the same summer brings in nothing more.
    const again = runDeterministicTick({ world: after.world, toDay: harvestDay + 20, ids: createIdFactory("again"), warfare: definition.warfare, clock });
    expect(again.factProposals.some((fact) => fact.kind === "harvest_failed" || fact.kind === "harvest")).toBe(false);
  });

  it("fails somewhere in a year of drought, and says so power by power", () => {
    // The first year the rolls give Latium a drought, and the day it comes in.
    const first = astronomicalYearOf(calendarDateOf({ day: nextHarvestDay(), minute: 0 }, clock));
    const year = Array.from({ length: 200 }, (_, index) => first + index).find((candidate) => harvestIn(LATIUM, candidate) === "drought")!;
    expect(year).toBeDefined();
    const day = dayOfCalendarDate({ ...calendarYearOf(year), month: HARVEST_MONTH, day: 1 }, clock);
    const waiting: WorldState = { ...opening(), economy: { ...EMPTY_ECONOMY_MEMORY, lastReviewStep: day - 1, lastHarvestYear: year - 1 } };
    const ticked = runDeterministicTick({ world: waiting, toDay: day, ids: createIdFactory("drought"), warfare: definition.warfare, clock });
    expect(row(ticked.world, LATIUM).foodSecurityBps).toBeLessThan(4_000);
    const failed = ticked.factProposals.find((fact) => fact.kind === "harvest_failed" && (fact.affectedRefs ?? []).some((ref) => ref.id === "rome"));
    expect(failed?.summary).toContain("Latium");
    // Droughts and gluts are both there, over the years: the harvest is not always fair.
    const kinds = new Set(Array.from({ length: 40 }, (_, index) => harvestIn(LATIUM, first + index)));
    expect(kinds.has("drought") || kinds.has("poor")).toBe(true);
    expect(kinds.has("bumper") || kinds.has("good")).toBe(true);
  });

  it("kills the hungry, and the hungry who fled settle in the quiet country next door", () => {
    // Latium starving and full of people who have left their farms; its
    // neighbour, the Campanian plain, fed and quiet.
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

  it("prices grain off what there is to eat", () => {
    expect(grainPriceBps(8_000)).toBe(10_000);
    expect(grainPriceBps(2_000)).toBeGreaterThan(30_000 - 1);
    expect(grainPriceBps(10_000)).toBeLessThan(10_000);
    const hungry = setRow(setRow(opening(), LATIUM, { foodSecurityBps: 2_000 }), CAMPANIA, { foodSecurityBps: 2_000 });
    expect(polityGrainPriceBps(hungry, "rome")).toBeGreaterThan(polityGrainPriceBps(opening(), "rome"));
  });

  it("does nothing to a world with no provinces to reckon", () => {
    const bare: WorldState = { ...opening(), map: { ...opening().map, provinces: [], edges: [] }, material: { ...opening().material, provinceMaterial: [] } };
    const ticked = runDeterministicTick({ world: bare, toDay: 400, ids: createIdFactory("bare"), warfare: definition.warfare, clock });
    expect(ticked.factProposals.some((fact) => ["famine", "migration", "harvest", "harvest_failed"].includes(String(fact.kind)))).toBe(false);
  });
});
