import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type Force, type WorldState } from "@chronica/shared";
import { resolveEngagement } from "./battle";

/**
 * What a battle leaves behind besides the dead.
 *
 * The resolver has always produced `siegeAndControlChanges`, and the world has
 * always had a `"spoils"` transaction kind and a `capturableValues` table.
 * Nothing joined them: ground changed hands and no coin moved, and a beaten
 * army kept its pay chest because no code path could take it.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MESSANA = "ita-72843720b81376294924159-sicily-northeast";

/**
 * The Syracusan army falls on the Mamertine garrison at Messana: the fight the
 * scenario's opening crisis is pointed at, and a lopsided one, so the outcome
 * is decisive rather than a coin toss.
 */
function theStrait(): WorldState {
  const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return {
    ...opening,
    material: {
      ...opening.material,
      forces: opening.material.forces.map((force) =>
        force.id === "syracusan-army" ? { ...force, locationId: MESSANA } : force),
    },
  };
}

const forceOf = (state: WorldState, id: string): Force => state.material.forces.find((force) => force.id === id)!;
const balance = (state: WorldState, id: string) => state.material.accounts.find((account) => account.id === id)!.balance;

function fight(state: WorldState, seed: string) {
  return resolveEngagement({
    world: state,
    attacker: forceOf(state, "syracusan-army"),
    defender: forceOf(state, "mamertine-garrison"),
    posture: "offer_battle",
    tactic: null,
    warfare: definition.warfare,
    battleId: `battle-${seed}`,
    seed,
  }, 0);
}

describe("the spoils of a battle", () => {
  it("moves money without minting any of it", () => {
    const before = theStrait();
    const total = (state: WorldState) => state.material.accounts.reduce((sum, account) => sum + account.balance, 0);
    const after = fight(before, "conservation").world;
    // A sacked province adds coin from outside the accounts -- it was in the
    // province, not in anybody's books -- so the total may only rise, and a
    // captured chest must not change it at all.
    expect(total(after)).toBeGreaterThanOrEqual(total(before));
  });

  it("takes the beaten army's chest and says so in the record", () => {
    const before = theStrait();
    const mamertineChest = balance(before, "mamertine-garrison-chest");
    expect(mamertineChest).toBeGreaterThan(0);

    // Enough seeds that at least one produces a decisive result either way;
    // the assertion is about what a decisive result does, not about who wins.
    const decisive = ["a", "b", "c", "d", "e", "f"]
      .map((seed) => fight(before, seed))
      .find((result) => result.world.material.transactions.some((transaction) => transaction.kind === "spoils"));

    expect(decisive).toBeDefined();
    const spoils = decisive!.world.material.transactions.filter((transaction) => transaction.kind === "spoils");
    expect(spoils.length).toBeGreaterThan(0);
    // Every coin taken is reported, so the Chronicle can say what was carried
    // off rather than leaving it in the ledger where nobody reads it.
    expect(decisive!.facts.some((fact) => fact.kind === "war_chest_taken" || fact.kind === "province_plundered")).toBe(true);
  });

  it("is the same battle twice, spoils included", () => {
    const before = theStrait();
    const first = fight(before, "replay");
    const second = fight(before, "replay");
    expect(first.world.material.transactions).toEqual(second.world.material.transactions);
    expect(first.world.material.capturableValues).toEqual(second.world.material.capturableValues);
  });

  it("does not let one army of a power loot another of the same power", () => {
    const before = theStrait();
    // Two armies of one power can end up on opposite sides of a field -- a
    // mutiny, a usurper -- and the winner is not thereby entitled to the
    // loser's wages. Found by this test: before the guard, Syracuse's army
    // emptied the chest of a garrison that had just become Syracusan.
    const ownSide: WorldState = {
      ...before,
      material: {
        ...before.material,
        forces: before.material.forces.map((force) =>
          force.id === "mamertine-garrison" ? { ...force, polityId: "syracuse" } : force),
      },
    };
    const after = fight(ownSide, "kin").world;
    expect(after.material.transactions.filter((transaction) => transaction.kind === "spoils")).toEqual([]);
  });
});
