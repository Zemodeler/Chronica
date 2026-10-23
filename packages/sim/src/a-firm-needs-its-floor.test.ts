import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { HOUSE_SAILING_FLOOR } from "./merchant-houses";
import { createIdFactory } from "./ports";

/**
 * A firm founded below what it takes to sail a cargo sat idle eight turns and nobody said why: a house keeps a reserve in hand and sends no cargo of less than a
 * stake. A firm that could never sail is refused at its founding, in numbers; one that can is founded.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const withPurse = (amount: number): WorldState => {
  const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  return { ...base, material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === "leptines-purse" ? { ...account, balance: amount } : account)) } };
};
const found = (world: WorldState) => {
  const deltas = [WorldDeltaSchema.parse({ op: "house_found", name: "The negotiatores of Leptines", kind: "grain", headRef: null, capital: 30_000, reason: "To trade." })];
  return applyDeltas(world, deltas, {
    now: { day: world.instant.day, minute: 0 }, actorRef: { kind: "character", id: "leptines-syracuse" }, offices: definition.government.offices, warfare: definition.warfare,
    ids: createIdFactory("floor"), gameId: "game-floor", orderDeltas: new Set(deltas),
  });
};

describe("a firm needs its floor", () => {
  it("is refused below what it takes to sail, with the number", () => {
    const result = found(withPurse(HOUSE_SAILING_FLOOR - 1_000));
    expect(result.rejected[0]?.reason).toMatch(new RegExp(`A firm needs at least ${HOUSE_SAILING_FLOOR} to sail`));
    expect(result.world.economy?.houses.some((house) => house.headCharacterId === "leptines-syracuse")).not.toBe(true);
  });
  it("is founded above it", () => {
    const result = found(withPurse(40_000));
    expect(result.rejected).toEqual([]);
    expect(result.world.economy?.houses.some((house) => house.headCharacterId === "leptines-syracuse" && house.status === "trading")).toBe(true);
  });
});
