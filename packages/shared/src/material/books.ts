import { buildStation, holdsPolityStanding, seesAccount, type Station } from "../authority/station";
import { taxBurdens, taxBurdenInWords } from "./taxation";
import type { Office } from "../characters/character";
import type { WorldState } from "../world/world-state";
import { accountLabel } from "./account-names";
import { obligationAmountNow } from "../world/economy";
import { taxWhy, type WhyReading } from "../knowledge/why";

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
 *
 * Two sets of books, because the room has two objects for them. The strongbox
 * is what is the reader's own: the accounts in his name. The ledger stand is
 * what he keeps for somebody else: a treasury, an army's chest, a guild's
 * fund, a master's purse. A consul's private fortune and the Republic's
 * treasury were one table, added together into one surplus that belonged to
 * nobody.
 */

/** "own": accounts in the reader's name. "kept": what he can open that is somebody else's. "all": both. */
export type BooksScope = "all" | "own" | "kept";

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
  /** If nothing changes, days until what is in hand is spent. Null when it is not being spent down. */
  readonly runsOutInDays: number | null;
  /** Everything they can actually open, with its balance. */
  readonly accounts: readonly { readonly id: string; readonly label: string; readonly balance: number }[];
  /** True when these are a government's books rather than one man's purse. */
  readonly theirGovernments: boolean;
  /**
   * How hard the power's taxes press on its lands, for whoever can open its
   * treasury (product guide: "your treasury shows how hard you are pressing").
   * `hard` once order is suffering for it.
   */
  readonly pressure: { readonly inWords: string; readonly hard: boolean; readonly why: WhyReading } | null;
  /** Loans owed out of accounts they can open. */
  readonly debts: readonly DebtLine[];
  /** Payments that have fallen behind, one by one rather than as one sum. */
  readonly behind: readonly { readonly key: string; readonly label: string; readonly arrears: number; readonly missedPeriods: number }[];
  /** Income that has stopped -- a trade cut by war or blockade -- and what it used to bring. */
  readonly stopped: readonly { readonly key: string; readonly label: string; readonly monthly: number }[];
  /** The power's most strained provinces, for whoever reads its books. Null for a private purse. */
  readonly lands: readonly LandLine[] | null;
}

export interface DebtLine {
  readonly id: string;
  /** "Owed to the Roman Republic", "Owed to foreign lenders". */
  readonly lenderLabel: string;
  readonly outstanding: number;
  /** What servicing it costs a month, when a payment was set up. */
  readonly monthly: number | null;
  readonly interestLabel: string;
  readonly terms: string;
  readonly defaulted: boolean;
}

export interface LandLine {
  readonly id: string;
  readonly name: string;
  readonly order: string;
  readonly food: string;
  /** Null when war has not touched it. */
  readonly damage: string | null;
  /** What it could be taxed, a month: only for those who govern. */
  readonly taxable: number | null;
  /** Worse than uneasy on order or food, or ravaged. */
  readonly strained: boolean;
}

const band = (bps: number, words: readonly [string, string, string, string]): string =>
  bps >= 7_000 ? words[0] : bps >= 5_000 ? words[1] : bps >= 3_000 ? words[2] : words[3];
const ORDER_WORDS = ["orderly", "uneasy", "restless", "in disorder"] as const;
const FOOD_WORDS = ["well fed", "short of grain", "hungry", "starving"] as const;
const damageInWords = (bps: number): string | null =>
  bps >= 5_000 ? "ravaged by war" : bps >= 2_000 ? "scarred by war" : bps >= 500 ? "touched by war" : null;
/** How many of its most strained provinces a treasury lists. */
const LANDS_SHOWN = 8;

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
  scope: BooksScope = "all",
): Books {
  const station: Station | null = characterId === null ? null : buildStation({ world, characterId, offices });
  const reaches = (accountId: string): boolean => station === null || seesAccount(station, accountId);
  const polityId = characterId === null ? null : world.characters.find((character) => character.id === characterId)?.polityId ?? null;

  const open = world.material.accounts
    .filter((account) => reaches(account.id))
    .filter((account) => account.owner.kind !== "polity" || account.owner.id === polityId || polityId === null)
    .filter((account) => {
      if (scope === "all") return true;
      const own = account.owner.kind === "character" && account.owner.id === characterId;
      return scope === "own" ? own : !own;
    })
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
    owed.map((obligation) => ({ kind: obligation.kind, label: obligation.label, monthly: perMonth(obligationAmountNow(world, obligation), obligation.cadenceSteps) })),
    EXPENSE_LABELS,
  );

  const totalIncome = income.reduce((sum, line) => sum + line.monthly, 0);
  const totalExpenditure = expenditure.reduce((sum, line) => sum + line.monthly, 0);

  // Only for whoever can open the power's own chest, as the world slice has
  // it: how hard its lands are taxed is the treasury's business.
  const opensTreasury = open.some((account) => account.owner.kind === "polity");
  const readerPolity = polityId ?? open.find((account) => account.owner.kind === "polity")?.owner.id ?? null;
  const governs = station === null || holdsPolityStanding(station);
  const burden = opensTreasury && readerPolity !== null ? taxBurdens(world).get(readerPolity) : undefined;
  const pressure = burden === undefined ? null : {
    inWords: taxBurdenInWords(burden),
    hard: burden.bearable <= 0 || burden.asked / burden.bearable > 0.8,
    why: taxWhy(burden),
  };

  const nameOf = (kind: "character" | "polity" | "foreign", id: string | null): string =>
    kind === "foreign" || id === null ? "foreign lenders"
      : kind === "polity" ? `the ${world.map.polities.find((polity) => polity.id === id)?.name ?? "a foreign power"}`
        : world.characters.find((character) => character.id === id)?.name ?? "a private lender";
  const debts: DebtLine[] = world.material.loans
    .filter((loan) => readable.has(loan.borrowerAccountId) && (loan.status === "active" || loan.status === "defaulted" || loan.status === "renegotiated"))
    .map((loan) => {
      const service = loan.serviceObligationId === null ? undefined : world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId);
      return {
        id: loan.id,
        lenderLabel: `Owed to ${nameOf(loan.lenderKind, loan.lenderId)}`,
        outstanding: Math.round(loan.outstanding),
        monthly: service === undefined ? null : Math.round(perMonth(service.amount, service.cadenceSteps)),
        interestLabel: `${(loan.interestBps / 100).toLocaleString("en-GB", { maximumFractionDigits: 1 })}% interest`,
        terms: loan.terms,
        defaulted: loan.status === "defaulted",
      };
    })
    .sort((a, b) => b.outstanding - a.outstanding);

  const behind = owed
    .filter((obligation) => obligation.arrears > 0)
    .map((obligation) => ({ key: obligation.id, label: obligation.label, arrears: Math.round(obligation.arrears), missedPeriods: obligation.missedPeriods }))
    .sort((a, b) => b.arrears - a.arrears);

  const stopped = world.material.incomeSources
    .filter((source) => !source.active && readable.has(source.beneficiaryAccountId))
    .map((source) => ({ key: source.id, label: source.label, monthly: Math.round(perMonth(source.amount, source.cadenceSteps)) }))
    .filter((line) => line.monthly > 0);

  const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? "A province";
  const held = new Set(world.map.provinces.filter((province) => province.controllerPolityId === readerPolity).map((province) => province.id));
  const lands: LandLine[] | null = !opensTreasury || readerPolity === null ? null : world.material.provinceMaterial
    .filter((material) => held.has(material.provinceId))
    .sort((a, b) => (a.foodSecurityBps + a.stabilityBps - a.warDamageBps) - (b.foodSecurityBps + b.stabilityBps - b.warDamageBps))
    .slice(0, LANDS_SHOWN)
    .map((material) => ({
      id: material.provinceId,
      name: provinceName(material.provinceId),
      order: band(material.stabilityBps, ORDER_WORDS),
      food: band(material.foodSecurityBps, FOOD_WORDS),
      damage: damageInWords(material.warDamageBps),
      taxable: governs ? Math.round(material.taxCapacity) : null,
      strained: material.stabilityBps < 5_000 || material.foodSecurityBps < 5_000 || material.warDamageBps >= 5_000,
    }));

  // If nothing changes: how long what is in hand lasts at this month's rate.
  const surplus = totalIncome - totalExpenditure;
  const inHand = accounts.reduce((sum, account) => sum + account.balance, 0);
  const runsOutInDays = surplus < 0 && inHand > 0 ? Math.floor((inHand / -surplus) * 30) : null;

  return {
    income,
    expenditure,
    totalIncome,
    totalExpenditure,
    surplus,
    runsOutInDays,
    arrears: owed.reduce((sum, obligation) => sum + obligation.arrears, 0),
    accounts,
    theirGovernments: opensTreasury,
    pressure,
    debts,
    behind,
    stopped,
    lands,
  };
}
