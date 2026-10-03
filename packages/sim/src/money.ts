import {
  boundedId,
  computeOpinion,
  ESTATE_PRICE_MONTHS,
  stableHash,
  type FactProposalDraft,
  type MoneyObligation,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Money a private man can come by (play-test E18, L8).
 *
 * A man with no office and no estate had one way to money -- an order the
 * model wrote out for him -- and three he should have had: his pay, a loan,
 * and a patron. The legionary's pay left the treasury and landed nowhere; a
 * merchant whose purse ran dry found nobody in Rome who would lend; and a
 * client was a word on a social tie that paid nothing. Each is a rule now.
 */

// ── A soldier's pay ──────────────────────────────────────────────────────────

/**
 * What a legionary is owed a month, in drachmae, before stoppages: two obols a
 * day, as Polybius gives it (6.39), thirty days to the month.
 */
export const LEGIONARY_PAY_GROSS = 10;
/**
 * And what is stopped out of it for his grain, his clothes and the arms he is
 * issued, which Polybius says the quaestor deducted: about a third. A legionary
 * keeps seven a month, a centurion twice that, a horseman three times.
 */
export const PAY_STOPPAGES_SHARE = 1 / 3;
const CENTURION_PAY_MULTIPLE = 2;
const HORSEMAN_PAY_MULTIPLE = 3;

/** One named man's share of a month's pay. */
export interface PayShare {
  readonly characterId: string;
  readonly accountId: string;
  readonly amount: number;
}

/**
 * Who of an army's named men is paid out of this obligation, and how much.
 *
 * The army's pay obligation is the treasury's whole outlay for the army; the
 * named men's shares come out of it, not on top of it, so the treasury pays
 * what it always paid and the part that was the player's now reaches his
 * purse. The rest is the pay of the thousands nobody named. A man with no purse
 * of his own is paid in the ranks, as he always was; the commander and the
 * officers over a whole body serve for the honour of it (the tribunes were
 * magistrates) and are paid by nobody's chest. Should the named men's shares
 * come to more than was paid -- a handful of men left in a broken army -- each
 * is cut in proportion.
 */
export function soldierPayShares(world: WorldState, obligation: Pick<MoneyObligation, "id" | "kind" | "amount">, paid: number): readonly PayShare[] {
  if (obligation.kind !== "army_pay" || paid <= 0) return [];
  const force = world.material.forces.find((candidate) => candidate.payObligationId === obligation.id);
  if (force === undefined) return [];
  const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
  const named = [...new Set([...force.memberCharacterIds, ...(force.posts ?? []).map((post) => post.characterId)])]
    .filter((id) => id !== force.commanderCharacterId && id !== force.controllerCharacterId)
    .sort();
  // Arrears paid at once are several months' pay: each man gets his months too.
  const months = obligation.amount <= 0 ? 1 : Math.max(1, Math.round(paid / obligation.amount));
  const net = LEGIONARY_PAY_GROSS * (1 - PAY_STOPPAGES_SHARE);
  const wanted: PayShare[] = [];
  for (const id of named) {
    const man = world.characters.find((character) => character.id === id);
    if (man === undefined || !man.alive || man.personalAccountId === null) continue;
    const purse = world.material.accounts.find((account) => account.id === man.personalAccountId && account.status === "active");
    if (purse === undefined) continue;
    const rank = establishment?.ranks.find((candidate) => candidate.id === man.service?.rankId);
    if (rank !== undefined && (rank.level === "body" || rank.level === "formation" || rank.level === "army")) continue;
    const formationId = man.service?.forceId === force.id ? man.service.formationId : null;
    const category = force.personnel.find((row) => row.formationId !== undefined && row.formationId === formationId)?.categoryId ?? null;
    const horse = category !== null && /cavalry|horse/i.test(category);
    const multiple = horse ? HORSEMAN_PAY_MULTIPLE : rank?.level === "unit" || rank?.level === "sub" ? CENTURION_PAY_MULTIPLE : 1;
    wanted.push({ characterId: id, accountId: purse.id, amount: Math.round(net * multiple * months) });
  }
  const total = wanted.reduce((sum, share) => sum + share.amount, 0);
  if (total <= paid) return wanted.filter((share) => share.amount > 0);
  return wanted.map((share) => ({ ...share, amount: Math.floor((share.amount * paid) / total) })).filter((share) => share.amount > 0);
}

// ── What a man has coming in ─────────────────────────────────────────────────

/** What comes into a man's purse in a month: his estates' and ventures' yield, and whatever is paid him. */
export function monthlyIncomeOf(world: WorldState, characterId: string): number {
  const purseId = world.characters.find((character) => character.id === characterId)?.personalAccountId ?? null;
  if (purseId === null) return 0;
  const perMonth = (amount: number, cadence: number): number => (cadence <= 0 ? 0 : (amount * 30) / cadence);
  const income = world.material.incomeSources
    .filter((source) => source.active && source.beneficiaryAccountId === purseId)
    .reduce((sum, source) => sum + perMonth(source.amount, source.cadenceSteps), 0);
  const paidHim = world.material.obligations
    .filter((obligation) => obligation.active && obligation.recipientAccountId === purseId)
    .reduce((sum, obligation) => sum + perMonth(obligation.amount, obligation.cadenceSteps), 0);
  // A man under arms is paid by his army's chest.
  const serving = world.material.forces.some((force) => force.payObligationId !== null
    && (force.memberCharacterIds.includes(characterId) || (force.posts ?? []).some((post) => post.characterId === characterId)));
  const pay = serving ? LEGIONARY_PAY_GROSS * (1 - PAY_STOPPAGES_SHARE) : 0;
  return Math.round(income + paidHim + pay);
}

/** What a man goes out each month: everything his purse is bound to pay. */
export function monthlyOutgoingsOf(world: WorldState, purseId: string): number {
  return Math.round(world.material.obligations
    .filter((obligation) => obligation.active && obligation.payerAccountId === purseId)
    .reduce((sum, obligation) => sum + (obligation.cadenceSteps <= 0 ? 0 : (obligation.amount * 30) / obligation.cadenceSteps), 0));
}

// ── Loans offered ────────────────────────────────────────────────────────────

/** Below this a purse is low whatever it owes: a man cannot keep a household on less. */
const LOW_PURSE_FLOOR = 150;
/** Or below this many months of what it is bound to pay out. */
const LOW_PURSE_MONTHS = 2;
/** How many men offer at once. */
const MAX_LENDERS = 3;
/** A lender is a man who cares for money -- and has it. */
const LENDER_WEALTH_DRIVE = 60;
const LENDER_MIN_BALANCE = 500;
/** Of his own money, the most a lender puts in one man's hands. */
const LENDER_SHARE = 0.25;
/** Of what a man has coming in each month, and of what he could pledge. */
const INCOME_MULTIPLE = 3;
const COLLATERAL_SHARE = 0.5;
/** The going rate between private men: a per cent a month, more for a bad risk. */
const MIN_RATE_BPS = 100;
const MAX_RATE_BPS = 150;

/** A standing offer of a loan, which an order can take by its id. */
export interface LoanOffer {
  readonly id: string;
  readonly lenderId: string;
  readonly lenderName: string;
  readonly borrowerCharacterId: string;
  readonly borrowerAccountId: string;
  readonly amount: number;
  /** Interest a month, in basis points of what is still owed. */
  readonly interestBps: number;
  /** Monthly instalments it is paid back in. */
  readonly periods: number;
  /** An estate he would ask to have pledged for it, where the loan is more than the man's name will bear. */
  readonly collateralHoldingId: string | null;
}

/** The id an offer is taken by: stable for as long as the same man is offering the same man. */
export const loanOfferId = (lenderId: string, borrowerCharacterId: string): string => boundedId("loan-offer", lenderId, borrowerCharacterId);

/** Whether a man's purse is low enough that the men around him start offering. */
export function purseIsLow(world: WorldState, characterId: string): boolean {
  const man = world.characters.find((character) => character.id === characterId);
  const purse = world.material.accounts.find((account) => account.id === man?.personalAccountId);
  if (man === undefined || !man.alive || purse === undefined || purse.status !== "active") return false;
  return purse.balance < Math.max(LOW_PURSE_FLOOR, LOW_PURSE_MONTHS * monthlyOutgoingsOf(world, purse.id));
}

/**
 * Who would lend this man money now, and on what terms.
 *
 * Read off the world each time, never stored: an offer stands while the man
 * is short and the lender is rich and not hostile, and is gone when either
 * stops being true. Rich men of his own power who care for money offer --
 * up to three times what he has coming in a month, or half what he could
 * pledge, never more than a quarter of their own money -- at a per cent a
 * month or a little more, paid back over a year or two. A man who has let a
 * debt go unpaid is a worse risk and pays more; one who has defaulted is
 * offered nothing.
 */
export function loanOffersFor(world: WorldState, characterId: string): readonly LoanOffer[] {
  const man = world.characters.find((character) => character.id === characterId);
  if (man === undefined || man.polityId === null || man.personalAccountId === null || !purseIsLow(world, characterId)) return [];
  const purseId = man.personalAccountId;
  const defaulted = world.material.loans.some((loan) => loan.borrowerAccountId === purseId && loan.status === "defaulted");
  if (defaulted) return [];
  const missed = world.material.obligations.filter((obligation) => obligation.active && obligation.payerAccountId === purseId && obligation.missedPeriods > 0).length;
  const income = monthlyIncomeOf(world, characterId);
  // What he could pledge: his estates at what an estate sells for, and what he has in his ventures.
  const estates = world.material.holdings
    .filter((holding) => holding.legalHolderCharacterId === characterId)
    .map((holding) => ({ holding, value: (world.material.incomeSources.find((source) => source.id === holding.incomeSourceId)?.amount ?? 0) * ESTATE_PRICE_MONTHS }))
    .sort((a, b) => b.value - a.value || a.holding.id.localeCompare(b.holding.id));
  const ventures = world.material.ventures
    .filter((venture) => venture.ownerCharacterId === characterId && venture.status === "running")
    .reduce((sum, venture) => sum + (venture.cargo?.cost ?? 0), 0);
  const collateral = estates.reduce((sum, estate) => sum + estate.value, 0) + ventures;
  const byName = INCOME_MULTIPLE * income;
  const byPledge = Math.round(COLLATERAL_SHARE * collateral);
  const reach = Math.max(byName, byPledge);
  if (reach <= 0) return [];
  // Already in his debt to the lender: a man does not lend twice to one who owes him.
  const owesHim = (lenderId: string): boolean => world.material.loans.some((loan) => loan.status === "active" && loan.borrowerAccountId === purseId && loan.lenderKind === "character" && loan.lenderId === lenderId);
  const lenders = world.characters
    .filter((lender) => lender.alive && lender.id !== characterId && lender.polityId === man.polityId && lender.mind.drives.wealth >= LENDER_WEALTH_DRIVE)
    .filter((lender) => !lender.disqualifyingStatuses.includes("captured") && computeOpinion(lender, characterId) > -20 && !owesHim(lender.id))
    .map((lender) => ({ lender, purse: world.material.accounts.find((account) => account.id === lender.personalAccountId && account.status === "active") }))
    .filter((entry): entry is { lender: typeof entry.lender; purse: NonNullable<typeof entry.purse> } => entry.purse !== undefined && entry.purse.balance >= LENDER_MIN_BALANCE)
    .sort((a, b) => b.lender.mind.drives.wealth - a.lender.mind.drives.wealth || b.purse.balance - a.purse.balance || a.lender.id.localeCompare(b.lender.id))
    .slice(0, MAX_LENDERS);
  return lenders.map(({ lender, purse }) => {
    const amount = Math.max(1, Math.min(reach, Math.floor(purse.balance * LENDER_SHARE)));
    // The keener he is on money, the dearer; a man behind on his debts pays more.
    const rate = MIN_RATE_BPS + Math.round((lender.mind.drives.wealth - LENDER_WEALTH_DRIVE) / 2) + 10 * Math.min(3, missed) + (amount > byName ? 10 : 0);
    const periods = 12 + (stableHash([lender.id, characterId, "loan-term"]) % 13);
    return {
      id: loanOfferId(lender.id, characterId),
      lenderId: lender.id,
      lenderName: lender.name,
      borrowerCharacterId: characterId,
      borrowerAccountId: purseId,
      amount,
      interestBps: Math.max(MIN_RATE_BPS, Math.min(MAX_RATE_BPS, rate)),
      periods,
      collateralHoldingId: amount > byName ? estates[0]?.holding.id ?? null : null,
    };
  });
}

/** The offer an order names, if it still stands for this purse. */
export function standingLoanOffer(world: WorldState, offerId: string, borrowerAccountId: string): LoanOffer | undefined {
  const borrower = world.characters.find((character) => character.personalAccountId === borrowerAccountId);
  if (borrower === undefined) return undefined;
  return loanOffersFor(world, borrower.id).find((offer) => offer.id === offerId);
}

/** The offers, in the words the orchestrator and the player read them in. */
export function loanOfferLines(world: WorldState, characterId: string): readonly string[] {
  return loanOffersFor(world, characterId).map((offer) =>
    `${offer.lenderName} [${offer.lenderId}] would lend up to ${offer.amount} at ${(offer.interestBps / 100).toFixed(1)}% a month, repaid in ${offer.periods} monthly instalments${offer.collateralHoldingId === null ? "" : `, against ${offer.collateralHoldingId}`} (loan_open, offerId "${offer.id}").`);
}

/** How often the offers are said to him again: a season. */
const OFFERS_TOLD_EVERY_DAYS = 60;

/**
 * Word to a man whose purse is low that these men would lend to him -- once a
 * season, not every order: the offers stand in his TREASURY lines in between,
 * and an order taking one names it ("take Blasio's loan").
 */
export function loanOffersFact(world: WorldState, characterId: string, known: readonly { readonly kind: string; readonly atStep: number; readonly affectedEntities: readonly { readonly kind: string; readonly id: string }[] }[]): FactProposalDraft | null {
  const offers = loanOffersFor(world, characterId);
  if (offers.length === 0) return null;
  const toldLately = known.some((fact) => fact.kind === "loan_offered" && world.elapsedStep - fact.atStep < OFFERS_TOLD_EVERY_DAYS
    && fact.affectedEntities.some((ref) => ref.kind === "character" && ref.id === characterId));
  if (toldLately) return null;
  const who = offers.map((offer) => `${offer.lenderName} up to ${offer.amount} at ${(offer.interestBps / 100).toFixed(1)}% a month over ${offer.periods} months`).join("; ");
  return {
    localId: `loan_offered_${characterId}`.slice(0, 60),
    kind: "loan_offered",
    summary: `Word reaches him that his purse is known to be low, and that men would lend to him: ${who}.`.slice(0, 600),
    affectedRefs: [{ kind: "character", id: characterId }, ...offers.map((offer) => ({ kind: "character" as const, id: offer.lenderId }))],
    visibility: "private",
    discoveryState: "private",
    knowableInDays: 0,
    significance: 20,
    knownToRefs: [{ kind: "character", id: characterId }, ...offers.map((offer) => ({ kind: "character" as const, id: offer.lenderId }))],
  };
}

// ── Patrons and clients ──────────────────────────────────────────────────────

/** Of a patron's monthly income, what he hands each client: the sportula, a token that binds. */
export const PATRON_STIPEND_BPS = 200;
const STIPEND_LABEL = "Stipend from his patron";

/** A patron and his client, from the ties the world records either way round. */
export interface Clientage {
  readonly patronId: string;
  readonly clientId: string;
  readonly linkId: string;
}

/**
 * Every patron and client the world records.
 *
 * A tie held by S towards T of kind k says T is S's k (`knowledge/compare.ts`):
 * "patron" from a client to his patron, "client" from a patron to his client.
 */
export function clientages(world: WorldState): readonly Clientage[] {
  const seen = new Set<string>();
  const out: Clientage[] = [];
  for (const link of world.socialLinks) {
    if (link.kind !== "patron" && link.kind !== "client") continue;
    const patronId = link.kind === "patron" ? link.targetCharacterId : link.subjectCharacterId;
    const clientId = link.kind === "patron" ? link.subjectCharacterId : link.targetCharacterId;
    if (patronId === clientId || seen.has(`${patronId}>${clientId}`)) continue;
    seen.add(`${patronId}>${clientId}`);
    out.push({ patronId, clientId, linkId: link.id });
  }
  return out;
}

/** The stipend obligation a patron pays a client, if there is one standing. */
function stipendOf(world: WorldState, patronPurse: string, clientPurse: string): MoneyObligation | undefined {
  return world.material.obligations.find((obligation) => obligation.active && obligation.kind === "pension"
    && obligation.payerAccountId === patronPurse && obligation.recipientAccountId === clientPurse && obligation.label.startsWith(STIPEND_LABEL));
}

/**
 * Whether a man will take another as his client, decided by rule.
 *
 * He takes a man he does not dislike, who stands below him -- a client is
 * somebody's man, and a man as great as his patron is a rival -- and only if
 * he has the means to keep him. This is the seam for an order asking to be
 * taken on: the requests workstream answers such a request with this, and a
 * patron or client tie written by `social_events` is put to it the first
 * time the tick sees it (`keepPatronage`).
 */
export function patronWillTake(world: WorldState, patronId: string, clientId: string): { readonly willing: boolean; readonly reason: string } {
  const patron = world.characters.find((character) => character.id === patronId);
  const client = world.characters.find((character) => character.id === clientId);
  if (patron === undefined || client === undefined || !patron.alive || !client.alive) return { willing: false, reason: "one of them is dead" };
  if (patron.polityId === null || patron.polityId !== client.polityId) return { willing: false, reason: `${patron.name} takes clients only among his own people` };
  const opinion = computeOpinion(patron, clientId);
  if (opinion <= -10) return { willing: false, reason: `${patron.name} thinks ill of ${client.name}` };
  if (client.prestigeBps >= patron.prestigeBps) return { willing: false, reason: `${client.name} stands as high as ${patron.name}, and is nobody's client` };
  if (monthlyIncomeOf(world, patronId) <= 0) return { willing: false, reason: `${patron.name} has no income to keep clients on` };
  return { willing: true, reason: `${patron.name} takes ${client.name} as his client` };
}

/** Whether the client voted against his patron since the stipend began: on a question where they stood on opposite sides. */
function votedAgainst(world: WorldState, patronId: string, clientId: string, sinceStep: number): boolean {
  const latest = (supporterId: string): Map<string, string> => {
    const out = new Map<string, { position: string; at: number }>();
    for (const position of world.material.supportPositions) {
      if (position.supporterKind !== "character" || position.supporterId !== supporterId || position.changedAtStep < sinceStep) continue;
      const held = out.get(position.procedureId);
      if (held === undefined || position.changedAtStep >= held.at) out.set(position.procedureId, { position: position.position, at: position.changedAtStep });
    }
    return new Map([...out].map(([procedureId, entry]) => [procedureId, entry.position]));
  };
  const his = latest(patronId);
  const theirs = latest(clientId);
  for (const [procedureId, position] of theirs) {
    const patronSide = his.get(procedureId)
      ?? (world.material.politicalProcedures.some((procedure) => procedure.id === procedureId && (procedure.sponsorCharacterId === patronId || procedure.subjectId === patronId)) ? "support" : undefined);
    if (patronSide === undefined) continue;
    if ((patronSide === "support" && position === "oppose") || (patronSide === "oppose" && position === "support")) return true;
  }
  return false;
}

/**
 * A patron's stipend to each of his clients, kept by the month.
 *
 * Before the month's payments: a new tie is put to the patron (`patronWillTake`)
 * and either refused -- the tie is struck out -- or answered with a stipend of
 * a fiftieth of what the patron has coming in each month, paid like any other
 * pension. A client who voted against his patron loses both the stipend and
 * the tie; so does one whose patron has died.
 */
export function keepPatronage(world: WorldState, ids: IdFactory, atStep: number): { world: WorldState; facts: FactProposalDraft[] } {
  const pairs = clientages(world);
  const hasStipend = world.material.obligations.some((obligation) => obligation.kind === "pension" && obligation.label.startsWith(STIPEND_LABEL));
  if (pairs.length === 0 && !hasStipend) return { world, facts: [] };
  const facts: FactProposalDraft[] = [];
  const name = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? id;
  const purseOf = (id: string): string | null => world.characters.find((character) => character.id === id)?.personalAccountId ?? null;
  const struck = new Set<string>();
  const ended = new Set<string>();
  const opened: MoneyObligation[] = [];
  for (const pair of pairs) {
    const patronPurse = purseOf(pair.patronId);
    const clientPurse = purseOf(pair.clientId);
    if (patronPurse === null || clientPurse === null || patronPurse === clientPurse) continue;
    const standing = stipendOf(world, patronPurse, clientPurse);
    const patronAlive = world.characters.some((character) => character.id === pair.patronId && character.alive);
    if (standing !== undefined) {
      // Since the last stipend was due: a vote is answered at the next payment.
      const turned = votedAgainst(world, pair.patronId, pair.clientId, Math.max(0, standing.nextDueStep - standing.cadenceSteps));
      if (!patronAlive || turned) {
        ended.add(standing.id);
        struck.add(pair.linkId);
        if (turned) {
          facts.push({
            localId: `client_turned_${pair.clientId}`.slice(0, 60), kind: "clientage_ended",
            summary: `${name(pair.clientId)} voted against his patron ${name(pair.patronId)}, who will keep him no longer: the stipend is stopped.`,
            affectedRefs: [{ kind: "character", id: pair.clientId }, { kind: "character", id: pair.patronId }],
            visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 30,
          });
        }
      }
      continue;
    }
    const answer = patronWillTake(world, pair.patronId, pair.clientId);
    if (!answer.willing) {
      struck.add(pair.linkId);
      facts.push({
        localId: `client_refused_${pair.clientId}`.slice(0, 60), kind: "clientage_refused",
        summary: `${name(pair.patronId)} will not have ${name(pair.clientId)} as his client: ${answer.reason}.`,
        affectedRefs: [{ kind: "character", id: pair.clientId }, { kind: "character", id: pair.patronId }],
        visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 20,
      });
      continue;
    }
    const amount = Math.max(1, Math.round((monthlyIncomeOf(world, pair.patronId) * PATRON_STIPEND_BPS) / 10_000));
    opened.push({
      id: ids.next("obligation"), kind: "pension", label: `${STIPEND_LABEL}, ${name(pair.patronId)}`.slice(0, 120),
      payerAccountId: patronPurse, recipientAccountId: clientPurse, amount, cadenceSteps: 30, nextDueStep: atStep + 30,
      priority: 300, arrears: 0, missedPeriods: 0, active: true,
    });
    facts.push({
      localId: `client_taken_${pair.clientId}`.slice(0, 60), kind: "clientage_begun",
      summary: `${answer.reason}: ${amount} a month from his purse, and his voice when it is wanted.`,
      affectedRefs: [{ kind: "character", id: pair.clientId }, { kind: "character", id: pair.patronId }],
      visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 25,
    });
  }
  // A stipend whose tie is gone ends with it.
  const tied = new Set(pairs.filter((pair) => !struck.has(pair.linkId)).map((pair) => `${purseOf(pair.patronId)}>${purseOf(pair.clientId)}`));
  for (const obligation of world.material.obligations) {
    if (obligation.active && obligation.kind === "pension" && obligation.label.startsWith(STIPEND_LABEL) && !tied.has(`${obligation.payerAccountId}>${obligation.recipientAccountId}`)) ended.add(obligation.id);
  }
  if (struck.size === 0 && ended.size === 0 && opened.length === 0) return { world, facts };
  return {
    world: {
      ...world,
      socialLinks: world.socialLinks.filter((link) => !struck.has(link.id)),
      material: {
        ...world.material,
        obligations: [...world.material.obligations.map((obligation) => (ended.has(obligation.id) ? { ...obligation, active: false } : obligation)), ...opened],
      },
    },
    facts,
  };
}
