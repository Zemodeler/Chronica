import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial, takenBy, takerFor, type PolityAgreement, type WorldState } from "@chronica/shared";
import { occupyOpenCountry, SIEGE_NEEDED_AT } from "./occupation";

/**
 * An ally by foedus, with no war or peace of its own, takes ground for the power it follows (docs/reports/consul-run-issues.md,
 * M5). The Picene and Samnite levies Rome called against the Messapians took Brundisium and three Messapian districts for the
 * Picentes and the Samnites, who then refused union and kept them.
 */
const war = (a: string, b: string): PolityAgreement => ({ id: `war-${a}-${b}`, kind: "war", polityId: a, otherPolityId: b, terms: "War.", sinceStep: 0, untilStep: null, sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public" });

function levyInMessapia(): { world: WorldState; provinceId: string } {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const open = opening.map.provinces.find((province) => province.controllerPolityId === "messapians" && province.settlements.every((city) => city.fortificationLevel < SIEGE_NEEDED_AT))!;
  const template = opening.material.forces.find((force) => force.polityId === "rome")!;
  return {
    provinceId: open.id,
    world: {
      ...opening,
      polityAgreements: [...opening.polityAgreements, war("rome", "messapians"), war("picentes", "messapians")],
      material: { ...opening.material, forces: [...opening.material.forces.filter((force) => force.polityId !== "messapians"), {
        ...structuredClone(template), id: "picene-levy", name: "The Picentes contingent", polityId: "picentes", locationId: open.id,
        personnel: [{ ...template.personnel[0]!, fit: 3_000 }], authorizedStrength: 3_000,
      }] },
    },
  };
}

describe("an ally's levy in its leader's war", () => {
  it("occupies the enemy's open country for its leader, not for its own people", () => {
    const { world, provinceId } = levyInMessapia();
    expect(takerFor(world.polityAgreements, "picentes", "messapians")).toBe("rome");
    const { world: after } = occupyOpenCountry(world, 1);
    expect(after.map.provinces.find((province) => province.id === provinceId)?.controllerPolityId).toBe("rome");
  });

  it("gives an ally's ground won back from the enemy back to the ally, but takes what the ally cedes (M14)", () => {
    const { world } = levyInMessapia();
    // A Bruttian district the Campanians hold, freed by Rome: the Bruttians', not Rome's.
    const lost = { controllerPolityId: "rhegium-campanians", ownerPolityId: "bruttians" };
    expect(takenBy(lost, "rome", world.polityAgreements)).toEqual({ controllerPolityId: "bruttians", ownerPolityId: null });
    // A Bruttian district the Bruttians hold and give up to Rome changes hands.
    expect(takenBy({ controllerPolityId: "bruttians", ownerPolityId: null }, "rome", world.polityAgreements)).toEqual({ controllerPolityId: "rome", ownerPolityId: null });
  });

  it("takes for itself what it takes in a war of its own", () => {
    const { world } = levyInMessapia();
    const ownWar = { ...world, polityAgreements: world.polityAgreements.filter((agreement) => agreement.id !== "war-rome-messapians") };
    expect(takerFor(ownWar.polityAgreements, "picentes", "messapians")).toBe("picentes");
  });
});
