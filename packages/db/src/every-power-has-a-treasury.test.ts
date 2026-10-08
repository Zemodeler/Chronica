import { describe, expect, it } from "vitest";
import { inferredGovernmentForm, type WorldState } from "@chronica/shared";
import { punicWarsScenario } from "./punic-wars-scenario";
import { EGYPT_MONTHLY_REVENUE, NO_CHEST_BY_DESIGN, STANDING_TAX_CEILING, STANDING_TAX_FLOOR, powersWithoutAChest } from "./punic-wars-treasuries";

/**
 * Egypt has a chest. A king's repayment of a loan, a tribute paid to the Ptolemies and a dole out of Alexandria went to no account at all, because only twelve powers
 * kept a treasury in the data. Every power that is a state by its form now keeps one, with a standing tax of its own at the scale of the age; a tribal people, by its
 * form, has no standing tax or loans (docs/plans/government.md) and keeps none.
 */
const world = (): WorldState => structuredClone(punicWarsScenario.initialWorld) as WorldState;
const chests = (w: WorldState) => new Map(w.material.accounts.filter((account) => account.owner.kind === "polity").map((account) => [account.owner.id, account]));

describe("every power has a treasury", () => {
  it("leaves no state without a chest: only the tribal peoples keep none", () => {
    const w = world();
    expect(powersWithoutAChest(w)).toEqual([]);
    const held = new Set(w.map.provinces.map((province) => province.controllerPolityId).filter((id): id is string => id !== null));
    const without = w.map.polities.filter((polity) => held.has(polity.id) && !chests(w).has(polity.id));
    expect(without.length).toBeGreaterThan(0);
    // Only the tribal peoples, and the soldiers of Rhegium who live off a city they took and whom nobody pays by the scenario's own story.
    for (const polity of without) expect(NO_CHEST_BY_DESIGN.has(polity.id) || inferredGovernmentForm(polity) === "tribal_confederation", polity.id).toBe(true);
    for (const id of ["ptolemaic-egypt", "macedon", "seleucid-empire", "rhodes", "athens", "massalia", "pergamon"]) expect(chests(w).get(id)?.status, id).toBe("active");
  });

  it("opens Egypt's chest with four months of a revenue of about four thousand talents a year, the richest of the age's chests but Carthage's own", () => {
    const w = world();
    const chest = chests(w).get("ptolemaic-egypt")!;
    expect(chest.balance).toBe(4 * EGYPT_MONTHLY_REVENUE);
    const tax = w.material.incomeSources.find((source) => source.id === "ptolemaic-egypt-standing-tax")!;
    expect(tax).toMatchObject({ kind: "tax", originKind: "polity", originId: "ptolemaic-egypt", beneficiaryAccountId: chest.id, amount: 3 * EGYPT_MONTHLY_REVENUE, cadenceSteps: 90 });
    // A talent is 6,000 drachmae: 2,100,000 a month is 4,200 talents a year, well under the 14,800 Jerome gives (a late figure that counts the corn).
    const talentsAYear = (tax.amount * 4) / 6_000;
    expect(talentsAYear).toBeGreaterThan(3_000);
    expect(talentsAYear).toBeLessThan(14_800 * 0.4);
    const carthage = w.material.incomeSources.filter((source) => source.originId === "carthage" && source.originKind === "polity").reduce((sum, source) => sum + source.amount, 0);
    expect(tax.amount / 3).toBeGreaterThan(carthage);
    expect(tax.amount / 3).toBeLessThanOrEqual(STANDING_TAX_CEILING);
    // The chest has its costs, as the allies' have: four fifths of the revenue goes out, the pay of its army and its fleet first, and the state's own upkeep the rest.
    const pays = ["ptolemaic-royal-army", "ptolemaic-royal-fleet"].map((id) => w.material.obligations.find((obligation) => obligation.id === `${id}-pay`)!);
    expect(pays.every((pay) => pay.kind === "army_pay" && pay.payerAccountId === chest.id && pay.amount > 0)).toBe(true);
    for (const id of ["ptolemaic-royal-army", "ptolemaic-royal-fleet"]) expect(w.material.forces.find((force) => force.id === id)!.payObligationId).toBe(`${id}-pay`);
    const upkeep = w.material.obligations.find((obligation) => obligation.id === "ptolemaic-egypt-upkeep")!;
    expect(upkeep.payerAccountId).toBe(chest.id);
    expect(upkeep.amount / 3 + pays.reduce((sum, pay) => sum + pay.amount, 0)).toBe(Math.round(EGYPT_MONTHLY_REVENUE * 0.8));
  });

  it("gives every other state a standing tax between the floor and the ceiling, and leaves the twelve that had chests as they were", () => {
    const w = world();
    const made = w.material.incomeSources.filter((source) => source.id.endsWith("-standing-tax"));
    expect(made.length).toBeGreaterThan(40);
    for (const source of made) {
      // Reckoned a quarter at a time, each power on its own day, so the ledger's bounded lines hold a long span's books.
      expect(source.cadenceSteps).toBe(90);
      expect(source.nextDueStep).toBeGreaterThanOrEqual(30);
      expect(source.nextDueStep).toBeLessThan(90);
      expect(source.amount / 3, source.id).toBeGreaterThanOrEqual(STANDING_TAX_FLOOR);
      expect(source.amount / 3, source.id).toBeLessThanOrEqual(STANDING_TAX_CEILING);
      expect(chests(w).get(source.originId)?.balance, source.id).toBe(4 * (source.amount / 3));
    }
    expect(chests(w).get("rome")!.balance).toBe(2_790_000);
    expect(chests(w).get("carthage")!.balance).toBe(18_600_000);
    expect(made.some((source) => ["rome", "carthage", "syracuse"].includes(source.originId))).toBe(false);
  });
});
