import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  WorldStateSchema,
  developmentFactor,
  developmentPotential,
  ensureProvinceMaterial,
  harvestDevelopmentFactor,
  provinceGrounds,
  reckonTaxCapacity,
  type ProvinceMaterial,
  type WorldState,
} from "@chronica/shared";
import { months } from "./passing-months";
import { provinceTargetsFrom } from "./standing-effects";

/**
 * "I mean to leave the province in peace and keep the tax light, and see it grow."
 *
 * Every province was alike once it was counted: the same output from a head,
 * the same tax, and nothing a ruler did to it made it any richer, so there was
 * nothing to be gained by good government and nothing lost by bad. A province
 * now has a development of its own: it starts between a fifth and seven tenths
 * of the way up by its ground, its town and its harbour, rises a few hundred a
 * year where it is fed, orderly, at peace and lightly taxed, and falls where it
 * is burned, in revolt, starved or taxed past what it can bear. It sets how
 * many people the ground carries and what they can pay.
 */

const LATIUM = PUNIC_IDS.rome;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const rowOf = (world: WorldState, id: string): ProvinceMaterial => world.material.provinceMaterial.find((row) => row.provinceId === id)!;
const withRow = (world: WorldState, id: string, patch: Partial<ProvinceMaterial>): WorldState => ({
  ...world,
  material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === id ? { ...row, ...patch } : row)) },
});

describe("a province develops", () => {
  it("starts somewhere between a fifth and seven tenths up, and no two places alike", () => {
    const world = opening();
    const grounds = provinceGrounds(world);
    const developments = world.material.provinceMaterial.map((row) => row.developmentBps!);
    expect(developments.length).toBeGreaterThan(6_000);
    expect(Math.min(...developments)).toBeGreaterThanOrEqual(2_000);
    expect(Math.max(...developments)).toBeLessThanOrEqual(7_000);
    // A real spread: provinces differ by thousands, not by a few points.
    const sorted = [...developments].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * 0.9)]! - sorted[Math.floor(sorted.length * 0.1)]!).toBeGreaterThan(1_000);
    expect(new Set(developments).size).toBeGreaterThan(500);
    // By ground, by town, by harbour: the coastal plain beats the steppe; a port beats the same ground without.
    const mean = (ids: string[]): number => ids.reduce((sum, id) => sum + rowOf(world, id).developmentBps!, 0) / Math.max(1, ids.length);
    const ofTerrain = (terrain: string): string[] => world.map.provinces.filter((province) => province.terrainId === terrain && province.settlements.length === 0).map((province) => province.id);
    expect(mean(ofTerrain("coastal-plain"))).toBeGreaterThan(mean(ofTerrain("hills-uplands")));
    expect(mean(ofTerrain("hills-uplands"))).toBeGreaterThan(mean(ofTerrain("desert-steppe")));
    const ports = world.map.provinces.filter((province) => province.settlements.some((settlement) => settlement.kind === "port")).map((province) => province.id);
    expect(mean(ports)).toBeGreaterThan(mean(ofTerrain("coastal-plain")));
    // And every province starts short of what it could become, so there is something to gain.
    const short = world.map.provinces.filter((province) => rowOf(world, province.id).developmentBps! < grounds.get(province.id)!.potentialBps);
    expect(short.length).toBe(world.map.provinces.length);
  });

  it("reckons what a province can pay from how developed it is, and a decree on top of it stays", () => {
    const base = { population: 100_000, productiveCapacityBps: 10_000, warDamageBps: 0 };
    const low = reckonTaxCapacity({ ...base, developmentBps: 2_000 });
    const mid = reckonTaxCapacity({ ...base, developmentBps: 5_000 });
    const high = reckonTaxCapacity({ ...base, developmentBps: 7_000 });
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    // 1 at the neutral level, so a province with no development reckons as it always did.
    expect(reckonTaxCapacity(base)).toBe(mid);
    expect(developmentFactor(5_000)).toBeCloseTo(1, 6);
    expect(reckonTaxCapacity({ ...base, developmentBps: 5_000, taxCapacityOffset: 500 })).toBe(mid + 500);
    // A poor province still feeds its own.
    expect(harvestDevelopmentFactor(2_000)).toBeGreaterThan(0.9);
  });

  it("grows a few hundred a year in peace under a light tax, and never past what the ground could reach", () => {
    const start = withRow(opening(), LATIUM, { taxRateBps: 500 });
    const potential = provinceGrounds(start).get(LATIUM)!.potentialBps;
    const began = rowOf(start, LATIUM).developmentBps!;
    const five = months(start, 60);
    const gained = rowOf(five, LATIUM).developmentBps! - began;
    // Slow: a few hundred a year at the very best, so five years is some hundreds and not thousands.
    expect(gained).toBeGreaterThan(500);
    // 5 x 320 -> 5 x 340 (2026-10-07, v54): the houses seated at Rome's hub lift its carrying capacity and cheapen the haul, so the traffic
    // that builds Latium up is a few in a hundred busier.
    expect(gained).toBeLessThanOrEqual(5 * 340);
    // Its taxes follow it up, and so does its room for people.
    expect(rowOf(five, LATIUM).taxCapacity).toBeGreaterThan(rowOf(start, LATIUM).taxCapacity);
    // Brought to within a few hundred of it, and left for ten years, it stops at its potential.
    const nearly = withRow(start, LATIUM, { developmentBps: potential - 500 });
    const long = months(nearly, 120);
    expect(rowOf(long, LATIUM).developmentBps!).toBeLessThanOrEqual(potential);
    expect(rowOf(long, LATIUM).developmentBps!).toBeGreaterThan(potential - 250);
  });

  it("grows faster where the tax is light than where it is customary, and not at all where it is heavy", () => {
    const start = opening();
    const grew = (rate: number): number => rowOf(months(withRow(start, LATIUM, { taxRateBps: rate }), 36), LATIUM).developmentBps! - rowOf(start, LATIUM).developmentBps!;
    const light = grew(400);
    const ordinary = grew(1_000);
    const heavy = grew(2_600);
    expect(light).toBeGreaterThan(ordinary);
    expect(ordinary).toBeGreaterThan(0);
    expect(heavy).toBeLessThanOrEqual(0);
  });

  it("falls in war under a heavy tax, a good deal faster than it rose", () => {
    const peaceful = withRow(opening(), LATIUM, { taxRateBps: 500 });
    const torn = withRow(peaceful, LATIUM, { warDamageBps: 8_000, stabilityBps: 1_000, taxRateBps: 3_500 });
    const began = rowOf(torn, LATIUM).developmentBps!;
    // The first two months, while the burning lasts: after it the fields are sown again and the fall slows.
    const afterWar = months(torn, 2);
    const fell = began - rowOf(afterWar, LATIUM).developmentBps!;
    const rose = rowOf(months(peaceful, 2), LATIUM).developmentBps! - rowOf(peaceful, LATIUM).developmentBps!;
    expect(fell).toBeGreaterThan(150);
    // At several times the speed: that is the point of the asymmetry.
    expect(fell).toBeGreaterThan(rose * 3);
  });

  it("lets what is built there lift what it can become, and not without end", () => {
    const start = opening();
    const potential = provinceGrounds(start).get(LATIUM)!.potentialBps;
    const market = (id: string, band: "slight" | "marked" | "great") => ({
      id, kind: "other" as const, name: `Works ${id}`, provinceId: LATIUM, settlementId: null, ownerPolityId: "rome", garrisonCapacity: 0, defensiveEffectsBps: 0,
      supplyRadius: 0, builtAtStep: 0, provenanceProjectId: null,
      effects: [{ quantity: "development" as const, direction: "raise" as const, band, scope: "here" as const }],
    });
    const built = { ...start, structures: [...start.structures, market("a", "great"), market("b", "great"), market("c", "great")] };
    const targets = provinceTargetsFrom(built).get(LATIUM)!;
    // Three great works, and still no more than a fifth of potential.
    expect(targets.developmentShiftBps).toBe(2_000);
    // Where the province has already reached its potential, the works are what lets it go on.
    const atTheTop = (world: WorldState): WorldState => withRow(world, LATIUM, { developmentBps: potential });
    const raised = months(atTheTop(built), 120, 0, provinceTargetsFrom);
    const unraised = months(atTheTop(start), 120);
    expect(rowOf(unraised, LATIUM).developmentBps!).toBeLessThanOrEqual(potential);
    expect(rowOf(raised, LATIUM).developmentBps!).toBeGreaterThan(potential + 100);
    // The ceiling is potential lifted by the works, not the sky.
    expect(rowOf(raised, LATIUM).developmentBps!).toBeLessThanOrEqual(Math.min(10_000, potential + 2_000));
    // A market is a work of this kind by default.
    const defaulted = { ...start, structures: [...start.structures, { ...market("m", "slight"), kind: "market" as const, effects: undefined }] };
    expect(provinceTargetsFrom(defaulted).get(LATIUM)?.developmentShiftBps).toBe(300);
  });

  it("gives a province more room for people the more developed it is, and fills it slowly", () => {
    const start = opening();
    const grounds = provinceGrounds(start).get(LATIUM)!;
    const bare = { ...rowOf(start, LATIUM), population: Math.round(grounds.baselinePeople * 0.7) };
    // A people 30 per cent short of the room it has grows, but not at the old flat rate of five in a hundred a year.
    const grown = months(withRow(start, LATIUM, bare), 12);
    const growth = rowOf(grown, LATIUM).population / bare.population - 1;
    expect(growth).toBeGreaterThan(0.002);
    expect(growth).toBeLessThan(0.04);
    // At its room it grows hardly at all (only as development makes more room).
    const full = withRow(start, LATIUM, { population: grounds.baselinePeople });
    expect(rowOf(months(full, 12), LATIUM).population).toBeLessThanOrEqual(grounds.baselinePeople * 1.005);
    // And the room is the town's and country's own count, more where development is higher.
    expect(developmentPotential({ settlements: [], terrainId: "coastal-plain" })).toBeGreaterThan(developmentPotential({ settlements: [], terrainId: "desert-steppe" }));
  });
});
