import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, openWar, reconcileCapitals, type WorldDelta } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import type { ApplyContext } from "./apply/context";
import { pressSieges } from "./sieges";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const context: ApplyContext = {
  now: { day: 1, minute: 0 }, actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory("capital"), gameId: "capital-test",
};

describe("a captured capital", () => {
  it("allows an explicit order to restore an owned capital after the original war ended", () => {
    const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const wars = openWar(opening.polityAgreements, { id: "roman-war", polityId: "rome", otherPolityId: "carthage", terms: "War.", atStep: 0, sourceMessageId: null, reason: "War." });
    const captured = reconcileCapitals({ ...opening, polityAgreements: wars, map: { ...opening.map, provinces: opening.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) => city.id === "settlement-rome" ? { ...city, controllerPolityId: "carthage" } : city) })) } });
    const retaken = reconcileCapitals({ ...captured,
      polityAgreements: captured.polityAgreements.map((war) => war.id === "roman-war" ? { ...war, status: "ended" as const, endedAtStep: 1, endedReason: "Peace." } : war),
      map: { ...captured.map, provinces: captured.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) => city.id === "settlement-rome" ? { ...city, controllerPolityId: "rome" } : city) })) },
    });
    expect(retaken.map.polities.find((polity) => polity.id === "rome")!.capitalSettlementId).not.toBe("settlement-rome");
    const restored = applyDeltas(retaken, [WorldDeltaSchema.parse({ op: "capital_set", polityRef: "rome", settlementId: "settlement-rome", reason: "Restore Rome as our capital." })], context);
    expect(restored.rejected).toEqual([]);
    expect(restored.breaches).toEqual([]);
    expect(restored.world.map.polities.find((polity) => polity.id === "rome")!.capitalSettlementId).toBe("settlement-rome");
    expect(restored.world.map.polities.find((polity) => polity.id === "rome")!.displacedCapital).toBeNull();
    expect(restored.factProposals.some((fact) => fact.kind === "capital_relocated")).toBe(true);
  });

  it("rejects a capital-designation order naming a city held by another power", () => {
    const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const refused = applyDeltas(opening, [WorldDeltaSchema.parse({ op: "capital_set", polityRef: "rome", settlementId: "settlement-carthage", reason: "Name Carthage our capital." })], context);
    expect(refused.applied).toEqual([]);
    expect(refused.rejected[0]?.reason).toMatch(/does not hold/);
    expect(refused.world.map.polities.find((polity) => polity.id === "rome")!.capitalSettlementId).toBe("settlement-rome");
  });

  it("lets an order make the replacement permanent even while the original war continues", () => {
    const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const captured = reconcileCapitals({ ...opening,
      polityAgreements: openWar(opening.polityAgreements, { id: "permanent-seat-war", polityId: "rome", otherPolityId: "carthage", terms: "War.", atStep: 0, sourceMessageId: null, reason: "War." }),
      map: { ...opening.map, provinces: opening.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) => city.id === "settlement-rome" ? { ...city, controllerPolityId: "carthage" } : city) })) },
    });
    const replacement = captured.map.polities.find((polity) => polity.id === "rome")!.capitalSettlementId!;
    const decreed = applyDeltas(captured, [WorldDeltaSchema.parse({ op: "capital_set", polityRef: "rome", settlementId: replacement, reason: "Make our replacement seat permanent." })], context);
    expect(decreed.rejected).toEqual([]);
    expect(decreed.world.map.polities.find((polity) => polity.id === "rome")!.displacedCapital).toBeNull();
    const retaken = reconcileCapitals({ ...decreed.world, map: { ...decreed.world.map, provinces: decreed.world.map.provinces.map((province) => ({ ...province, settlements: province.settlements.map((city) => city.id === "settlement-rome" ? { ...city, controllerPolityId: "rome" } : city) })) } });
    expect(retaken.map.polities.find((polity) => polity.id === "rome")!.capitalSettlementId).toBe(replacement);
  });

  it("loses capital status when a deterministic siege opens its gates", () => {
    const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const before = {
      ...opening,
      polityAgreements: openWar(opening.polityAgreements, { id: "war-messana", polityId: "rome", otherPolityId: "mamertines", terms: "War.", atStep: 0, sourceMessageId: null, reason: "War." }),
      material: { ...opening.material, forces: opening.material.forces.map((force) => force.id === "roman-field-army" ? { ...force, locationId: PUNIC_IDS.messana } : force) },
    };
    const laid = applyDeltas(before, [WorldDeltaSchema.parse({ op: "siege_lay", localId: "messana", forceRef: "roman-field-army", settlementId: "settlement-messana", reason: "Invest the capital." })], context);
    expect(laid.rejected).toEqual([]);
    const ready = { ...laid.world, sieges: laid.world.sieges.map((siege) => ({ ...siege, pressureBps: 10_000 })) };
    const taken = pressSieges(ready, 2);
    expect(taken.world.sieges[0]!.status).toBe("taken");
    const replacement = taken.world.map.polities.find((polity) => polity.id === "mamertines")!.capitalSettlementId;
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe("settlement-messana");
    expect(taken.world.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === "settlement-messana")!.controllerPolityId).toBe("rome");
  });

  it.each(["rome", null])("becomes an ordinary city when taken by %s", (taker) => {
    const opening = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const before = { ...opening, material: { ...opening.material, forces: opening.material.forces.map((force) => force.id === "roman-field-army" ? { ...force, locationId: PUNIC_IDS.messana } : force) } };
    const city = before.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === "settlement-messana")!;
    const delta: WorldDelta = { op: "settlement_control_set", settlementId: city.id, toPolityRef: taker, sacked: false, reason: "The gates opened." };
    const result = applyDeltas(before, [delta], context);
    expect(result.rejected).toEqual([]);
    expect(result.world.map.polities.find((polity) => polity.id === "mamertines")!.capitalSettlementId).not.toBe(city.id);
    expect(result.world.map.polities.find((polity) => polity.id === "rome")!.capitalSettlementId).toBe("settlement-rome");
    expect(result.world.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === city.id)).toEqual({ ...city, controllerPolityId: taker });
  });
});
