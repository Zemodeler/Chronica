import { GenericEntitySchema, INFAMIA_KIND, monthlyTakings, shiftStanding, warsOf, type FactProposalDraft, type WorldState } from "@chronica/shared";
import { safeLocalId } from "./safe-local-id";

/**
 * Who may lend to whom, and what a default costs.
 *
 * A merchant lent the treasury 4,500 at "100% a month" and was paid about 49,000 back: a loan whose borrower was a state's account needed nobody's
 * consent, no rate was too high, and the term he wrote ("12 instalments") was ignored. A loan to a state is a negotiated act. The treasury's keeper (the
 * quaestor, the Officer of the Accounts; the chamber for large sums) takes it or does not, and his answer is by rule: the rate within what the state's
 * credit bears (the interest of the age: a centesima, a twelfth of the capital a year, was the going rate for a good name; war made it dearer), the sum
 * within what a state's revenue will carry, and never from a man whose own money is not there. A state that has
 * defaulted is lent to by nobody for a time.
 *
 * Default is not free either. Rome's *lex Poetelia Papiria* (326 BCE) ended the chaining of a citizen for debt (the *nexum*), so a Roman debtor loses his goods,
 * not his freedom: the creditor has the pledge, the purse is taken for the debt and the debtor is infamous (*infamia*, his goods being sold up) for five years.
 * Elsewhere the age was harder or softer by its own custom (Syracuse and the Greek cities: loss of civic rights, *atimia*, till the debt is paid;
 * Carthage: the Council fines him). All lose standing; all are denied credit.
 */

/** The dearest a man lends or borrows at, a month: ten in a hundred (a hundred and twenty a year). Maritime loans of the age ran dearer for a voyage, not for a month. */
export const MAX_LOAN_RATE_BPS = 1_000;
/** What a state's credit bears in peace a month: one in a hundred (the centesima, twelve a year). */
export const STATE_RATE_PEACE_BPS = 100;
/** What it bears at war a month: two in a hundred (a quarter of the capital a year). */
export const STATE_RATE_WAR_BPS = 200;
/** A state will not borrow from one man more than this many months of its takings, nor less than `STATE_LOAN_FLOOR`. */
export const STATE_LOAN_MONTHS = 2;
export const STATE_LOAN_FLOOR = 5_000;
/** How long a default shuts a man or a state out of credit and costs him his good name (five years). */
export const DEFAULT_DAYS = 1_825;
export const DEFAULT_KIND = "default";
const STANDING_LOSS_BPS = -600;
/** The instalments a loan is paid in, at most: a loan is not for ever. */
const MOST_PERIODS = 60;

const pct = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}`;

/** The instalments the lender wrote ("in 12 instalments", "over 18 months"), else the usual two years. */
export function termPeriodsOf(terms: string | undefined, fallback: number): number {
  const said = /(\d{1,3})\s*(?:monthly\s+)?(?:instalments?|installments?|payments?|months?|periods?)/i.exec(terms ?? "");
  const n = said === null ? NaN : Number(said[1]);
  return Number.isFinite(n) && n >= 1 ? Math.min(MOST_PERIODS, Math.round(n)) : fallback;
}

/** When a man's or a state's default stops shutting it out of credit, or null if it has none standing. */
export function defaultedUntil(world: Pick<WorldState, "genericEntities">, ownerKind: "character" | "polity", ownerId: string, day: number): number | null {
  let until: number | null = null;
  for (const entity of world.genericEntities) {
    if (entity.kind !== DEFAULT_KIND || entity.attributes?.["ownerKind"] !== ownerKind || entity.attributes?.["ownerId"] !== ownerId) continue;
    const end = Number(entity.attributes?.["untilStep"]);
    if (Number.isFinite(end) && end > day && (until === null || end > until)) until = end;
  }
  return until;
}

export interface LoanAsked {
  readonly borrowerAccountId: string;
  readonly lenderKind: "character" | "polity" | "foreign";
  readonly lenderId: string | null;
  /** The man whose order it is; the lender himself when he lends of his own motion. */
  readonly actorId: string | null;
  readonly principal: number;
  /** The rate as the lender wrote it, before the state's credit scales it. */
  readonly interestBps: number;
  readonly periods: number;
  readonly day: number;
  /** A standing offer taken, or the fiscal officer's own request: both were agreed by whoever made them. */
  readonly agreed: boolean;
}

/** Why a loan is not made, in the words the lender is told, or null if it may be. */
export function loanRefusal(world: WorldState, ask: LoanAsked): string | null {
  const borrower = world.material.accounts.find((account) => account.id === ask.borrowerAccountId);
  if (borrower === undefined) return null;
  const owner = borrower.owner;
  if (ask.lenderKind === "character" && ask.interestBps > MAX_LOAN_RATE_BPS && !(owner.kind === "polity" && !ask.agreed)) {
    return `Nobody lends or borrows at ${pct(ask.interestBps)} in the hundred a month: the going rate is one, and the most that is ever asked is ${pct(MAX_LOAN_RATE_BPS)}.`;
  }
  if (owner.kind === "character") {
    const until = defaultedUntil(world, "character", owner.id, ask.day);
    if (until !== null) {
      const name = world.characters.find((character) => character.id === owner.id)?.name ?? "The man";
      return `No lender will deal with ${name} (or he with them): a debt of his went unpaid and his credit is gone until day ${until}.`;
    }
    return null;
  }
  if (owner.kind !== "polity" || ask.agreed || ask.lenderKind !== "character") return null;
  // A private man lending to a state's chest: the state's keeper of the purse takes it or does not.
  const polity = world.map.polities.find((candidate) => candidate.id === owner.id);
  const name = polity?.name ?? owner.id;
  const body = world.material.institutions.find((institution) => institution.polityId === owner.id && institution.advisory !== true)?.name ?? "council";
  const until = defaultedUntil(world, "polity", owner.id, ask.day);
  if (until !== null) return `The ${body} of ${name} has no credit: it defaulted, and nobody lends to it until day ${until}.`;
  const atWar = warsOf(world.polityAgreements, owner.id).length > 0;
  const cap = atWar ? STATE_RATE_WAR_BPS : STATE_RATE_PEACE_BPS;
  if (ask.interestBps > cap) {
    return `The ${body} will not borrow at ${pct(ask.interestBps)} in the hundred a month: ${name}'s credit bears ${pct(cap)} ${atWar ? "in war" : "in peace"}, and the ${body} will not pay more.`;
  }
  const takings = monthlyTakings(world, owner.id);
  const most = Math.max(STATE_LOAN_FLOOR, takings * STATE_LOAN_MONTHS);
  if (ask.principal > most) return `${name} takes no more than ${most} from one lender (${STATE_LOAN_MONTHS} months of its takings): ${ask.principal} is too much.`;
  return null;
}

/** What a loan's default costs, done once for each loan, in the month it is found (`debts.ts`). */
export function priceOfDefault(world: WorldState, atStep: number): { world: WorldState; facts: FactProposalDraft[] } {
  let next = world;
  const facts: FactProposalDraft[] = [];
  for (const loan of world.material.loans) {
    if (loan.status !== "defaulted") continue;
    const markId = `default-${loan.id}`.slice(0, 100);
    if (next.genericEntities.some((entity) => entity.id === markId)) continue;
    const borrower = next.material.accounts.find((account) => account.id === loan.borrowerAccountId);
    if (borrower === undefined || (borrower.owner.kind !== "character" && borrower.owner.kind !== "polity")) continue;
    const ownerKind = borrower.owner.kind;
    const ownerId = borrower.owner.id;
    const untilStep = atStep + DEFAULT_DAYS;
    const lender = loan.lenderKind === "character" && loan.lenderId !== null ? next.characters.find((character) => character.id === loan.lenderId) : undefined;
    const debtor = ownerKind === "character" ? next.characters.find((character) => character.id === ownerId) : undefined;
    const polity = ownerKind === "polity" ? next.map.polities.find((candidate) => candidate.id === ownerId) : next.map.polities.find((candidate) => candidate.id === debtor?.polityId);
    const lost = loan.outstanding;
    let recovered = 0;
    let line: string;
    if (debtor !== undefined) {
      // The goods go for the debt: what the purse holds goes to the lender, and the rest of the debt stays on the man's name.
      const purse = next.material.accounts.find((account) => account.id === debtor.personalAccountId);
      const lenderPurse = lender === undefined ? undefined : next.material.accounts.find((account) => account.id === lender.personalAccountId);
      recovered = purse === undefined || lenderPurse === undefined ? 0 : Math.max(0, Math.min(purse.balance, lost));
      if (recovered > 0 && purse !== undefined) {
        next = {
          ...next,
          material: {
            ...next.material,
            accounts: next.material.accounts.map((account) => (account.id === purse.id ? { ...account, balance: account.balance - recovered } : lenderPurse !== undefined && account.id === lenderPurse.id ? { ...account, balance: account.balance + recovered } : account)),
            transactions: [...next.material.transactions, {
              id: safeLocalId(`txn_default_${loan.id}`).slice(0, 100), atStep, kind: "confiscation" as const, amount: recovered, sourceAccountId: purse.id, destinationAccountId: lenderPurse!.id,
              cause: { kind: "action" as const, id: loan.id, explanation: `Goods sold for the debt: ${loan.terms}`.slice(0, 200) }, visibility: "public" as const,
            }],
          },
        };
      }
      next = shiftStanding(next, debtor.id, STANDING_LOSS_BPS, "scandal");
      const rome = polity?.id === "rome";
      const why = rome
        ? "his goods were sold for his debts"
        : polity?.id === "carthage" ? "the Council fined him for a debt he left unpaid" : "he left a debt unpaid, and the city struck him of its rights (atimia)";
      line = rome
        ? `${debtor.name} did not pay${lender === undefined ? "" : ` ${lender.name}`}: his goods were sold for the debt (${recovered} recovered of ${lost}), the law of Poetelius forbids chaining a citizen, so he is made infamous for five years instead, and no lender will deal with him.`
        : `${debtor.name} did not pay${lender === undefined ? "" : ` ${lender.name}`}: ${why} (${recovered} recovered of ${lost}); his name is bad and no lender will deal with him for five years.`;
      next = {
        ...next,
        genericEntities: [...next.genericEntities, GenericEntitySchema.parse({
          id: safeLocalId(`infamia_debt_${debtor.id}_${atStep}`).slice(0, 100), kind: INFAMIA_KIND, label: `${debtor.name} is infamous for his debts`.slice(0, 120), ownerRef: polity === undefined ? null : { kind: "polity", id: polity.id },
          attributes: { characterId: debtor.id, untilStep, why, atStep }, createdAtStep: atStep,
        })],
      };
    } else {
      line = `${polity?.name ?? "The state"} stopped paying its creditors (${lost} owed${lender === undefined ? "" : `, ${lender.name} among them`}): its credit is gone, and nobody lends to it for five years.`;
    }
    next = {
      ...next,
      genericEntities: [...next.genericEntities, GenericEntitySchema.parse({
        id: markId, kind: DEFAULT_KIND, label: `A debt unpaid: ${loan.terms}`.slice(0, 120), ownerRef: polity === undefined ? null : { kind: "polity", id: polity.id },
        attributes: { ownerKind, ownerId, loanId: loan.id, lenderId: loan.lenderId ?? "", untilStep, outstanding: lost, recovered, atStep }, createdAtStep: atStep,
      })],
    };
    facts.push({
      localId: safeLocalId(`default_price_${loan.id}`).slice(0, 60),
      kind: "default_priced",
      summary: line.slice(0, 600),
      affectedRefs: [...(debtor === undefined ? [] : [{ kind: "character" as const, id: debtor.id }]), ...(lender === undefined ? [] : [{ kind: "character" as const, id: lender.id }]), ...(polity === undefined ? [] : [{ kind: "polity" as const, id: polity.id }])].slice(0, 6),
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: debtor === undefined ? 55 : 35,
    });
  }
  return { world: next, facts };
}


/** The words with which a man's own order takes credit: "on credit", "take the credit", "borrow", "a loan". */
export const CREDIT_WORDS = /\b(?:on credit|take the credit|borrow(?:ed|ing)?|a loan|with credit|on terms)\b/i;
