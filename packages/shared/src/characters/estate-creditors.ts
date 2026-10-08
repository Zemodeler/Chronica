import { boundedId } from "../determinism";
import type { InheritanceTransfer, Loan, MoneyAccount, MoneyTransaction } from "../material-state";
import type { WorldState } from "../world/world-state";

/**
 * The creditors are paid first (docs/economy.md, "The creditors are paid first").
 *
 * A dead man's debts used to die with him if he left no heir, and went to the principal heir whole if he did, whatever the estate
 * held. Rome did not settle a death so. The heir (*heres*) stepped into the dead man's place as his universal successor and answered for
 * his debts with the estate and beyond it: the *sui heredes* (his children in his power) were heirs whether they would or no, but the
 * praetor let them *abstain* (*ius abstinendi*) from an estate that owed more than it held, and any other heir might refuse it
 * outright. The creditors then had the estate sold up (*bonorum venditio*) and shared it between them. A pledge (*pignus*) was the
 * creditor's before anyone's, and the *fiscus* had a claim on a debtor's goods ahead of other creditors (*privilegium fisci*).
 *
 * Here, for every dead man with loans on his accounts, and before heirs or treasury see anything:
 *
 *  1. **What he owed and what he left.** The loans on his purses (what is still outstanding) against his coin, his land (at ten years'
 *     rent, `LAND_PRICE_YEARS`) and the cost of the cargoes he had afloat.
 *  2. **The heir accepts or abstains.** An heir takes an estate that covers its debts. Where the debts are more than it holds, or there
 *     is no heir, the estate is sold to the creditors: the heir takes the name and what friends and feuds go with it, and nothing else.
 *  3. **The order of payment**, out of his coin: first the secured (a loan with land pledged for it, which in a sale also takes the
 *     pledge itself at its value), then the public debts (a power's treasury), then the private loans (a man's and a foreign banker's) in
 *     proportion to what each is owed. Each payment is a transfer between purses (a foreign banker's leaves by the `credit` door).
 *  4. **In a sale** what coin did not cover is met out of the land and the cargoes, handed to the creditors still owed, the largest claim
 *     first, at their value (to the men who lent, not to a power: a treasury is paid in coin or in nothing).
 *  5. **What is left.** A debt the estate could not meet is lost to the creditor in a sale; where the heir took the estate he takes what is
 *     left of the loan too, as a universal successor, and goes on paying it.
 *
 * Money is conserved: coin only moves between purses (or out by the foreign banker's door), so the audit is where it was.
 */

/** The price of land, in years of its rent. */
export const LAND_PRICE_YEARS = 10;
/** The words the record of a sold-up estate begins with: read by whoever must tell a house taken up from a house sold. */
export const SOLD_TO_CREDITORS = "Sold to the creditors";

export interface CreditorsInput {
  readonly world: WorldState;
  readonly deceasedId: string;
  /** The dead man's accounts, as gathered. */
  readonly accounts: readonly MoneyAccount[];
  readonly holdingIds: readonly string[];
  readonly ventureIds: readonly string[];
  readonly hasHeir: boolean;
  /** The principal heir's purse, where there is an heir. */
  readonly principalPurseId: string | null;
  /** Whether the debts that are left follow the estate to the heir (an authored rule may forgive them). */
  readonly debtsTransfer: boolean;
  readonly estateId: string;
  readonly atStep: number;
}

export interface DebtsSettled {
  /** What the dead man owed on loans when he died. */
  readonly owed: number;
  /** What the estate held (coin, land at its price, cargoes at their cost). */
  readonly estate: number;
  /** Paid to creditors in coin. */
  readonly paidInCoin: number;
  /** Paid to creditors in land and cargoes, at their value. */
  readonly paidInKind: number;
  /** What no one paid: lost to the creditors in a sale, or left on the heir who took the estate. */
  readonly lost: number;
  readonly leftOnHeir: number;
  readonly creditors: number;
  readonly loans: number;
  /** Where the estate went to the creditors: the heir abstained, or there was no heir. */
  readonly soldUp: boolean;
  readonly abstained: boolean;
}

export interface CreditorsResult {
  readonly world: WorldState;
  /** Holdings and ventures the creditors took: not the heirs' to inherit. */
  readonly takenHoldingIds: ReadonlySet<string>;
  readonly takenVentureIds: ReadonlySet<string>;
  readonly transfers: readonly InheritanceTransfer[];
  readonly debts: DebtsSettled | null;
}

const NOTHING: ReadonlySet<string> = new Set();

/** A holding's price: ten years of what it pays. */
export function landValue(world: Pick<WorldState, "material">, holdingId: string): number {
  const holding = world.material.holdings.find((candidate) => candidate.id === holdingId);
  const source = holding === undefined ? undefined : world.material.incomeSources.find((candidate) => candidate.id === holding.incomeSourceId);
  return source === undefined ? 0 : Math.round((source.amount * 365 * LAND_PRICE_YEARS) / Math.max(1, source.cadenceSteps));
}

/** Whether a dead man's estate was sold up to his creditors and not taken by an heir (read off the record). */
export function estateWasSoldUp(world: Pick<WorldState, "material">, deceasedId: string): boolean {
  return world.material.inheritanceTransfers.some((transfer) => transfer.deceasedCharacterId === deceasedId && transfer.reason.startsWith(SOLD_TO_CREDITORS));
}

interface Claim {
  loan: Loan;
  /** What is still owed. */
  left: number;
  /** The creditor's account, or null for a foreign banker; undefined when it cannot be paid. */
  to: MoneyAccount | null | undefined;
  tier: 1 | 2 | 3;
}

/**
 * Pay the dead man's creditors out of his estate, in the order above. Pure: returns the world with the money moved, the loans
 * brought down, discharged or written off, and the assets the creditors took. A man with no loans on his accounts changes nothing.
 */
export function payTheCreditors(input: CreditorsInput): CreditorsResult {
  const { world, deceasedId, estateId, atStep } = input;
  const none: CreditorsResult = { world, takenHoldingIds: NOTHING, takenVentureIds: NOTHING, transfers: [], debts: null };
  const held = new Set(input.accounts.map((account) => account.id));
  const loans = world.material.loans.filter((loan) => loan.status === "active" && loan.outstanding > 0 && held.has(loan.borrowerAccountId));
  if (loans.length === 0) return none;

  const nameOf = (id: string | null): string => (id === null ? "its foreign creditors" : world.characters.find((character) => character.id === id)?.name ?? world.map.polities.find((polity) => polity.id === id)?.name ?? id);
  const dead = world.characters.find((character) => character.id === deceasedId);
  const deadName = dead?.name ?? "the dead man";
  const accountOf = (kind: string, id: string | null): MoneyAccount | undefined => (id === null
    ? undefined
    : world.material.accounts.find((account) => account.owner.kind === kind && account.owner.id === id && account.status === "active" && !held.has(account.id)));

  // ── What he owed, and what he left ────────────────────────────────────────
  const claims: Claim[] = loans.map((loan) => {
    const to = loan.lenderKind === "foreign" ? null : accountOf(loan.lenderKind, loan.lenderId);
    const pledged = loan.collateralHoldingId !== null && input.holdingIds.includes(loan.collateralHoldingId);
    return { loan, left: loan.outstanding, to, tier: pledged ? 1 : loan.lenderKind === "polity" ? 2 : 3 } as Claim;
  }).sort((a, b) => a.loan.id.localeCompare(b.loan.id));
  const balances = new Map(input.accounts.map((account) => [account.id, Math.max(0, account.balance)]));
  const coin = [...balances.values()].reduce((sum, balance) => sum + balance, 0);
  const holdingsValue = input.holdingIds.reduce((sum, id) => sum + landValue(world, id), 0);
  const venturesValue = input.ventureIds.reduce((sum, id) => sum + (world.material.ventures.find((venture) => venture.id === id)?.cargo?.cost ?? 0), 0);
  const estate = coin + holdingsValue + venturesValue;
  const owed = claims.reduce((sum, claim) => sum + claim.left, 0);
  // The heir takes an estate that covers what it owes; else (or with no heir) it is sold up to the creditors.
  const soldUp = !input.hasHeir || owed > estate;
  const abstained = input.hasHeir && soldUp;

  const transactions: MoneyTransaction[] = [];
  const credits = new Map<string, number>();
  const transfers: InheritanceTransfer[] = [];
  const transfer = (assetKind: InheritanceTransfer["assetKind"], assetId: string, to: string | null, reason: string): void => {
    transfers.push({ id: boundedId(estateId, "creditor", assetKind, assetId, to ?? "none"), estateId, deceasedCharacterId: deceasedId, beneficiaryCharacterId: to, assetKind, assetId, reason: reason.slice(0, 240), resolvedAtStep: atStep, sourceEventId: null });
  };
  let paidInCoin = 0;
  let paidInKind = 0;
  const paidTo = new Set<string>();

  /** Pay `amount` of one claim out of his coin; returns what was paid. */
  const payInCoin = (claim: Claim, amount: number): number => {
    let rest = Math.min(amount, claim.left);
    let paid = 0;
    for (const [accountId, balance] of balances) {
      if (rest <= 0) break;
      const take = Math.min(balance, rest);
      if (take <= 0) continue;
      balances.set(accountId, balance - take);
      rest -= take;
      paid += take;
      transactions.push({
        id: boundedId(estateId, "creditor-payment", claim.loan.id, accountId), atStep, kind: "transfer", amount: take, sourceAccountId: accountId,
        ...(claim.to === null ? { external: "credit" as const } : { destinationAccountId: claim.to!.id }),
        cause: { kind: "succession", id: estateId, explanation: `${deadName}'s estate pays ${nameOf(claim.loan.lenderId)} on ${claim.loan.terms}`.slice(0, 240) },
        visibility: "private",
      });
      if (claim.to !== null && claim.to !== undefined) credits.set(claim.to.id, (credits.get(claim.to.id) ?? 0) + take);
    }
    if (paid > 0) { claim.left -= paid; paidInCoin += paid; paidTo.add(claim.loan.id); }
    return paid;
  };

  // Land taken: the creditor's, and its rents with it.
  const takenHoldingIds = new Set<string>();
  const takenVentureIds = new Set<string>();
  let holdings = world.material.holdings;
  let ventures = world.material.ventures;
  let incomeSources = world.material.incomeSources;
  const giveHolding = (holdingId: string, claim: Claim, credit: boolean): void => {
    const holding = holdings.find((candidate) => candidate.id === holdingId);
    if (holding === undefined) return;
    const value = landValue(world, holdingId);
    const lender = claim.loan.lenderKind === "character" ? claim.loan.lenderId : null;
    // A man who lent takes the land into his name; a treasury takes only its rents (a holding has a man for its holder); a banker abroad
    // has agents who take the rents until it is sold, which here is as good as nobody's.
    if (claim.to === undefined) return;
    if (lender !== null) holdings = holdings.map((candidate) => (candidate.id === holdingId ? { ...candidate, legalHolderCharacterId: lender } : candidate));
    incomeSources = incomeSources.map((source) => (source.id === holding.incomeSourceId
      ? (claim.to === null ? { ...source, active: false } : { ...source, beneficiaryAccountId: claim.to!.id })
      : source));
    takenHoldingIds.add(holdingId);
    if (credit) { const worth = Math.min(claim.left, value); claim.left -= worth; paidInKind += worth; paidTo.add(claim.loan.id); }
    transfer("holding", holdingId, lender, `${SOLD_TO_CREDITORS}: ${holding.title} is ${nameOf(claim.loan.lenderId)}'s in payment of ${claim.loan.terms}.`);
  };

  // ── 1. In a sale, the pledge goes to the man it was pledged to ─────────────
  if (soldUp) {
    for (const claim of claims) {
      if (claim.tier === 1 && claim.loan.collateralHoldingId !== null) giveHolding(claim.loan.collateralHoldingId, claim, true);
    }
  }

  // ── 2. His coin: the secured, then the public, then the private in proportion ─
  for (const tier of [1, 2, 3] as const) {
    const inTier = claims.filter((claim) => claim.tier === tier && claim.left > 0 && claim.to !== undefined);
    const total = inTier.reduce((sum, claim) => sum + claim.left, 0);
    const available = [...balances.values()].reduce((sum, balance) => sum + balance, 0);
    if (total === 0 || available === 0) continue;
    if (available >= total) { for (const claim of inTier) payInCoin(claim, claim.left); continue; }
    let given = 0;
    inTier.forEach((claim) => { given += payInCoin(claim, Math.floor((available * claim.left) / total)); });
    // What does not divide goes to the largest claim still open.
    const dust = available - given;
    const biggest = [...inTier].sort((a, b) => b.left - a.left || a.loan.id.localeCompare(b.loan.id))[0];
    if (dust > 0 && biggest !== undefined) payInCoin(biggest, dust);
  }

  // ── 3. In a sale, land and cargoes go to the men still owed, the largest claim first ──
  if (soldUp) {
    const open = (): Claim[] => claims.filter((claim) => claim.left > 0 && claim.loan.lenderKind === "character" && claim.to !== undefined && claim.to !== null)
      .sort((a, b) => b.left - a.left || a.loan.id.localeCompare(b.loan.id));
    for (const holdingId of input.holdingIds) {
      if (takenHoldingIds.has(holdingId)) continue;
      const next = open()[0];
      if (next === undefined) break;
      giveHolding(holdingId, next, true);
    }
    for (const ventureId of input.ventureIds) {
      const venture = ventures.find((candidate) => candidate.id === ventureId);
      const next = open()[0];
      if (venture === undefined || next === undefined) continue;
      const value = venture.cargo?.cost ?? 0;
      if (value <= 0) continue;
      const lender = next.loan.lenderId!;
      ventures = ventures.map((candidate) => (candidate.id === ventureId ? { ...candidate, ownerCharacterId: lender } : candidate));
      incomeSources = incomeSources.map((source) => (source.id === venture.incomeSourceId ? { ...source, beneficiaryAccountId: next.to!.id } : source));
      takenVentureIds.add(ventureId);
      const worth = Math.min(next.left, value);
      next.left -= worth;
      paidInKind += worth;
      paidTo.add(next.loan.id);
      transfer("venture", ventureId, lender, `${SOLD_TO_CREDITORS}: ${venture.title} is ${nameOf(lender)}'s in payment of ${next.loan.terms}.`.slice(0, 240));
    }
  }

  // ── 4. What is left of each loan ────────────────────────────────────────────
  let lost = 0;
  let leftOnHeir = 0;
  const byLoan = new Map(claims.map((claim) => [claim.loan.id, claim]));
  const endedService = new Set<string>();
  const nextLoans = world.material.loans.map((loan): Loan => {
    const claim = byLoan.get(loan.id);
    if (claim === undefined) return loan;
    if (claim.left <= 0) {
      if (loan.serviceObligationId !== null) endedService.add(loan.serviceObligationId);
      return { ...loan, outstanding: 0, status: "repaid" };
    }
    if (soldUp || !input.debtsTransfer || input.principalPurseId === null) {
      // A debt beyond the estate is lost to the creditor (and the pledge is done with).
      lost += claim.left;
      if (loan.serviceObligationId !== null) endedService.add(loan.serviceObligationId);
      return { ...loan, outstanding: 0, status: "defaulted", collateralHoldingId: takenHoldingIds.has(loan.collateralHoldingId ?? "") ? null : loan.collateralHoldingId };
    }
    // The heir took the estate: he takes the rest of the debt with it, and goes on paying it.
    leftOnHeir += claim.left;
    return { ...loan, outstanding: claim.left, borrowerAccountId: input.principalPurseId };
  });

  const accounts = world.material.accounts.map((account) => {
    const left = balances.get(account.id);
    if (left !== undefined) return { ...account, balance: left };
    const incoming = credits.get(account.id);
    return incoming === undefined ? account : { ...account, balance: account.balance + incoming };
  });
  const creditors = new Set(claims.filter((claim) => paidTo.has(claim.loan.id)).map((claim) => `${claim.loan.lenderKind}:${claim.loan.lenderId ?? "abroad"}`)).size;

  if (soldUp && input.hasHeir) transfer("account_balance", input.accounts[0]!.id, null, `${SOLD_TO_CREDITORS}: the heir abstained, the debts being more than the estate held.`);
  else if (soldUp) transfer("account_balance", input.accounts[0]!.id, null, `${SOLD_TO_CREDITORS}: there was no heir.`);

  return {
    world: {
      ...world,
      material: {
        ...world.material,
        accounts,
        loans: nextLoans,
        holdings,
        ventures,
        incomeSources,
        obligations: endedService.size === 0 ? world.material.obligations : world.material.obligations.map((obligation) => (endedService.has(obligation.id) ? { ...obligation, active: false } : obligation)),
        transactions: [...world.material.transactions, ...transactions],
      },
    },
    takenHoldingIds,
    takenVentureIds,
    transfers,
    debts: { owed, estate, paidInCoin, paidInKind, lost, leftOnHeir, creditors, loans: claims.length, soldUp, abstained },
  };
}
