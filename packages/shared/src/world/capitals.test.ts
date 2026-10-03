import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "./world-state";
import { openWar } from "./agreements";
import { reconcileCapitals } from "./capitals";

const polityId = "carthage";
const original = "carthage-city";
const capital = (world: WorldState) => world.map.polities.find((polity) => polity.id === polityId)!;
function opening(): WorldState {
  const world = WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
  return { ...world, polityAgreements: openWar(world.polityAgreements, { id: "first-war", polityId, otherPolityId: "rome", terms: "War.", atStep: 0, sourceMessageId: null, reason: "War." }) };
}
function hold(world: WorldState, settlementId: string, controllerPolityId: string): WorldState {
  return { ...world, map: { ...world.map, provinces: world.map.provinces.map((province) => ({
    ...province, settlements: province.settlements.map((city) => city.id === settlementId ? { ...city, controllerPolityId } : city),
  })) } };
}

describe("capital succession", () => {
  it("chooses the largest surviving city and leaves the fallen capital ordinary", () => {
    const captured = reconcileCapitals(hold(opening(), original, "rome"));
    expect(capital(captured).capitalSettlementId).toBe("palermo-city");
    expect(capital(captured).displacedCapital).toEqual({ settlementId: original, warIds: ["first-war"] });
    expect(reconcileCapitals(captured)).toBe(captured);
  });

  it("restores the old seat on recapture during the exact same war, across save round trips", () => {
    const captured = WorldStateSchema.parse(JSON.parse(JSON.stringify(reconcileCapitals(hold(opening(), original, "rome")))));
    const retaken = reconcileCapitals(hold(captured, original, polityId));
    expect(capital(retaken).capitalSettlementId).toBe(original);
    expect(capital(retaken).displacedCapital).toBeNull();
    expect(retaken.map.polities.filter((polity) => polity.capitalSettlementId === "palermo-city")).toEqual([]);
  });

  it.each([false, true])("does not restore it after peace, even with a new war against the same enemy: %s", (newWar) => {
    const captured = reconcileCapitals(hold(opening(), original, "rome"));
    const peace = { ...captured, polityAgreements: captured.polityAgreements.map((war) => war.id === "first-war"
      ? { ...war, status: "ended" as const, endedAtStep: 5, endedReason: "Peace." } : war) };
    const later = newWar ? { ...peace, polityAgreements: openWar(peace.polityAgreements, { id: "second-war", polityId, otherPolityId: "rome", terms: "Another war.", atStep: 10, sourceMessageId: null, reason: "War." }) } : peace;
    expect(capital(reconcileCapitals(hold(later, original, polityId))).capitalSettlementId).toBe("palermo-city");
  });

  it("remembers the original seat even if its replacement also falls in that war", () => {
    const captured = reconcileCapitals(hold(opening(), original, "rome"));
    const twice = reconcileCapitals(hold(captured, "palermo-city", "rome"));
    expect(capital(twice).capitalSettlementId).toBe("drepanum-city");
    expect(capital(twice).displacedCapital?.settlementId).toBe(original);
    expect(capital(reconcileCapitals(hold(twice, original, polityId))).capitalSettlementId).toBe(original);
  });

  it("does not pick an old seat without an order when its replacement falls in a later war", () => {
    const captured = reconcileCapitals(hold(opening(), original, "rome"));
    const peace = { ...captured, polityAgreements: captured.polityAgreements.map((war) => ({ ...war, status: "ended" as const, endedAtStep: 5, endedReason: "Peace." })) };
    const later = { ...peace, polityAgreements: openWar(peace.polityAgreements, { id: "later-war", polityId, otherPolityId: "rome", terms: "War.", atStep: 10, sourceMessageId: null, reason: "War." }) };
    const retaken = hold(later, original, polityId);
    const secondLoss = reconcileCapitals(hold(retaken, "palermo-city", "rome"));
    expect(capital(secondLoss).capitalSettlementId).toBe("drepanum-city");
    expect(capital(secondLoss).capitalSettlementId).not.toBe(original);
  });

  it("uses a provisional town when countryside survives but no cities do", () => {
    let world = opening();
    for (const city of world.map.provinces.flatMap((province) => province.settlements).filter((city) => city.controllerPolityId === polityId)) world = hold(world, city.id, "rome");
    const settled = reconcileCapitals(world);
    const seat = settled.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === capital(settled).capitalSettlementId)!;
    expect(seat.controllerPolityId).toBe(polityId);
    expect(seat.kind).toBe("town");
    expect(reconcileCapitals(settled)).toBe(settled);
  });

  it("does not designate a capital for an ended polity", () => {
    const world = opening();
    const ended = { ...world, map: { ...world.map, polities: world.map.polities.map((polity) => polity.id === polityId ? { ...polity, endedAtStep: 1 } : polity) } };
    expect(capital(reconcileCapitals(ended)).capitalSettlementId).toBeNull();
  });
});
