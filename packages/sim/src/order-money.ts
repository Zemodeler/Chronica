import { availableBalance, orderPartRef, type OrderPart, type WorldState } from "@chronica/shared";
import type { MadeMoney } from "./apply/context";

/**
 * The money an order's act wrote, filed as that part's spending: every line
 * it moved, and every obligation it left standing -- whose later payments the
 * tick files the same way.
 *
 * A payment was tagged with the man who made it, a hire's wages with the
 * obligation they came from, a rule's toll with the rule: none of it with the
 * order. "Hire a shipmaster, up to 3,000" read "0 spent" while the purse
 * emptied month by month (E3).
 */
export function stampOrderMoney(world: WorldState, made: readonly (MadeMoney | undefined)[], partRef: string): WorldState {
  const lines = new Set(made.flatMap((entry) => entry?.transactionIds ?? []));
  const owed = new Set(made.flatMap((entry) => entry?.obligationIds ?? []));
  if (lines.size === 0 && owed.size === 0) return world;
  return {
    ...world,
    material: {
      ...world.material,
      transactions: lines.size === 0 ? world.material.transactions : world.material.transactions.map((transaction) =>
        lines.has(transaction.id) && transaction.sourceActionId == null ? { ...transaction, sourceActionId: partRef } : transaction),
      obligations: owed.size === 0 ? world.material.obligations : world.material.obligations.map((obligation) =>
        owed.has(obligation.id) && obligation.sourceActionId == null ? { ...obligation, sourceActionId: partRef } : obligation),
    },
  };
}

/**
 * Why nothing is set aside for a part the order allowed money to: the vote
 * has not been put or not yet carried, the purse is empty, or it has all been
 * spent. "Nothing currently set aside" said none of these.
 */
export function whyNothingSetAside(world: WorldState, part: OrderPart, partRef: string | null): string {
  const votes = part.workRefs.filter((ref) => ref.kind === "procedure").map((ref) => world.material.politicalProcedures.find((procedure) => procedure.id === ref.id));
  if (votes.some((vote) => vote !== undefined && vote.outcome === null)) return "nothing set aside until the vote is carried";
  if (votes.length > 0 && !votes.some((vote) => vote?.outcome === "passed")) return "nothing set aside: the vote did not carry";
  const held = partRef === null ? undefined : world.material.reservations.find((reservation) => reservation.purposeId === partRef);
  if (held !== undefined && held.status !== "active") return held.status === "spent" ? "all of it spent" : "what was set aside has been released";
  if (part.spend !== null && availableBalance(world.material, part.spend.payerAccountId) <= 0) return "nothing set aside: the purse it was to come from is empty";
  return "nothing currently set aside";
}

/** The part ref of a part as it stands in the world's ledger, or null for one not yet written there. */
export function refOfPart(world: WorldState, part: OrderPart): string | null {
  for (const order of world.orders) {
    const index = order.parts.indexOf(part);
    if (index >= 0) return orderPartRef(order.id, index);
  }
  return null;
}
