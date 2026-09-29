import {
  astronomicalYearOf,
  calendarDateOf,
  calendarYearOf,
  dayOfCalendarDate,
  type ScenarioClock,
  type WorldInstant,
  type WorldState,
} from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";

/**
 * The entries nobody writes: the books, struck at the turn of the year.
 *
 * Two things follow from this being here rather than in the historian's prompt.
 *
 * The first is that the Chronicle stops depending on the player. Every entry
 * used to exist because an order had been given and a burst had ended; a world
 * where a year could pass without the ruler hearing that a year had passed is
 * not a world with a calendar in it. A fiscal close happens because the
 * calendar turned, which is the smallest honest instance of the record writing
 * itself.
 *
 * The second is that it costs nothing and says nothing untrue. A balance sheet
 * put through a historian comes back as "the treasury remained in good order",
 * which is both prose and a lie about precision. So a recorded entry has no
 * narrator at all: it is `label: value` lines, rendered as a table, and its
 * accuracy is arithmetic rather than judgment.
 *
 * The arithmetic is deliberately closed from the end that is certainly right.
 * The closing balance is what the accounts actually hold; receipts and payments
 * are what the ledger shows moving across the year's boundary; the opening
 * balance is derived from those three. The transaction log is trimmed to its
 * last five hundred entries, so a very busy year can under-report its flows --
 * deriving the opening balance rather than storing it keeps the statement
 * internally consistent when that happens.
 */

/** A year with nothing in the books produces no entry: an empty table is not news. */
const MINIMUM_FLOW = 1;

/** However long a burst ran, this many years close in one report. */
const MAX_YEARS = 3;

export interface LedgerInput {
  readonly world: WorldState;
  readonly clock: ScenarioClock;
  readonly from: WorldInstant;
  readonly to: WorldInstant;
  /** Whose books. Null -- a player with no government -- has none to close. */
  readonly polityId: string | null;
}

const sortKeyOf = (instant: WorldInstant): number => instant.day * 1440 + instant.minute;

/**
 * One entry per year that ended while the world was moving.
 *
 * Empty in the ordinary case: a burst of a few weeks crosses no new year, and
 * the overwhelming majority of reports carry no ledger at all.
 */
/**
 * What a transaction kind is called in a book somebody reads.
 *
 * The year-end statement printed the engine's own enum -- "tax", "upkeep",
 * "transfer" -- in lowercase, in the middle of a Chronicle entry whose other
 * lines are written prose. An unlabelled kind still falls through to itself
 * with its underscores opened out, so a kind added later reads badly rather
 * than breaking, and this list is the only thing that needs extending.
 */
const MONEY_KIND_WORDS: Readonly<Record<string, string>> = {
  income: "Rents and revenues",
  tax: "Taxes",
  purchase: "Purchases",
  transfer: "Payments made",
  upkeep: "Upkeep of forces",
  spoils: "Spoils of war",
  ransom: "Ransoms",
  confiscation: "Confiscations",
  inheritance: "Inheritances",
};

export function closeTheBooks(input: LedgerInput): ChronicleEntry[] {
  if (input.polityId === null) return [];
  const polity = input.world.map.polities.find((candidate) => candidate.id === input.polityId);
  if (polity === undefined) return [];

  const startYear = astronomicalYearOf(calendarDateOf(input.from, input.clock));
  const endYear = astronomicalYearOf(calendarDateOf(input.to, input.clock));
  if (endYear <= startYear) return [];

  const accountIds = new Set(
    input.world.material.accounts
      .filter((account) => account.owner.kind === "polity" && account.owner.id === input.polityId)
      .map((account) => account.id),
  );
  if (accountIds.size === 0) return [];

  const closing = input.world.material.accounts
    .filter((account) => accountIds.has(account.id))
    .reduce((sum, account) => sum + account.balance, 0);

  const currency = input.world.material.currency.name;
  const firstDayOf = (astronomical: number): number => {
    const { year, era } = calendarYearOf(astronomical);
    return dayOfCalendarDate({ year, month: 1, day: 1, era }, input.clock);
  };

  // Newest year last, so the report reads forward; and a burst that somehow
  // spanned a decade closes the three most recent books rather than ten.
  const years = [];
  for (let astronomical = startYear; astronomical < endYear; astronomical += 1) years.push(astronomical);
  const closed = years.slice(-MAX_YEARS);

  // Walked backwards from the balance that is certainly right: each earlier
  // year's closing balance is the next year's opening one.
  const statements: { astronomical: number; opening: number; closing: number; receipts: Map<string, number>; payments: Map<string, number> }[] = [];
  let runningClose = closing;
  for (const astronomical of [...closed].reverse()) {
    const firstDay = firstDayOf(astronomical);
    const lastDay = firstDayOf(astronomical + 1) - 1;
    const receipts = new Map<string, number>();
    const payments = new Map<string, number>();
    for (const transaction of input.world.material.transactions) {
      if (transaction.atStep < firstDay || transaction.atStep > lastDay) continue;
      const into = transaction.destinationAccountId !== undefined && accountIds.has(transaction.destinationAccountId);
      const outOf = transaction.sourceAccountId !== undefined && accountIds.has(transaction.sourceAccountId);
      // Money moved between two of its own accounts is not income or spending.
      if (into === outOf) continue;
      const book = into ? receipts : payments;
      book.set(transaction.kind, (book.get(transaction.kind) ?? 0) + transaction.amount);
    }
    const received = [...receipts.values()].reduce((sum, amount) => sum + amount, 0);
    const paid = [...payments.values()].reduce((sum, amount) => sum + amount, 0);
    const opening = runningClose - received + paid;
    statements.unshift({ astronomical, opening, closing: runningClose, receipts, payments });
    runningClose = opening;
  }

  return statements.flatMap((statement) => {
    const received = [...statement.receipts.values()].reduce((sum, amount) => sum + amount, 0);
    const paid = [...statement.payments.values()].reduce((sum, amount) => sum + amount, 0);
    if (received < MINIMUM_FLOW && paid < MINIMUM_FLOW) return [];

    const { year, era } = calendarYearOf(statement.astronomical);
    const yearName = `${year} ${era === "BCE" ? "BC" : "AD"}`;
    const line = (label: string, amount: number): string => `${label}: ${amount} ${currency}`;
    const breakdown = (book: Map<string, number>): string[] =>
      [...book.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([kind, amount]) => line(`  ${MONEY_KIND_WORDS[kind] ?? kind.replace(/_/g, " ")}`, amount));

    const firstDay = firstDayOf(statement.astronomical);
    const lastDay = firstDayOf(statement.astronomical + 1) - 1;
    return [{
      kind: "recorded" as const,
      title: `${polity.name} Treasury Account for ${yearName}`,
      body: [
        line("Treasury at the opening of the year", statement.opening),
        line("Received", received),
        ...breakdown(statement.receipts),
        line("Paid out", paid),
        ...breakdown(statement.payments),
        line("Treasury at the close of the year", statement.closing),
      ].join("\n"),
      factIds: [],
      subjects: [{ kind: "polity" as const, id: polity.id }],
      tags: [{ kind: "polity" as const, id: polity.id, label: polity.name }],
      changes: [],
      quote: null,
      fromInstantSortKey: sortKeyOf({ day: firstDay, minute: 0 }),
      toInstantSortKey: sortKeyOf({ day: lastDay, minute: 1_439 }),
    }];
  });
}
