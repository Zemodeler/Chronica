import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  WorldStateSchema,
  applyCoarseRecoveryTick,
  drawStock,
  ensureMarkets,
  ensureProvinceMaterial,
  taxBurdens,
  type ProvinceMaterial,
  type ProvinceTargets,
  type WorldState,
} from "@chronica/shared";
import { reviewTheLand } from "./economy";

/**
 * The grain office and the tribute of men (phase D of the economy rework).
 *
 * Two things the monthly pass of the markets had left without an effect. A
 * grain office run well is meant to get bread to people faster and let it fail
 * them more slowly (`withGovernment`'s food scale); the old coarse recovery
 * that carried it is switched off where there are markets, so it now lives in
 * how fast a province's bread readout follows its hub's grain. And a province
 * taxed by a tribute of men (the `men` regime) reported the men a year it owed
 * and nothing used them; it now carries more men on its rolls, by exactly what
 * it owes in a year.
 */

const LATIUM = PUNIC_IDS.rome;
const opening = (): WorldState => ensureMarkets(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const rowOf = (world: WorldState, id: string): ProvinceMaterial => world.material.provinceMaterial.find((row) => row.provinceId === id)!;
const withRow = (world: WorldState, id: string, patch: Partial<ProvinceMaterial>): WorldState => ({
  ...world,
  material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === id ? { ...row, ...patch } : row)) },
});

/** A month of the land's reckoning, with the grain office's scale on every province (1 is a middling office). */
function month(world: WorldState, office: number): WorldState {
  const scale: ReadonlyMap<string, ProvinceTargets> = new Map(world.map.provinces.map((province) => [province.id, { foodRecoveryScale: office }]));
  const first = reviewTheLand({ world, toDay: 0, targets: () => scale }).world;
  return reviewTheLand({ world: first, toDay: 30, targets: () => scale }).world;
}

describe("a grain office is worth having", () => {
  it("gets bread to a hungry province faster where it is run well, and slower where it is run badly", () => {
    // Latium with a full granary and a hungry people: its bread readout climbs toward the granary's.
    const hungry = withRow(opening(), LATIUM, { foodSecurityBps: 3_000 });
    const middling = rowOf(month(hungry, 1), LATIUM).foodSecurityBps;
    const good = rowOf(month(hungry, 1.3), LATIUM).foodSecurityBps;
    const bad = rowOf(month(hungry, 0.7), LATIUM).foodSecurityBps;
    expect(middling).toBeGreaterThan(3_000);
    expect(good).toBeGreaterThan(middling);
    expect(bad).toBeLessThan(middling);
  });

  it("lets bread fail a province more slowly where it is run well, when the granary is empty", () => {
    const empty = drawStock(withRow(opening(), LATIUM, { foodSecurityBps: 8_000 }), LATIUM, "grain", Number.MAX_SAFE_INTEGER).world;
    const middling = rowOf(month(empty, 1), LATIUM).foodSecurityBps;
    const good = rowOf(month(empty, 1.3), LATIUM).foodSecurityBps;
    expect(middling).toBeLessThan(8_000);
    expect(good).toBeGreaterThan(middling);
  });
});

describe("a tribute of men fills the rolls", () => {
  it("raises what the province can put under arms by what it owes in a year, and does nothing for one taxed in silver", () => {
    const base = withRow(opening(), LATIUM, { taxRegime: "men", taxRateBps: 1_000 });
    const shift = taxBurdens(base).get("rome")?.provinceManpowerShift?.get(LATIUM) ?? 0;
    // A twentieth of the people a year, against an eighth of them fit to be called: five-eighths more on the rolls.
    expect(shift).toBeGreaterThan(0.4);
    expect(shift).toBeLessThan(0.8);
    expect(taxBurdens(withRow(opening(), LATIUM, { taxRegime: "land_levy", taxRateBps: 1_000 })).get("rome")?.provinceManpowerShift?.get(LATIUM)).toBeUndefined();

    // Given years to fill, the rolls stand higher by that share, and not otherwise.
    const row = { ...rowOf(base, LATIUM), availableManpower: 0 };
    const fill = (targets: ProvinceTargets | undefined): number => {
      let current = row;
      for (let step = 1; step <= 600; step += 1) current = applyCoarseRecoveryTick(current, step * 30, targets);
      return current.availableManpower;
    };
    const ordinary = fill(undefined);
    const tributary = fill({ manpowerShift: shift });
    expect(tributary).toBeGreaterThan(ordinary * 1.4);
    expect(tributary).toBeLessThan(ordinary * 1.8);
  });

  it("leaves a province with no one to levy owing nothing", () => {
    const empty = withRow(opening(), LATIUM, { taxRegime: "men", taxRateBps: 1_000, population: 0 });
    expect(taxBurdens(empty).get("rome")?.provinceManpowerShift?.has(LATIUM)).toBeFalsy();
  });
});
