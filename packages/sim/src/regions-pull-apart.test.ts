import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, provinceGrounds, type WorldState } from "@chronica/shared";
import { reviewTheLand, reinvestmentOf, tradeAccessOf, ISOLATED_ACCESS } from "./economy";

/**
 * Peace should not make every province alike.
 *
 * In a ten-year peace every province rose the same two hundred and forty a year
 * and the spread between them never widened, since only a tenth separated a
 * harbour from a hilltop and a light tax from a heavy one. Growth now follows
 * what a place has to build on: the traffic through its hub, a port and a river
 * on a steady market, the rate it is taxed at (a light tax is reinvested, a heavy
 * one is not), its order, a richer neighbour, and the room it has left below its
 * ceiling. These put two provinces at the same start, one a trade-linked port
 * lightly taxed and one an isolated upland heavily taxed, through five years of
 * peace on the real calendar.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const PORT = "it-hn4oo";
/**
 * The hilltop was once Campania's `it-0w7sa`; with v55 it is a mine in the hinterland of Naples and Capua and rightly no longer isolated,
 * so the isolated hilltop is now an upland walled in by passes, with no town, no mine and no court within reach: the first by id.
 */
const HILLTOP = ((): string => {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const grounds = provinceGrounds(world);
  return world.map.provinces.map((province) => province.id).sort().find((id) => {
    const province = world.map.provinces.find((candidate) => candidate.id === id)!;
    const site = grounds.get(id)!.site;
    return province.terrainId === "hills-uplands" && province.settlements.length === 0 && site.enclosed && !site.mineral && site.agglomeration === 0 && site.court < 0.05;
  })!;
})();
const START = 2_500;

const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

/** The world with two provinces set to the same start, and each taxed at its own rate. */
function pair(rates: { readonly port: number; readonly hilltop: number }): WorldState {
  const world = opening();
  return {
    ...world,
    material: {
      ...world.material,
      provinceMaterial: world.material.provinceMaterial.map((row) => {
        if (row.provinceId === PORT) return { ...row, developmentBps: START, taxRegime: "land_levy" as const, taxRateBps: rates.port };
        if (row.provinceId === HILLTOP) return { ...row, developmentBps: START, taxRegime: "land_levy" as const, taxRateBps: rates.hilltop };
        return row;
      }),
    },
  };
}

/** Peace for `years`, a month's reckoning at a time as the tick does it, and where each of the two stood at the end. */
function aPeaceOf(start: WorldState, years: number): { readonly port: number; readonly hilltop: number } {
  let world = start;
  // The first review only opens the books at day 0; each later one reckons a month.
  world = reviewTheLand({ world, toDay: 0, clock: definition.clock }).world;
  for (let month = 1; month <= years * 12; month += 1) world = reviewTheLand({ world, toDay: month * 30, clock: definition.clock }).world;
  const at = (id: string): number => world.material.provinceMaterial.find((row) => row.provinceId === id)!.developmentBps!;
  return { port: at(PORT), hilltop: at(HILLTOP) };
}

describe("regions pull apart in peace", () => {
  it("starts the two alike", () => {
    const world = pair({ port: 400, hilltop: 1_800 });
    const developments = [PORT, HILLTOP].map((id) => world.material.provinceMaterial.find((row) => row.provinceId === id)!.developmentBps);
    expect(developments).toEqual([START, START]);
  });

  it("leaves a trade-linked, lightly taxed port well ahead of an isolated, heavily taxed hilltop after five years", () => {
    const end = aPeaceOf(pair({ port: 400, hilltop: 1_800 }), 5);
    // Both start at 2,500; the port builds a good deal, the hilltop next to nothing.
    expect(end.port - end.hilltop).toBeGreaterThan(1_500);
    expect(end.port - START).toBeGreaterThan(8 * Math.max(1, end.hilltop - START));
    expect(end.hilltop - START).toBeLessThan(250);
    expect(end.port - START).toBeGreaterThan(1_500);
  });

  it("does it by trade alone, at the same ordinary tax", () => {
    const end = aPeaceOf(pair({ port: 1_000, hilltop: 1_000 }), 5);
    expect(end.port - START).toBeGreaterThan(2 * (end.hilltop - START));
  });

  it("does it by tax alone, at the same place: a light tax is reinvested and a heavy one is not", () => {
    const light = aPeaceOf(pair({ port: 400, hilltop: 400 }), 5);
    const heavy = aPeaceOf(pair({ port: 1_800, hilltop: 1_800 }), 5);
    expect(light.port - START).toBeGreaterThan(3 * (heavy.port - START));
    expect(light.hilltop).toBeGreaterThan(heavy.hilltop);
  });

  it("builds less and less as a province nears its ceiling", () => {
    // From the same place, a province far below the ceiling gains more in a year than one that is nearly at it. (The port is the one that builds at all: v55's isolated upland builds nothing in a year.)
    const ceiling = provinceGrounds(opening()).get(PORT)!.potentialBps;
    const far = reviewTheLand({ world: reviewTheLand({ world: pair({ port: 1_000, hilltop: 1_000 }), toDay: 0, clock: definition.clock }).world, toDay: 360, clock: definition.clock }).world;
    const gain = (world: WorldState, id: string) => world.material.provinceMaterial.find((row) => row.provinceId === id)!.developmentBps! - START;
    const nearly = (() => {
      const base = pair({ port: 1_000, hilltop: 1_000 });
      const high = { ...base, material: { ...base.material, provinceMaterial: base.material.provinceMaterial.map((row) => (row.provinceId === PORT ? { ...row, developmentBps: ceiling - 300 } : row)) } };
      return reviewTheLand({ world: reviewTheLand({ world: high, toDay: 0, clock: definition.clock }).world, toDay: 360, clock: definition.clock }).world;
    })();
    // At least fifty points: Rome's harbour (Ostia, batch 3) moved the market this province stands in by a hair, and the year is worth fifty exactly.
    expect(gain(far, PORT)).toBeGreaterThanOrEqual(50);
    expect(gain(nearly, PORT) + START - (ceiling - 300)).toBeLessThan(0.5 * gain(far, PORT));
  });

  it("reads trade, tax and order as plain functions", () => {
    expect(reinvestmentOf(400)).toBeGreaterThan(reinvestmentOf(1_000));
    expect(reinvestmentOf(1_000)).toBe(1);
    expect(reinvestmentOf(1_800)).toBeLessThan(0.3);
    expect(reinvestmentOf(2_500)).toBe(0);
    const ground = { port: true, river: false };
    expect(tradeAccessOf({ port: false, river: false }, false, true, 0)).toBe(ISOLATED_ACCESS);
    expect(tradeAccessOf(ground, true, true, 0.5)).toBeGreaterThan(5 * ISOLATED_ACCESS);
    // A port on a market whose bread is dear brings nothing.
    expect(tradeAccessOf(ground, false, false, 0.5)).toBe(ISOLATED_ACCESS);
  });
});
