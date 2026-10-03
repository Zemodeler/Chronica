import {
  isActive,
  type AuthorityCheckResult,
  type AuthorityGrant,
  type AuthorityScope,
  type Enactment,
  type Office,
  type OrderPartyRef,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";

/**
 * Money a chamber voted, and the man who may spend it.
 *
 * A carried budget used to make a display record and nothing else: the
 * Senate voted 5,000 for transports, and when the consul went to hire them
 * the hire was refused because "he engaged a man on money that was not his to
 * promise". Nobody had been given the money; it had only been approved. Now
 * the vote is a grant: the man it names (or the holder of the office it
 * names, or its sponsor) may spend from that account for a year, up to the
 * sum voted and no further, and every coin spent under it is counted.
 */

/** How long a vote of money stands: a magistrate's year. */
export const BUDGET_DAYS = 365;

/** Who a measure says spends its money, resolved the day it is put. */
export function budgetHolderOf(
  world: WorldState,
  holderRef: string | null | undefined,
  resolve: (ref: string) => string | undefined,
  offices: readonly Office[],
): { holderCharacterId?: string; holderOfficeId?: string } {
  if (holderRef == null) return {};
  const id = resolve(holderRef) ?? holderRef;
  if (world.characters.some((character) => character.id === id)) return { holderCharacterId: id };
  if (offices.some((office) => office.id === id)) return { holderOfficeId: id };
  return {};
}

/** The grant a carried budget makes, or null where it names nobody who can hold it. */
export function grantForBudget(
  world: WorldState,
  enactment: Pick<Enactment, "procedureId" | "polityId" | "budget">,
  sponsorCharacterId: string | null,
  atStep: number,
): AuthorityGrant | null {
  const budget = enactment.budget;
  if (budget == null) return null;
  const officeHolder = budget.holderOfficeId == null ? null
    : world.material.officeSeats.find((seat) => seat.officeId === budget.holderOfficeId && seat.status === "held" && seat.holderCharacterId !== null)?.holderCharacterId ?? null;
  const holderId = budget.holderCharacterId ?? officeHolder ?? sponsorCharacterId;
  if (holderId == null || !world.characters.some((character) => character.id === holderId && character.alive)) return null;
  return {
    id: `law:${enactment.procedureId}:budget`.slice(0, 120),
    holder: { kind: "character", id: holderId },
    source: "law",
    sourceRef: enactment.procedureId,
    domain: "fiscal",
    scope: { kind: "account", id: budget.accountId },
    powers: ["spend"],
    standing: "lawful",
    legitimacyBps: 10_000,
    visibility: "public",
    grantedAtStep: atStep,
    expiresAtStep: atStep + BUDGET_DAYS,
    revokedAtStep: null,
    revocationReason: null,
    succeedsGrantId: null,
    ...(budget.amount === null ? {} : { cap: { amount: budget.amount, spent: 0 } }),
  };
}

/**
 * What an act commits from the account it is judged against, where the act
 * itself says: a payment, a hire for its whole term. Anything else is counted
 * by what left the account (`chargeVotedBudget`).
 */
function committedBy(delta: WorldDelta, grant: AuthorityGrant): number {
  switch (delta.op) {
    case "money_transfer":
      return delta.amount;
    case "service_contract_open": {
      const days = delta.termDays ?? Math.max(30, (grant.expiresAtStep ?? grant.grantedAtStep + BUDGET_DAYS) - grant.grantedAtStep);
      return delta.advance + delta.monthlyPay * Math.max(1, Math.ceil(days / 30));
    }
    default:
      return 0;
  }
}

const remainingOf = (grant: AuthorityGrant): number => (grant.cap === undefined ? Number.POSITIVE_INFINITY : grant.cap.amount - grant.cap.spent);

/**
 * The authority check, with the money voted counted.
 *
 * A vote's grant is fiscal, and buying a man's grain for the army or paying
 * for a work is judged in the army's or the works' domain; the money is the
 * same money, so a grant over the account covers any act charged to it. And a
 * grant spent down is no grant for more than is left.
 */
export function withinVotedBudget(
  authority: AuthorityCheckResult,
  world: WorldState,
  actorRef: OrderPartyRef,
  scope: AuthorityScope,
  delta: WorldDelta,
): AuthorityCheckResult {
  const live = (grant: AuthorityGrant | null | undefined): AuthorityGrant | undefined =>
    grant == null ? undefined : world.authorityGrants.find((candidate) => candidate.id === grant.id && isActive(candidate, world.elapsedStep));
  const voted = live(authority.grant) ?? (authority.authorized || scope.kind !== "account" ? undefined
    : world.authorityGrants.find((grant) => grant.cap !== undefined && grant.source === "law" && isActive(grant, world.elapsedStep)
      && grant.holder.kind === actorRef.kind && grant.holder.id === actorRef.id && grant.scope.kind === "account" && grant.scope.id === scope.id
      && grant.cap.spent < grant.cap.amount));
  if (voted?.cap === undefined) return authority;
  const wanted = committedBy(delta, voted);
  const left = remainingOf(voted);
  if (wanted > left) {
    return {
      authorized: false, grant: null, standing: null,
      reason: `The vote (${voted.sourceRef ?? voted.id}) gave ${voted.cap.amount} and ${voted.cap.spent} of it is spent: ${wanted} is more than the ${left} left.`,
    };
  }
  return { authorized: true, grant: voted, standing: voted.standing, reason: `Authorized by the money voted under ${voted.sourceRef ?? voted.id} (${left} of ${voted.cap.amount} left).` };
}

/** Counts what an act spent under a vote of money: what it committed, or what left the account, whichever is more. */
export function chargeVotedBudget(before: WorldState, after: WorldState, authority: AuthorityCheckResult, delta: WorldDelta): WorldState {
  const grant = authority.grant === null ? undefined : after.authorityGrants.find((candidate) => candidate.id === authority.grant!.id);
  if (grant?.cap === undefined || grant.scope.kind !== "account") return after;
  const balance = (world: WorldState): number => world.material.accounts.find((account) => account.id === grant.scope.id)?.balance ?? 0;
  const spent = Math.max(committedBy(delta, grant), balance(before) - balance(after));
  if (spent <= 0) return after;
  return {
    ...after,
    authorityGrants: after.authorityGrants.map((candidate) => (candidate.id === grant.id && candidate.cap !== undefined
      ? { ...candidate, cap: { ...candidate.cap, spent: Math.min(candidate.cap.amount, candidate.cap.spent + spent) } }
      : candidate)),
  };
}
