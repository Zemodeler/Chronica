import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  COUNTRYSIDE_BY_TERRAIN,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  isQuietGround,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * Aargau, and the 737 provinces like it.
 *
 * Population was counted from towns, and the map drew towns only where the war
 * is. Everywhere else held nobody, so an army there could not eat, a levy
 * raised no one and the land paid nothing. Now the countryside is counted by
 * its ground -- and the edge of the world, though it eats and pays, makes no
 * history of its own.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const rowOf = (world: WorldState, id: string) => world.material.provinceMaterial.find((row) => row.provinceId === id)!;

describe("the countryside", () => {
  it("is counted for every province the map drew no town in, by its ground", () => {
    const world = opening();
    const townless = world.map.provinces.filter((province) => province.settlements.length === 0);
    expect(townless.length).toBeGreaterThan(700);
    for (const province of townless) {
      const row = rowOf(world, province.id);
      expect(row.population).toBe(COUNTRYSIDE_BY_TERRAIN[province.terrainId] ?? 50_000);
      expect(row.availableManpower).toBeGreaterThan(0);
      expect(row.taxCapacity).toBeGreaterThan(0);
    }
    // Towns are counted with the country that feeds them: a size unit is 400
    // townsfolk and 3 600 on the land (province-material.ts).
    const latium = world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === "settlement-rome"))!;
    expect(rowOf(world, latium.id).population).toBe(latium.settlements.reduce((sum, settlement) => sum + settlement.size * 4_000, 0));
  });

  it("fills in a save written when it held nobody, and leaves alone ground something has happened in", () => {
    const counted = opening();
    const [untouched, burned] = counted.map.provinces.filter((province) => province.settlements.length === 0).map((province) => province.id);
    const empty = { population: 0, availableManpower: 0, taxCapacity: 0 };
    const old: WorldState = {
      ...counted,
      material: {
        ...counted.material,
        provinceMaterial: counted.material.provinceMaterial.map((row) => (row.provinceId === untouched ? { ...row, ...empty, stabilityBps: 4_000 }
          : row.provinceId === burned ? { ...row, ...empty, warDamageBps: 3_000 } : row)),
      },
    };
    const mended = ensureProvinceMaterial(old, 90);
    expect(rowOf(mended, untouched!).population).toBeGreaterThan(0);
    // What the land has lived through is kept: only the head count was missing.
    expect(rowOf(mended, untouched!).stabilityBps).toBe(4_000);
    expect(rowOf(mended, burned!).population).toBe(0);
    // And it is done once.
    expect(ensureProvinceMaterial(mended, 91)).toBe(mended);
  });
});

describe("the edge of the world", () => {
  it("is all far ground, and neither rises nor makes harvest news", () => {
    const world = opening();
    const far = world.map.provinces.filter(isQuietGround);
    expect(far.length).toBeGreaterThan(700);
    // Italy and Africa are drawn "far" as well; they are not the edge.
    expect(far.some((province) => province.settlements.some((settlement) => settlement.id === "settlement-rome"))).toBe(false);
    expect(far.some((province) => province.settlements.some((settlement) => settlement.id === "settlement-carthage"))).toBe(false);
    // Six years of misery in every far province, and a year of seasons.
    const miserable: WorldState = {
      ...world,
      material: {
        ...world.material,
        provinceMaterial: world.material.provinceMaterial.map((row) => (far.some((province) => province.id === row.provinceId) ? { ...row, stabilityBps: 500, foodSecurityBps: 1_000 } : row)),
      },
    };
    let current = miserable;
    const NEWS = new Set(["rising", "civil_war", "famine", "migration", "harvest", "harvest_failed"]);
    const farIds = new Set(far.map((province) => province.id));
    const edgeNews: string[] = [];
    for (let day = 30; day <= 400; day += 30) {
      const ticked = runDeterministicTick({ world: current, toDay: day, ids: createIdFactory(`edge-${day}`), warfare: definition.warfare, clock: definition.clock });
      current = ticked.world;
      for (const fact of ticked.factProposals) {
        if (NEWS.has(fact.kind) && (fact.affectedRefs ?? []).some((ref) => ref.kind === "province" && farIds.has(ref.id))) edgeNews.push(`${fact.kind}: ${fact.summary}`);
      }
    }
    expect(edgeNews).toEqual([]);
    // Yet its people still starved and died: the edge eats like anywhere else.
    const before = far.reduce((sum, province) => sum + rowOf(miserable, province.id).population, 0);
    const after = far.reduce((sum, province) => sum + rowOf(current, province.id).population, 0);
    expect(after).toBeLessThan(before);
  });
});
