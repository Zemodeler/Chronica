import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, hasPort, hubOf, marketGeography, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * Rome's province had no port, so a venture from Rome was bySea:false and a Roman merchant's first cargo went by land. Ostia, the harbour at the Tiber's
 * mouth (the castrum of about 349-338 BCE; the legend of Ancus Marcius is no date), is Rome's port in the province that holds the city.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("Rome has Ostia", () => {
  it("has a port in the province that holds the city, and the hubs stay between forty and eighty", () => {
    const state = world();
    expect(hasPort(state, PUNIC_IDS.rome)).toBe(true);
    expect(state.map.provinces.find((province) => province.id === PUNIC_IDS.rome)!.settlements.some((town) => town.name === "Ostia" && town.kind === "port")).toBe(true);
    const hubs = marketGeography(state).hubs.length;
    expect(hubs).toBeGreaterThanOrEqual(40);
    expect(hubs).toBeLessThanOrEqual(80);
    expect(hubOf(state, PUNIC_IDS.rome)).not.toBeNull();
  });

  it("lets a venture from Rome sail by sea", () => {
    const state = world();
    const context: ApplyContext = {
      now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "manius-curius" }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
      ids: createIdFactory("ostia"), gameId: "game-ostia", playerCharacterId: "manius-curius", creditAccepted: true,
    };
    const result = applyDeltas({ ...state, material: { ...state.material, accounts: state.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: 9_000_000 } : account)) } }, [WorldDeltaSchema.parse({
      op: "trade_venture_open", localId: "grain", title: "Grain from Sicily", ownerCharacterRef: "manius-curius", fromProvinceId: PUNIC_IDS.rome, toProvinceId: PUNIC_IDS.syracuse,
      band: "slight", paidFromAccountRef: "curius-purse", reason: "A Roman merchant sends a cargo.",
    })], context);
    expect(result.rejected).toEqual([]);
    expect(result.world.material.ventures[0]!.bySea).toBe(true);
  });
});
