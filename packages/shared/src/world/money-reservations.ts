import type { MaterialWorldState, MoneyReservation } from "../material-state";

// Project fund reservations (docs/32, Part C.3): a reservation earmarks
// balance without moving it -- no `MoneyTransaction` is created when one
// opens, only when a milestone actually spends from it. The single guarantee
// this module exists for: `availableBalance` never counts money another
// project has already committed, so an ordinary spend (`transfer_gold`)
// cannot silently eat into it.

/** What an account can still spend right now: its balance, less every active reservation's remaining hold. */
export function availableBalance(material: Pick<MaterialWorldState, "accounts" | "reservations">, accountId: string): number {
  const account = material.accounts.find((a) => a.id === accountId);
  if (account === undefined) return 0;
  const held = material.reservations
    .filter((reservation) => reservation.accountId === accountId && reservation.status === "active")
    .reduce((sum, reservation) => sum + reservation.remainingAmount, 0);
  return Math.max(0, account.balance - held);
}

export interface OpenReservationInput {
  readonly id: string;
  readonly accountId: string;
  readonly currencyId: string;
  readonly amount: number;
  readonly purposeId: string;
  readonly atStep: number;
}

/** Opens a reservation, refusing to reserve more than the account can currently spend. */
export function openReservation(
  material: Pick<MaterialWorldState, "accounts" | "reservations">,
  input: OpenReservationInput,
): MoneyReservation | null {
  if (availableBalance(material, input.accountId) < input.amount) return null;
  return {
    id: input.id,
    accountId: input.accountId,
    currencyId: input.currencyId,
    reservedAmount: input.amount,
    remainingAmount: input.amount,
    purposeKind: "project",
    purposeId: input.purposeId,
    status: "active",
    createdAtStep: input.atStep,
    closedAtStep: null,
  };
}

/** Draws `amount` from an active reservation for one milestone's spend. Never draws past what remains. */
export function spendFromReservation(reservation: MoneyReservation, amount: number, atStep: number): MoneyReservation {
  if (reservation.status !== "active") throw new Error(`Only an active reservation can be spent from; "${reservation.id}" is ${reservation.status}.`);
  const remaining = Math.max(0, reservation.remainingAmount - amount);
  return remaining === 0
    ? { ...reservation, remainingAmount: 0, status: "spent", closedAtStep: atStep }
    : { ...reservation, remainingAmount: remaining };
}

/** Closes a reservation early -- an abandoned or cancelled project releases whatever it never spent. */
export function releaseMoneyReservation(reservation: MoneyReservation, atStep: number, outcome: "released" | "cancelled" = "released"): MoneyReservation {
  if (reservation.status !== "active") return reservation;
  return { ...reservation, status: outcome, closedAtStep: atStep };
}
