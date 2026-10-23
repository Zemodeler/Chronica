import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { EMPTY_ECONOMY_MEMORY, ScenarioDefinitionSchema, WorldStateSchema, drawStock, ensureMarkets, ensureProvinceMaterial, isQuietGround, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { RISING_AFTER_MONTHS } from "./unrest";

/**
 * A rising is led by a man who stands for the power it rises for.
 *
 * Hieron's aim was "secure Syracuse against the Mamertines" (kind peace, target the Mamertines). `rise()` read an
 * aim aimed AT a power as a wish to rise FOR it, made the king lead risings against his own crown, and rewrote
 * his polity to the Mamertines (hand run of 2026-10-22, H1).
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

function miserable(opened: WorldState, provinceId: string): WorldState {
  const world = drawStock(ensureMarkets(opened), provinceId, "grain", Number.MAX_SAFE_INTEGER).world;
  return {
    ...world,
    economy: { ...EMPTY_ECONOMY_MEMORY, ...world.economy, lastReviewStep: 0, unrest: [{ provinceId, months: RISING_AFTER_MONTHS - 1 }] },
    material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((material) => (material.provinceId === provinceId ? { ...material, stabilityBps: 1_000, foodSecurityBps: 1_500 } : material)) },
  };
}

describe("who leads a rising", () => {
  it("is never a man of another power whose aim is against the one the province wants", () => {
    const world = opening();
    const garrisoned = new Set(world.material.forces.map((force) => force.locationId));
    const province = world.map.provinces.find((candidate) => candidate.controllerPolityId === "rome" && !isQuietGround(world, candidate.id) && !garrisoned.has(candidate.id)
      && world.material.provinceMaterial.find((row) => row.provinceId === candidate.id)!.availableManpower >= 1_000)!;
    const hieron = world.characters.find((character) => character.id === "hieron-ii")!;
    expect(hieron.polityId).toBe("syracuse");
    const rigged: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === "hieron-ii"
        ? { ...character, ambitions: [{ id: "secure", label: "Secure Syracuse against the Samnites", kind: "peace" as const, targetId: "samnites", status: "active" as const, steps: [] }] }
        : character)),
      map: { ...world.map, provinces: world.map.provinces.map((candidate) => (candidate.id === province.id ? { ...candidate, yearning: { polityId: "samnites", bps: 3_000, updatedAtStep: 0 } } : candidate)) },
    };
    const ticked = runDeterministicTick({ world: miserable(rigged, province.id), toDay: 30, ids: createIdFactory("rise-lead"), warfare: definition.warfare });
    expect(ticked.world.map.provinces.find((candidate) => candidate.id === province.id)!.controllerPolityId).toBe("samnites");
    const rising = ticked.world.material.forces.find((force) => force.locationId === province.id && force.polityId === "samnites")!;
    expect(rising.commanderCharacterId).not.toBe("hieron-ii");
    expect(ticked.world.characters.find((character) => character.id === "hieron-ii")!.polityId).toBe("syracuse");
  });
});
