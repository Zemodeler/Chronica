import { describe, expect, it } from "vitest";
import { fitStrengthOf, WorldStateSchema } from "@chronica/shared";
import { PUNIC_IDS } from "./punic-ids";
import { punicWarsScenario } from "./punic-wars-scenario";

/**
 * Carthage holds western Sicily (playtest fix batch 2; docs/plans/scenario-notes-batch2.md).
 *
 * The opening kept every Carthaginian soldier at Carthage and only a fleet at Lilybaeum, so no Roman army could meet one in Sicily and the war could not be fought there.
 * Now a strategos' army stands at Lilybaeum and a garrison in Panormus and Agrigentum; the consular army is drawn at Polybius' strength.
 */
const world = punicWarsScenario.initialWorld;
const force = (id: string) => world.material.forces.find((candidate) => candidate.id === id);
const man = (id: string) => world.characters.find((candidate) => candidate.id === id);

describe("Carthage holds western Sicily", () => {
  it("has an army under a strategos at Lilybaeum and garrisons in the two other towns it holds", () => {
    expect(force("carthaginian-sicilian-army")).toMatchObject({ polityId: "carthage", locationId: PUNIC_IDS.lilybaeum, commanderCharacterId: "hasdrubal-son-of-hanno" });
    expect(force("carthaginian-garrison-panormus")).toMatchObject({ polityId: "carthage", locationId: PUNIC_IDS.panormus });
    expect(force("carthaginian-garrison-agrigentum")).toMatchObject({ polityId: "carthage", locationId: PUNIC_IDS.agrigentum });
    const inSicily = world.material.forces.filter((candidate) => candidate.polityId === "carthage" && world.map.provinces.find((province) => province.id === candidate.locationId)?.id.startsWith("sic-") && !candidate.personnel.every((row) => row.categoryId === "warship"));
    expect(inSicily.reduce((sum, candidate) => sum + fitStrengthOf(candidate), 0)).toBeGreaterThanOrEqual(4_000);
    // The towns are Carthage's own, so the garrisons hold what is theirs.
    for (const id of ["carthaginian-garrison-panormus", "carthaginian-garrison-agrigentum", "carthaginian-sicilian-army"]) {
      expect(world.map.provinces.find((province) => province.id === force(id)!.locationId)?.controllerPolityId).toBe("carthage");
    }
  });

  it("has officers who are Carthaginians, alive, with purses, and the men are paid out of Carthage's chest", () => {
    for (const id of ["hasdrubal-son-of-hanno", "carthalo-panormus", "bodmelqart-agrigentum"]) {
      expect(man(id)).toMatchObject({ polityId: "carthage", alive: true });
      expect(world.material.accounts.some((account) => account.id === `${id}-purse`)).toBe(true);
    }
    const pay = world.material.obligations.find((obligation) => obligation.id === "carthage-sicilian-hired-men")!;
    expect(pay).toMatchObject({ payerAccountId: "carthage-treasury", kind: "army_upkeep", active: true });
    for (const id of ["carthaginian-sicilian-army", "carthaginian-garrison-panormus", "carthaginian-garrison-agrigentum"]) expect(force(id)!.payObligationId).toBe(pay.id);
    expect(WorldStateSchema.safeParse(world).success).toBe(true);
  });

  it("keeps the field force at Carthage and the fleet at Lilybaeum", () => {
    expect(force("carthaginian-garrison")?.locationId).toBe(PUNIC_IDS.carthage);
    expect(force("carthaginian-fleet")?.locationId).toBe(PUNIC_IDS.lilybaeum);
  });

  it("draws the consular army at Polybius' strength: two legions and two alae", () => {
    const army = force("roman-field-army")!;
    expect(fitStrengthOf(army)).toBeGreaterThanOrEqual(17_000);
    expect(fitStrengthOf(army)).toBeLessThanOrEqual(19_200);
    expect(army.formations!.filter((formation) => formation.bodyLabel.startsWith("Legio")).map((formation) => formation.bodyLabel)).toEqual(expect.arrayContaining(["Legio I", "Legio II"]));
    expect(world.material.obligations.find((obligation) => obligation.id === army.payObligationId)!.amount).toBe(130_000);
  });
});
