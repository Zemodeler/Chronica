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
  readonly purposeKind?: MoneyReservation["purposeKind"];
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
    purposeKind: input.purposeKind ?? "project",
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

/** Payments causally attached to this order part, including immediate contracts. */
export function spentForOrderPart(world: import("./world-state").WorldState, part: import("./orders").OrderPart): number {
  const record = world.orders.find((order) => order.parts.includes(part));
  const index = record?.parts.indexOf(part) ?? -1;
  const source = record === undefined ? null : `${record.id}-p${index}`;
  // And what that work pays by the month: a hire's wages are paid by the tick
  // against its obligation, never against the contract, so an order that hired
  // a shipmaster read "0 spent" while its purse emptied (E3).
  const wages = part.workRefs.flatMap((ref) => ref.kind !== "contract" ? [] : [world.material.contracts.find((contract) => contract.id === ref.id)?.obligationId ?? null])
    .filter((id): id is string => id !== null);
  const owed = source === null ? [] : world.material.obligations.filter((obligation) => obligation.sourceActionId === source).map((obligation) => obligation.id);
  const causes = new Set([...part.workRefs.map((ref) => ref.id), ...wages, ...owed]);
  // A bare payment names no work: the part's own "paid" goal is what ties it.
  const paidTo = new Set(part.goals.flatMap((goal) => goal.kind === "paid" ? [goal.toAccountId] : []));
  const since = record?.givenAtStep ?? 0;
  return world.material.transactions.filter((transaction) => transaction.sourceAccountId === part.spend?.payerAccountId
    && ((source !== null && transaction.sourceActionId === source) || (transaction.sourceActionId == null && causes.has(transaction.cause.id))
      || (transaction.sourceActionId == null && transaction.atStep >= since && transaction.destinationAccountId != null && paidTo.has(transaction.destinationAccountId))))
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

/** The same funding test used by project payments and the active-work reader. */
export function projectFundingAvailable(world: import("./world-state").WorldState, project: import("./project").Project): number {
  const accountId = project.fundingAccountId ?? world.material.accounts.find((account) => account.owner.kind === project.sponsorEntityRef.kind && account.owner.id === project.sponsorEntityRef.id)?.id;
  if (accountId === undefined) return 0;
  const reservation = world.material.reservations.find((candidate) => candidate.id === project.reservationId && candidate.status === "active" && candidate.accountId === accountId);
  return availableBalance(world.material, accountId) + (reservation?.remainingAmount ?? 0);
}
