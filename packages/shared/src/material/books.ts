import { buildStation, seesAccount, type Station } from "../authority/station";
import type { Office } from "../characters/character";
import type { WorldState } from "../world/world-state";
import { accountLabel } from "./account-names";

/**
 * The books, as the person holding them can read them (VISION §7).
 *
 * §7 opens with a worked example of exactly this -- taxes, trade, tribute and
 * estates on one side, army, navy, administration, debt service and projects
 * on the other, and the surplus at the foot -- and says that once established,
 * ordinary accounting is deterministic and no model should be asked to do it.
 * The engine has computed all of it since the economy was built and never
 * showed the player any of it: the whole of the web client was a map, a
 * Council, a Chronicle and a character sheet, and a ruler who wanted to know
 * whether he could afford a war had to infer it from his balance.
 *
 * Station-filtered like everything else, and for the same reason: a merchant
 * reads his own books, a consul reads the government's. It is the same
 * `seesAccount` the world slice uses, so what the player is shown and what
 * the model is told can never drift apart.
 */

export type LedgerSide = "income" | "expenditure";

export interface LedgerLine {
  readonly key: string;
  /** What a reader would call this: "Taxes", "Army pay". */
  readonly label: string;
  /** Rounded to the month, which is the unit §7 is written in. */
  readonly monthly: number;
  /** What is behind the number, most significant first. */
  readonly detail: readonly { readonly label: string; readonly monthly: number }[];
}

export interface Books {
  readonly income: readonly LedgerLine[];
  readonly expenditure: readonly LedgerLine[];
  readonly totalIncome: number;
  readonly totalExpenditure: number;
  readonly surplus: number;
  /** What is owed and has not been paid. A surplus on paper with arrears under it is not a surplus. */
  readonly arrears: number;
  /** Everything they can actually open, with its balance. */
  readonly accounts: readonly { readonly id: string; readonly label: string; readonly balance: number }[];
  /** True when these are a government's books rather than one man's purse. */
  readonly theirGovernments: boolean;
}

/** §7's own categories, which the engine's kinds already very nearly are. */
const INCOME_LABELS: Readonly<Record<string, string>> = {
  tax: "Taxes", trade: "Trade", tribute: "Tribute", land: "Estates and land", office: "Offices", pension: "Pensions received",
};
const EXPENSE_LABELS: Readonly<Record<string, string>> = {
  army_pay: "Army pay", army_upkeep: "Army upkeep", salary: "Administration",
  tribute: "Tribute", pension: "Pensions", debt_service: "Debt service",
};

/** A cadence stated in days, said per month, which is the unit §7 is written in. */
export const perMonth = (amount: number, cadenceSteps: number): number => (cadenceSteps <= 0 ? 0 : (amount / cadenceSteps) * 30);

function fold(
  entries: readonly { readonly kind: string; readonly label: string; readonly monthly: number }[],
  labels: Readonly<Record<string, string>>,
): LedgerLine[] {
  const byKind = new Map<string, { label: string; monthly: number; detail: { label: string; monthly: number }[] }>();
  for (const entry of entries) {
    if (entry.monthly <= 0) continue;
    const held = byKind.get(entry.kind) ?? { label: labels[entry.kind] ?? entry.kind, monthly: 0, detail: [] };
    held.monthly += entry.monthly;
    held.detail.push({ label: entry.label, monthly: Math.round(entry.monthly) });
    byKind.set(entry.kind, held);
  }
  return [...byKind]
    .map(([key, line]) => ({
      key,
      label: line.label,
      monthly: Math.round(line.monthly),
      detail: line.detail.sort((a, b) => b.monthly - a.monthly || a.label.localeCompare(b.label)).slice(0, 8),
    }))
    .filter((line) => line.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly || a.key.localeCompare(b.key));
}

export function readTheBooks(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
): Books {
  const station: Station | null = characterId === null ? null : buildStation({ world, characterId, offices });
  const reaches = (accountId: string): boolean => station === null || seesAccount(station, accountId);
  const polityId = characterId === null ? null : world.characters.find((character) => character.id === characterId)?.polityId ?? null;

  const open = world.material.accounts
    .filter((account) => reaches(account.id))
    .filter((account) => account.owner.kind !== "polity" || account.owner.id === polityId || polityId === null)
    .sort((a, b) => b.balance - a.balance);
  const accounts = open.map((account) => ({ id: account.id, label: accountLabel(world, account), balance: account.balance }));
  const readable = new Set(accounts.map((account) => account.id));

  const income = fold(
    world.material.incomeSources
      .filter((source) => source.active && readable.has(source.beneficiaryAccountId))
      .map((source) => ({
        kind: source.kind,
        label: source.label,
        // What actually arrives, not what is levied: a tax collected at three
        // quarters is three quarters of an income.
        monthly: perMonth(source.amount, source.cadenceSteps) * (source.collectionRateBps / 10_000),
      })),
    INCOME_LABELS,
  );

  const owed = world.material.obligations.filter((obligation) => obligation.active && readable.has(obligation.payerAccountId));
  const expenditure = fold(
    owed.map((obligation) => ({ kind: obligation.kind, label: obligation.label, monthly: perMonth(obligation.amount, obligation.cadenceSteps) })),
    EXPENSE_LABELS,
  );

  const totalIncome = income.reduce((sum, line) => sum + line.monthly, 0);
  const totalExpenditure = expenditure.reduce((sum, line) => sum + line.monthly, 0);

  return {
    income,
    expenditure,
    totalIncome,
    totalExpenditure,
    surplus: totalIncome - totalExpenditure,
    arrears: owed.reduce((sum, obligation) => sum + obligation.arrears, 0),
    accounts,
    theirGovernments: open.some((account) => account.owner.kind === "polity"),
  };
}
