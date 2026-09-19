import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { decideNarratorSeed, readTension, recordSeedOffered, recordSeedOutcome, seedWasTaken, type NarratorInput } from "./narrator";

const small = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const large = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

/** A world whose calendar has run far enough for the first stirring. */
function later(world: WorldState, day: number): WorldState {
  return { ...world, instant: { day, minute: 0 }, elapsedStep: day };
}

function input(world: WorldState, overrides: Partial<NarratorInput> = {}): NarratorInput {
  return { world, gameId: "game-1", ownPolityId: "rome", playerCharacterId: "marcus-atilius", facts: [], ...overrides };
}

describe("reading the ruler's comfort", () => {
  it("stays inside the unit interval on both scenario worlds", () => {
    for (const world of [small(), large()]) {
      const tension = readTension(world, "rome");
      expect(tension.comfort).toBeGreaterThanOrEqual(0);
      expect(tension.comfort).toBeLessThanOrEqual(1);
      expect(tension.summary.length).toBeGreaterThan(0);
    }
  });

  it("falls when debts go unpaid, the war goes badly, and provinces are in distress", () => {
    const calm = large();
    const calmReading = readTension(calm, "rome");

    const troubled: WorldState = {
      ...calm,
      conflicts: { ...calm.conflicts, wars: [{ polityAId: "carthage", polityBId: "rome" }] },
      material: {
        ...calm.material,
        obligations: calm.material.obligations.map((obligation) => ({ ...obligation, missedPeriods: 3 })),
        forces: calm.material.forces.map((force) => (force.polityId === "rome" ? { ...force, moraleBps: 2_000, provisionStatus: "critical" as const } : force)),
        provinceMaterial: calm.material.provinceMaterial.map((material) => ({ ...material, stabilityBps: 1_000 })),
      },
    };
    const troubledReading = readTension(troubled, "rome");
    expect(troubledReading.comfort).toBeLessThan(calmReading.comfort);
    expect(troubledReading.war).toBeLessThan(calmReading.war);
    expect(troubledReading.order).toBeLessThan(calmReading.order);
  });
});

describe("deciding what stirs", () => {
  it("leaves a fresh world alone for the opening orders", () => {
    expect(decideNarratorSeed(input(large()))).toBeNull();
  });

  it("seeds once the cadence has run, and the same seed on a replay", () => {
    const world = later(large(), 40);
    const first = decideNarratorSeed(input(world));
    expect(first).not.toBeNull();
    expect(decideNarratorSeed(input(world))).toEqual(first);
    expect(first!.brief).toContain("[");
    expect(first!.key).toMatch(/^seed-/);
  });

  it("waits again after a seed has been offered", () => {
    const world = later(large(), 40);
    const seed = decideNarratorSeed(input(world))!;
    const offered = recordSeedOutcome(recordSeedOffered(world, seed), seed, true);
    expect(offered.narrator.seedCount).toBe(1);
    expect(decideNarratorSeed(input(later(offered, 45)))).toBeNull();
  });

  it("offers an ignored seed once more under the same key, then moves on", () => {
    const world = later(large(), 40);
    const seed = decideNarratorSeed(input(world))!;
    const ignored = recordSeedOutcome(recordSeedOffered(world, seed), seed, false);
    expect(ignored.narrator.consumed).toBe(false);

    const again = decideNarratorSeed(input(later(ignored, 42)));
    expect(again).not.toBeNull();
    expect(again!.repeated).toBe(true);
    expect(again!.key).toBe(seed.key);

    const dropped = recordSeedOutcome(recordSeedOffered(later(ignored, 42), again!), again!, false);
    expect(dropped.narrator.consumed).toBe(true);
    expect(dropped.narrator.seedCount).toBe(1);
  });

  it("stops seeding when the world is already following too many threads", () => {
    const world = later(large(), 40);
    const crowded: WorldState = {
      ...world,
      storylines: Array.from({ length: 12 }, (_, index) => ({
        ...world.storylines[0]!,
        id: `thread-${index}`,
        title: `Thread ${index}`,
      })),
    };
    expect(decideNarratorSeed(input(crowded))).toBeNull();
  });

  it("lands sometimes at home and sometimes abroad, never in a country being peopled this call", () => {
    const world = later(large(), 40);
    const homes = new Set<boolean>();
    for (let game = 0; game < 60; game += 1) {
      const seed = decideNarratorSeed(input(world, { gameId: `game-${game}` }));
      if (seed === null) continue;
      homes.add(seed.inPlayerRealm);
      if (seed.kind === "world_event") expect(seed.secret).toBe(false);
      if (seed.archetype === "conspiracy") expect(seed.secret).toBe(true);
      if (seed.kind === "person_problem") expect(seed.target.characterId).not.toBe("marcus-atilius");
    }
    expect(homes.size).toBe(2);
  });

  it("knows a seed was taken up by the thread opened under its key, or by news naming its target", () => {
    const world = later(large(), 40);
    const seed = decideNarratorSeed(input(world))!;
    expect(seedWasTaken(world, [], seed)).toBe(false);
    const taken: WorldState = { ...world, storylines: [{ ...world.storylines[0]!, id: "opened", seedKey: seed.key }] };
    expect(seedWasTaken(taken, [], seed)).toBe(true);
  });
});
