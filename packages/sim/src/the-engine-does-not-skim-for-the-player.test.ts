import { describe, expect, it } from "vitest";
import { DepartmentSchema, type Character, type WorldState } from "@chronica/shared";
import { opening, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { keepDepartments } from "./departments";

/**
 * A greedy quaestor who held a charge found his purse fat with money he never
 * ordered moved ("monthly diversion"), and was condemned for it. The engine
 * robs the state for the men it plays, never for the man the player is.
 */

function aTreasuryWithATreasurer(): { taxed: WorldState; before: WorldState } {
  const opened = withIncome(withChest(withWar(opening(), "syracuse", "carthage"), "syracuse", 1_000, 60_000), "syracuse", 0.1);
  const hieron = opened.characters.find((character) => character.id === "hieron-ii")!;
  const dion: Character = {
    ...hieron, id: "dion-treasurer", name: "Dion", officeId: null, personalAccountId: "dion-purse", relations: [], traits: [],
    mind: { ...hieron.mind, temperament: { ...hieron.mind.temperament, honesty: 10 }, drives: { ...hieron.mind.drives, wealth: 95, duty: 10 } },
  };
  const treasury = opened.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "syracuse")!;
  const world: WorldState = {
    ...opened,
    characters: [...opened.characters, dion],
    departments: [DepartmentSchema.parse({ id: "syr-treasury", scope: { kind: "polity", id: "syracuse" }, name: "The Royal Treasury", levers: ["tax_roll"], officeIds: ["syr-treasurer"], foundedAtStep: 0, formsAtStep: 0, origin: "order", countedAtStep: 0 })],
    material: {
      ...opened.material,
      accounts: [...opened.material.accounts, { ...treasury, id: "dion-purse", owner: { kind: "character" as const, id: "dion-treasurer" }, balance: 0 }],
      officeSeats: [...opened.material.officeSeats, { ...opened.material.officeSeats[0]!, id: "syr-treasurer-seat", officeId: "syr-treasurer", holderCharacterId: "dion-treasurer", status: "held" as const }],
    },
  };
  const taxed: WorldState = {
    ...world,
    material: { ...world.material, transactions: [...world.material.transactions, { id: "tax-1", atStep: 150, kind: "tax" as const, amount: 30_000, destinationAccountId: treasury.id, cause: { kind: "scheduled_income" as const, id: "syracuse-tax", explanation: "Tax" }, visibility: "polity" as const }] },
  };
  return { taxed, before: world };
}
const purse = (world: WorldState) => world.material.accounts.find((account) => account.id === "dion-purse")!.balance;

describe("the engine and the player's purse", () => {
  it("skims for a greedy treasurer the rules play, so that an audit has something to find", () => {
    const { taxed, before } = aTreasuryWithATreasurer();
    const kept = keepDepartments(taxed, 150, before);
    expect(purse(kept.world)).toBeGreaterThan(0);
    expect(kept.world.diversions).toMatchObject([{ byCharacterId: "dion-treasurer", foundAtStep: null }]);
  });

  it("does not skim for the man the player is, who holds the same charge and is as greedy", () => {
    const { taxed, before } = aTreasuryWithATreasurer();
    const kept = keepDepartments(taxed, 150, before, new Set(["dion-treasurer"]));
    expect(purse(kept.world)).toBe(0);
    expect(kept.world.diversions).toEqual([]);
  });
});
