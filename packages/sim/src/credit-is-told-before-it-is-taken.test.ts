import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, estateTerms, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/** A venture bought a quarter down left the player owing 15,900 at 1% a month and nothing told him. Credit is told to him, and taken when he says so. */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = PUNIC_IDS.rome;
const context = (extra: Partial<ApplyContext>): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "manius-curius" }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory("credit"), gameId: "game-credit", playerCharacterId: "manius-curius", ...extra,
});
const poor = (): WorldState => {
  const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const price = estateTerms(base, LATIUM, "great")!.price;
  return { ...base, material: { ...base.material, accounts: base.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: Math.ceil(price * 0.4) } : account)) } };
};
const buy = WorldDeltaSchema.parse({
  op: "holding_create", localId: "farm", title: "A great estate in Latium", provinceId: LATIUM, holderCharacterRef: "manius-curius", band: "great", priceFromAccountRef: "curius-purse", reason: "He buys land.",
});

describe("credit is told before it is taken", () => {
  it("tells the player what the credit is and refuses until he says he takes it", () => {
    const result = applyDeltas(poor(), [buy], context({ creditAccepted: false }));
    expect(result.world.material.loans).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/needs credit: \d+% down \(\d+\), \d+ owed to the seller at 1% a month over 24 months\. Say "on credit"/);
  });
  it("takes the credit when his order said so", () => {
    const result = applyDeltas(poor(), [buy], context({ creditAccepted: true }));
    expect(result.rejected).toEqual([]);
    expect(result.world.material.loans.length).toBe(1);
  });
});
