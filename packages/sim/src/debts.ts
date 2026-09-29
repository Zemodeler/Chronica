import type { FactProposalDraft, Loan, MoneyObligation, WorldState } from "@chronica/shared";

/**
 * Debts that end (VISION §7, §20).
 *
 * A loan was served with its interest and nothing else: the principal was
 * never paid back, it had no term, and when it fell into default the land it
 * was pledged against stayed exactly where it was. Now a loan is paid off in
 * instalments -- the interest on what is still owed and a share of the
 * principal each period -- over a term, and is done after the last one; and a
 * loan in default forfeits what was pledged for it to whoever lent the money.
 */

/** How many instalments a loan is paid back in, where nobody agreed a term: two years of months. */
export const LOAN_TERM_PERIODS = 24;

/** One instalment: the interest on what is still owed, and an even share of it. */
export function loanInstalment(outstanding: number, interestBps: number, remainingPeriods: number): number {
  if (outstanding <= 0) return 1;
  return Math.max(1, Math.round((outstanding * interestBps) / 10_000) + Math.ceil(outstanding / Math.max(1, remainingPeriods)));
}

/** Of one instalment, what goes to the principal. */
const principalShare = (outstanding: number, remainingPeriods: number): number => Math.ceil(outstanding / Math.max(1, remainingPeriods));

/**
 * Before the month's payments: every loan's instalment, from what is still
 * owed. A loan written before loans had terms is given one from today.
 */
export function termTheLoans(world: WorldState): WorldState {
  const loans = new Map(world.material.loans.filter((loan) => loan.status === "active" && loan.serviceObligationId !== null).map((loan) => [loan.serviceObligationId!, loan]));
  if (loans.size === 0) return world;
  let changed = false;
  const obligations = world.material.obligations.map((obligation) => {
    const loan = loans.get(obligation.id);
    if (loan === undefined || !obligation.active) return obligation;
    const remainingPeriods = obligation.remainingPeriods ?? LOAN_TERM_PERIODS;
    const amount = loanInstalment(loan.outstanding, loan.interestBps, remainingPeriods);
    if (amount === obligation.amount && remainingPeriods === obligation.remainingPeriods) return obligation;
    changed = true;
    return { ...obligation, amount, remainingPeriods, ...(obligation.remainingPeriods === undefined ? { label: `Repayment of ${loan.terms}`.slice(0, 120) } : {}) };
  });
  return changed ? { ...world, material: { ...world.material, obligations } } : world;
}

export interface DebtsInput {
  /** The world before the month's payments, as `termTheLoans` left it. */
  readonly before: WorldState;
  readonly world: WorldState;
}

/**
 * After the month's payments: what each loan still owes, loans paid off, and
 * what a defaulted loan's pledge is forfeit to.
 */
export function settleDebts(input: DebtsInput): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let world = input.world;
  const obligationBefore = new Map(input.before.material.obligations.map((obligation) => [obligation.id, obligation]));
  const obligationNow = new Map(world.material.obligations.map((obligation) => [obligation.id, obligation]));

  // ── Paid down ──────────────────────────────────────────────────────────
  const loans = world.material.loans.map((loan): Loan => {
    if (loan.status !== "active" || loan.serviceObligationId === null) return loan;
    const was = obligationBefore.get(loan.serviceObligationId);
    const now = obligationNow.get(loan.serviceObligationId);
    if (was?.remainingPeriods === undefined || now?.remainingPeriods === undefined) return loan;
    const paid = was.remainingPeriods - now.remainingPeriods;
    if (paid <= 0) return loan;
    const outstanding = now.remainingPeriods === 0 ? 0 : Math.max(0, loan.outstanding - paid * principalShare(loan.outstanding, was.remainingPeriods));
    if (outstanding > 0) return { ...loan, outstanding };
    facts.push({
      localId: `repaid_${loan.id}`.slice(0, 60),
      kind: "loan_repaid",
      summary: `The last instalment on ${loan.terms} has been paid: the debt of ${loan.principal} is discharged.`.slice(0, 600),
      affectedRefs: [{ kind: "account", id: loan.borrowerAccountId }, ...(loan.lenderKind === "character" && loan.lenderId !== null ? [{ kind: "character" as const, id: loan.lenderId }] : [])],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 35,
    });
    return { ...loan, outstanding: 0, status: "repaid" };
  });
  world = { ...world, material: { ...world.material, loans, obligations: world.material.obligations.map((obligation): MoneyObligation => {
    const loan = loans.find((candidate) => candidate.serviceObligationId === obligation.id);
    return loan?.status === "repaid" && obligation.active ? { ...obligation, active: false } : obligation;
  }) } };

  // ── Forfeit ────────────────────────────────────────────────────────────
  for (const loan of world.material.loans) {
    if (loan.status !== "defaulted" || loan.collateralHoldingId === null) continue;
    const seized = seizeThePledge(world, loan);
    if (seized === null) continue;
    world = seized.world;
    facts.push(seized.fact);
  }
  return { world, facts };
}

/**
 * The holding a defaulted loan was pledged against goes to the lender, and its
 * rents with it. A power that lent takes the rents into its treasury; money
 * from outside the world has nobody here to take the land, and its agents take
 * the rents off it until it is sold. Null where it is already done.
 */
function seizeThePledge(world: WorldState, loan: Loan): { world: WorldState; fact: FactProposalDraft } | null {
  const holding = world.material.holdings.find((candidate) => candidate.id === loan.collateralHoldingId);
  if (holding === undefined) return null;
  const source = world.material.incomeSources.find((candidate) => candidate.id === holding.incomeSourceId);
  const lenderAccount = loan.lenderKind === "foreign" || loan.lenderId === null
    ? undefined
    : world.material.accounts.find((account) => account.owner.kind === loan.lenderKind && account.owner.id === loan.lenderId && account.status === "active");
  const lenderName = loan.lenderKind === "character"
    ? world.characters.find((character) => character.id === loan.lenderId)?.name ?? loan.lenderId ?? "the lender"
    : loan.lenderKind === "polity" ? world.map.polities.find((polity) => polity.id === loan.lenderId)?.name ?? loan.lenderId ?? "the lender" : "its foreign creditors";
  const holderName = world.characters.find((character) => character.id === holding.legalHolderCharacterId)?.name ?? holding.legalHolderCharacterId;

  let holdings = world.material.holdings;
  let incomeSources = world.material.incomeSources;
  if (loan.lenderKind === "character" && loan.lenderId !== null) {
    if (holding.legalHolderCharacterId === loan.lenderId) return null;
    if (!world.characters.some((character) => character.id === loan.lenderId)) return null;
    holdings = holdings.map((candidate) => (candidate.id === holding.id ? { ...candidate, legalHolderCharacterId: loan.lenderId! } : candidate));
    if (source !== undefined && lenderAccount !== undefined) incomeSources = incomeSources.map((candidate) => (candidate.id === source.id ? { ...candidate, beneficiaryAccountId: lenderAccount.id } : candidate));
  } else if (lenderAccount !== undefined) {
    if (source === undefined || source.beneficiaryAccountId === lenderAccount.id) return null;
    incomeSources = incomeSources.map((candidate) => (candidate.id === source.id ? { ...candidate, beneficiaryAccountId: lenderAccount.id } : candidate));
  } else {
    if (source === undefined || !source.active) return null;
    incomeSources = incomeSources.map((candidate) => (candidate.id === source.id ? { ...candidate, active: false } : candidate));
  }
  return {
    world: { ...world, material: { ...world.material, holdings, incomeSources } },
    fact: {
      localId: `pledge_${loan.id}`.slice(0, 60),
      kind: "collateral_seized",
      summary: loan.lenderKind === "character"
        ? `${holding.title}, pledged by ${holderName} for ${loan.terms}, is forfeit: the debt went unpaid, and it is ${lenderName}'s now, rents and all.`.slice(0, 600)
        : loan.lenderKind === "polity"
          ? `The rents of ${holding.title}, pledged for ${loan.terms}, go to ${lenderName}'s treasury now that the debt has gone unpaid.`.slice(0, 600)
          : `${holding.title}, pledged for ${loan.terms}, is in the hands of ${lenderName}' agents, who take its rents now that the debt has gone unpaid.`.slice(0, 600),
      affectedRefs: [
        { kind: "character", id: holding.legalHolderCharacterId },
        { kind: "account", id: loan.borrowerAccountId },
        ...(loan.lenderKind === "character" && loan.lenderId !== null ? [{ kind: "character" as const, id: loan.lenderId }] : []),
        ...(loan.lenderKind === "polity" && loan.lenderId !== null ? [{ kind: "polity" as const, id: loan.lenderId }] : []),
      ],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 55,
    },
  };
}
