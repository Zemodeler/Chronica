import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, taxBurdens, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { withMiddlingManagers } from "./middling-managers";

/**
 * "Give them a treasury, make the rule."
 *
 * The eight allies of the foedus owe Rome men and no money, and (v53) keep a
 * chest and a land levy of their own: a `men` province still pays its holder
 * the ordinary levy less the call-up's two fifths. These run a year of the
 * real tick and read what the allies' chests did.
 */
const ALLIES = ["etruscan-cities", "umbrians", "picentes", "marsi-paeligni", "samnites", "lucanians", "bruttians", "apulian-cities"];
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => withMiddlingManagers(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const chest = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === `${id}-treasury`)!.balance;

describe("an ally keeps its own chest", () => {
  it("opens every ally with a chest, a land levy and a burden under the customary half, and owes Rome men", () => {
    const world = opening();
    const burdens = taxBurdens(world);
    for (const id of ALLIES) {
      expect(chest(world, id), id).toBeGreaterThan(0);
      const burden = burdens.get(id)!;
      expect(burden.asked / burden.bearable, id).toBeLessThan(0.5);
      expect(burden.menPerYear, id).toBeGreaterThan(1_000);
    }
  });

  it("collects the levy into the ally's chest and pays its upkeep out of it, a little ahead, as the months go", () => {
    let world = opening();
    const opened = new Map(ALLIES.map((id) => [id, chest(world, id)]));
    for (let month = 1; month <= 12; month += 1) world = runDeterministicTick({ world, toDay: month * 30, ids: createIdFactory(`ally-${month}`), warfare: definition.warfare }).world;
    for (const id of ALLIES) {
      expect(chest(world, id), id).toBeGreaterThan(opened.get(id)!);
      expect(world.material.obligations.find((obligation) => obligation.id === `${id}-upkeep`)!.arrears, id).toBe(0);
    }
  });
});
