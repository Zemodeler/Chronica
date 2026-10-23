import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, marketEntry, marketPriceBps, type Force, type GoodId, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { withMiddlingManagers } from "./middling-managers";
import { ensureConstitutions } from "./constitutions";

/** The Punic opening, and the months run through the real tick (shared by the equipment tests). */
export const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
export const opening = (): WorldState => withMiddlingManagers(ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 }));

export function months(world: WorldState, from: number, count: number, tag: string): WorldState {
  let current = world;
  for (let month = from + 1; month <= from + count; month += 1) current = runDeterministicTick({ world: current, toDay: month * 30, ids: createIdFactory(`${tag}-${month}`), warfare: definition.warfare, government: definition.government }).world;
  return current;
}

export const forceOf = (world: WorldState, id: string): Force => world.material.forces.find((force) => force.id === id)!;
export const romeFieldArmy = (world: WorldState): Force => world.material.forces.find((force) => force.polityId === "rome" && force.name === "Roman field army")!;
export const chestOf = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === id)!.balance;
export const stockOf = (world: WorldState, provinceId: string, good: GoodId): number => marketEntry(world, provinceId, good)?.stock ?? 0;
export const priceOf = (world: WorldState, provinceId: string, good: GoodId): number => marketPriceBps(world, provinceId, good);

/** A tick the real game would run: with the scenario's offices. */
export const tickTo = (world: WorldState, day: number, tag: string) => runDeterministicTick({ world, toDay: day, ids: createIdFactory(tag), warfare: definition.warfare, government: definition.government });
