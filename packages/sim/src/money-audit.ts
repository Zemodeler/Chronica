import { EXTERNAL_MONEY_KINDS, type ExternalMoneyKind, type MoneyTransaction, type WorldState } from "@chronica/shared";

/**
 * Where the world's money came from and went to.
 *
 * Money was minted by every income source (taxes, rents, tribute credited a
 * treasury and debited nobody), by a banker the world never named, by a cargo
 * sold for more than it cost, and destroyed by every payroll that reached no
 * purse; and the books said nothing, because nothing asked. A world's money
 * is now conserved except at a short list of doors in and out, each a real
 * thing outside the accounts the model keeps (`EXTERNAL_MONEY_KINDS`):
 *
 *  - `harvest`: the land and its people, who are taxed, rented and tithed and
 *    keep no purse of their own;
 *  - `market`: what a merchant's cargo fetches and a ship is fitted out for,
 *    what a harbour and a work earn, and what is bought of the world at large;
 *  - `plunder`: a sacked town;
 *  - `credit`: a banker the world does not name, and what is repaid him;
 *  - `the_unnamed`: wages to the men nobody names, and what such a man brings
 *    when he takes service;
 *  - `bread`: bought from the country at large;
 *  - `abroad`: money an order sends outside the world's accounts, or a
 *    subsidy from a power with no chest of its own;
 *  - `endowment`: what a man arrives in the world with.
 *
 * Every other change in a balance -- a creation or a destruction with no line
 * to say so, a one-sided line that names no door -- is unexplained, and the
 * audit lists it. `the-books-balance.test.ts` fails on any.
 */

/** One door's traffic: what came in through it and what went out. */
export interface Door {
  readonly in: number;
  readonly out: number;
}

export interface Unexplained {
  /** `untagged`: a line with one end and no door named. `unrecorded`: a balance that moved with no line to say why. */
  readonly kind: "untagged" | "unrecorded";
  readonly accountId: string | null;
  /** Positive: money created. Negative: money destroyed. */
  readonly amount: number;
  readonly note: string;
}

export interface MoneyAudit {
  /** What moved between two accounts: neither made nor lost. */
  readonly internal: number;
  readonly doors: Readonly<Record<ExternalMoneyKind, Door>>;
  readonly unexplained: readonly Unexplained[];
}

const emptyDoors = (): Record<ExternalMoneyKind, Door> =>
  Object.fromEntries(EXTERNAL_MONEY_KINDS.map((kind) => [kind, { in: 0, out: 0 }])) as Record<ExternalMoneyKind, Door>;

/**
 * The door a one-sided line goes through, if it names one or plainly means one:
 * a payment to nobody is what was bought of the world at large, and plunder is
 * plunder. Anything else must say.
 */
function doorOf(transaction: MoneyTransaction): ExternalMoneyKind | null {
  if (transaction.external !== undefined) return transaction.external;
  if (transaction.sourceAccountId !== undefined && transaction.kind === "purchase") return "market";
  if (transaction.destinationAccountId !== undefined && transaction.kind === "spoils") return "plunder";
  return null;
}

/**
 * Audits the money that moved between two states of a world.
 *
 * The lines written since `before` (those whose ids it did not hold) are
 * sorted into what passed between two accounts and what passed through a door;
 * each account's change in balance is then checked against its own lines, and
 * whatever the lines do not account for is unexplained. An account opened in
 * the span begins with the means its owner arrived with -- an endowment.
 */
export function auditMoney(before: WorldState, after: WorldState): MoneyAudit {
  const doors = emptyDoors();
  const unexplained: Unexplained[] = [];
  const known = new Set(before.material.transactions.map((transaction) => transaction.id));
  const expected = new Map<string, number>();
  let internal = 0;
  for (const transaction of after.material.transactions) {
    if (known.has(transaction.id)) continue;
    if (transaction.sourceAccountId !== undefined) expected.set(transaction.sourceAccountId, (expected.get(transaction.sourceAccountId) ?? 0) - transaction.amount);
    if (transaction.destinationAccountId !== undefined) expected.set(transaction.destinationAccountId, (expected.get(transaction.destinationAccountId) ?? 0) + transaction.amount);
    if (transaction.sourceAccountId !== undefined && transaction.destinationAccountId !== undefined) {
      internal += transaction.amount;
      continue;
    }
    const door = doorOf(transaction);
    if (door === null) {
      unexplained.push({
        kind: "untagged",
        accountId: transaction.destinationAccountId ?? transaction.sourceAccountId ?? null,
        amount: transaction.destinationAccountId !== undefined ? transaction.amount : -transaction.amount,
        note: `${transaction.kind}: ${transaction.cause.explanation}`.slice(0, 120),
      });
      continue;
    }
    if (transaction.destinationAccountId !== undefined) doors[door] = { ...doors[door], in: doors[door].in + transaction.amount };
    else doors[door] = { ...doors[door], out: doors[door].out + transaction.amount };
  }

  const earlier = new Map(before.material.accounts.map((account) => [account.id, account.balance]));
  const seen = new Set<string>();
  for (const account of after.material.accounts) {
    seen.add(account.id);
    const was = earlier.get(account.id);
    const lines = expected.get(account.id) ?? 0;
    if (was === undefined) {
      // Opened in the span: whatever it was opened with, less the lines that
      // paid into it, came with its owner.
      const brought = account.balance - lines;
      if (brought > 0) doors.endowment = { ...doors.endowment, in: doors.endowment.in + brought };
      else if (brought < 0) unexplained.push({ kind: "unrecorded", accountId: account.id, amount: brought, note: "a new account holds less than was paid into it" });
      continue;
    }
    const gap = account.balance - was - lines;
    if (gap !== 0) unexplained.push({ kind: "unrecorded", accountId: account.id, amount: gap, note: gap > 0 ? "balance rose with no line to say why" : "balance fell with no line to say why" });
  }
  for (const [id, was] of earlier) {
    // An account struck off must have been emptied by lines (a disbanded chest handed to a treasury): what its lines do not account for is unexplained.
    const left = was + (expected.get(id) ?? 0);
    if (!seen.has(id) && left !== 0) unexplained.push({ kind: "unrecorded", accountId: id, amount: -left, note: "an account holding money was removed" });
  }
  return { internal, doors, unexplained };
}

/** Two audits as one, for adding up a run of ticks. */
export function combineAudits(a: MoneyAudit, b: MoneyAudit): MoneyAudit {
  const doors = emptyDoors();
  for (const kind of EXTERNAL_MONEY_KINDS) doors[kind] = { in: a.doors[kind].in + b.doors[kind].in, out: a.doors[kind].out + b.doors[kind].out };
  return { internal: a.internal + b.internal, doors, unexplained: [...a.unexplained, ...b.unexplained] };
}

export const emptyAudit = (): MoneyAudit => ({ internal: 0, doors: emptyDoors(), unexplained: [] });

/** All the money created (positive) or destroyed (negative) with no explanation. */
export const unexplainedTotal = (audit: MoneyAudit): number => audit.unexplained.reduce((sum, entry) => sum + entry.amount, 0);

/** The audit in words: each door's traffic, and whatever could not be explained. */
export function auditInWords(audit: MoneyAudit): string {
  const lines = EXTERNAL_MONEY_KINDS
    .filter((kind) => audit.doors[kind].in > 0 || audit.doors[kind].out > 0)
    .map((kind) => `${kind}: +${audit.doors[kind].in} / -${audit.doors[kind].out}`);
  const odd = audit.unexplained.map((entry) => `${entry.kind} ${entry.amount > 0 ? "+" : ""}${entry.amount} ${entry.accountId ?? "?"}: ${entry.note}`);
  return [`internal ${audit.internal}`, ...lines, ...(odd.length === 0 ? ["nothing unexplained"] : ["UNEXPLAINED", ...odd])].join("\n");
}
