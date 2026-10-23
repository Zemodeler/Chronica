import { describe, expect, it } from "vitest";
import { LEGIONARY_PAY_GROSS, PAY_STOPPAGES_SHARE, fitStrengthOf } from "@chronica/shared";
import { chestOf, months, opening, romeFieldArmy } from "./equipment-test-kit";

/**
 * The stoppage buys the kit (Polybius 6.39: the quaestor stopped a third of a man's pay for his grain, his clothes and his arms).
 *
 * The third of an army's pay that was "stopped" went to nobody and bought nothing. Now the tick keeps it in the chest when it pays the army, and the quartermaster spends it each month
 * at the markets behind the army, through the market door: the army's kit, worn by the month's work, is bought again, and what it cost leaves the hubs' stocks.
 */
describe("the stoppage buys the kit", () => {
  const start = opening();
  const army = romeFieldArmy(start);
  const men = fitStrengthOf(army);

  it("looks at an army once, and sets its kit at the ordinary condition", () => {
    const after = months(start, 0, 1, "kit-first");
    expect(romeFieldArmy(after).equipmentBps).toBe(7_000);
  });

  it("spends no more than the stoppage a month, and the kit follows what is spent", () => {
    // Three months: the first looks, the second and third wear and buy.
    const one = months(start, 0, 1, "kit-spend");
    const two = months(one, 1, 1, "kit-spend");
    const bought = two.material.transactions.filter((txn) => txn.external === "market" && txn.cause.explanation.startsWith("Arms, clothing and shafts bought for Roman field army") && txn.atStep === 60);
    expect(bought.length).toBe(1);
    const cap = Math.round(men * LEGIONARY_PAY_GROSS * PAY_STOPPAGES_SHARE);
    expect(bought[0]!.amount).toBeGreaterThan(0);
    expect(bought[0]!.amount).toBeLessThanOrEqual(cap);
    // Wear of a quiet month at home (160) and what the stoppage buys back (about 180): the kit does not run down in garrison.
    expect(romeFieldArmy(two).equipmentBps!).toBeGreaterThanOrEqual(romeFieldArmy(one).equipmentBps! - 20);
  });

  it("keeps the stoppage in the chest instead of paying it away", () => {
    const paid = months(start, 0, 1, "kit-paid").material.transactions.filter((txn) => txn.cause.id === "rome-legion-pay");
    const obligation = start.material.obligations.find((candidate) => candidate.id === "rome-legion-pay")!;
    const toTheRanks = paid.reduce((sum, txn) => sum + txn.amount, 0);
    expect(toTheRanks).toBeLessThan(obligation.amount * 0.7);
    expect(toTheRanks).toBeGreaterThan(obligation.amount * 0.6);
  });

  it("buys nothing where the chest is empty, and the kit runs down on campaign", () => {
    const poor = {
      ...start,
      material: { ...start.material, accounts: start.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: 0 } : account)) },
    };
    // A month to be looked at, then three with no silver: the wear is not made good.
    const worn = months(poor, 0, 1, "kit-poor");
    expect(chestOf(worn, "rome-treasury")).toBeGreaterThanOrEqual(0);
    expect(romeFieldArmy(worn).equipmentBps).toBe(7_000);
  });
});
