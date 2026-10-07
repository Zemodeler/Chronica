import { ECONOMIC_LEVER_REACH, economyOf, leverFactor, readDepartments, treasuryOf, type MoneyTransaction, type WorldState } from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Customs paid into a treasury (phase D of the economy rework).
 *
 * The month's trade flows (`trade-flows.ts`) work out what each power's customs
 * come to on the goods that entered its markets from other powers' (and its
 * portoria on goods that passed through a province taxed by customs): a share of
 * their value as they landed. The duty is part of what the merchant paid to
 * land the goods, which is why a heavy tariff shrinks the trade it is levied
 * on; it is not a tax on anybody the books keep an account for.
 *
 * So the money is booked as it is: a merchant's payment, which is the `market`
 * door (what a cargo fetches, what a harbour earns) and not a transfer between
 * two accounts. The merchants' own margin is outside the accounts, and the duty
 * is a share of it, so no money appears that the trade did not pay; the money
 * audit counts it at the door and nowhere else. The flows accrue it in the
 * economy's memory and the tick pays it out the day it is reckoned; a world
 * stepped without the tick (the tests' bare months) holds it there, where a
 * test can read what a tariff earned.
 *
 * What reaches the chest is what the collectors of the customs can gather
 * (the `customs` charge): a well-run harbour loses little to the men who land goods at night
 * and to the clerks who look away, a badly run one a fifth of it. A power with nobody given
 * the charge has it run by its ruler, as every charge is.
 */
export function payCustoms(world: WorldState, atStep: number, ids: IdFactory): WorldState {
  const memory = economyOf(world);
  if (memory.customsDue.length === 0) return world;
  const paid: MoneyTransaction[] = [];
  const credited = new Map<string, number>();
  const kept: typeof memory.customsDue = [];
  const reader = readDepartments(world);
  for (const due of memory.customsDue) {
    const treasury = treasuryOf(world, due.polityId);
    // A power with no chest of its own has nobody to pay it to: its customs are let go.
    if (treasury === null || due.amount <= 0) continue;
    // What slips past the collectors, or is gathered that a lax harbour would have lost.
    const gathered = Math.max(0, Math.round(due.amount * leverFactor(reader, due.polityId, "customs", ECONOMIC_LEVER_REACH.customs)));
    if (gathered <= 0) continue;
    credited.set(treasury, gathered);
    paid.push({
      id: ids.next("txn"),
      atStep,
      kind: "income",
      amount: gathered,
      external: "market",
      destinationAccountId: treasury,
      cause: { kind: "scheduled_income", id: `customs_${due.polityId}`.slice(0, 60), explanation: "Customs on the month's trade" },
      visibility: "polity",
    });
  }
  if (paid.length === 0) return { ...world, economy: { ...memory, customsDue: kept } };
  return {
    ...world,
    economy: { ...memory, customsDue: kept },
    material: {
      ...world.material,
      accounts: world.material.accounts.map((account) => (credited.has(account.id) ? { ...account, balance: account.balance + credited.get(account.id)! } : account)),
      transactions: [...world.material.transactions, ...paid].slice(-512),
    },
  };
}
