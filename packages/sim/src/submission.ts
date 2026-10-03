import {
  atWar,
  isDelivered,
  isStanding,
  leaderOf,
  stableHash,
  warStanding,
  type DiplomaticMessage,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";
import { endPolity } from "./polity-end";
import { addGrievance, hasGrievance, menUnderArms, trustOf } from "./treaties";

/**
 * An ally taken into the state (L15).
 *
 * The submission clause has always been able to end a power into another
 * (`carryOutClauses`), but whether an ally gave itself up was a model's whim:
 * a letter offering union was answered however the man reading it felt that
 * evening, a prose letter bound nothing, an ally with no named leader was
 * never asked at all, and silence settled nothing. Rome took Italy in by
 * treaty, by citizenship and by deditio, and each was a rule, not a mood. So:
 *
 *  - **Union by letter.** A foedus leader offering its follower union (a
 *    letter carrying a `submission` clause of the follower to the leader) is
 *    answered by `unionScore`: how weak the ally is beside its leader, how
 *    far it trusts it, how long it has followed it, whether it is offered the
 *    citizenship (an `undertaking` whose words say so), and what grievance it
 *    holds. The model writes the reply; the rule decides it.
 *  - **Unasked.** An ally nobody can answer for is answered by the rule the
 *    day the letter reaches it, and an offer left unanswered is decided by
 *    the rule on its day rather than lapsing into silence.
 *  - **Deditio.** A power beaten to nothing by the power it fights -- its
 *    last city taken, or an old ally's revolt broken -- gives itself up to it.
 *  - **The franchise.** A law giving allies the citizenship, full or without
 *    the vote, takes in those that will have it (`enact.ts`).
 */

/** At or above this an ally gives itself up to its leader. */
export const UNION_ACCEPTS_AT = 35;

export type FranchiseOffer = "none" | "sine_suffragio" | "citizenship";

const CITIZENSHIP_WORDS = /citizen|civitas|franchise|suffrag/i;
const WITHOUT_THE_VOTE = /sine suffragio|without (the )?vote|no vote/i;

/** What a letter offers the ally in return: the citizenship, without the vote, or nothing. */
export function franchiseOffered(message: Pick<DiplomaticMessage, "clauses" | "terms">, leaderPolityId: string): FranchiseOffer {
  const undertakings = (message.clauses ?? []).filter((clause) => clause.kind === "undertaking" && clause.byPolityId === leaderPolityId)
    .map((clause) => (typeof clause.what === "string" ? clause.what : ""));
  const words = [...undertakings, message.terms].join(" ");
  if (!CITIZENSHIP_WORDS.test(words)) return "none";
  return WITHOUT_THE_VOTE.test(words) ? "sine_suffragio" : "citizenship";
}

/** Whether this letter is a leader asking its own foedus ally to become one state with it. */
export function isUnionOffer(world: WorldState, message: Pick<DiplomaticMessage, "fromPolityId" | "toPolityId" | "clauses">): boolean {
  if (leaderOf(world.polityAgreements, message.toPolityId) !== message.fromPolityId) return false;
  return (message.clauses ?? []).some((clause) => clause.kind === "submission" && clause.polityId === message.toPolityId && clause.toPolityId === message.fromPolityId);
}

/** How willing an ally is to become one state with its leader, and why. */
export function unionScore(world: WorldState, follower: string, leader: string, offer: FranchiseOffer, seed: string): { readonly score: number; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  let score = 0;
  const theirs = menUnderArms(world, follower);
  const ours = Math.max(1, menUnderArms(world, leader));
  const ratio = theirs / ours;
  const weakness = ratio < 0.1 ? 20 : ratio < 0.25 ? 5 : -15;
  score += weakness;
  reasons.push(weakness > 0 ? `it could not stand against ${leader} alone (${theirs} men to ${ours})` : `it has men enough to stand on its own (${theirs} to ${ours})`);
  const trust = Math.round(trustOf(world, follower, leader) / 3);
  score += trust;
  if (trust !== 0) reasons.push(trust > 0 ? "it trusts its leader" : "it does not trust its leader");
  const foedus = world.polityAgreements.find((agreement) => agreement.status === "active" && agreement.kind === "foedus" && agreement.polityId === follower && agreement.otherPolityId === leader);
  const years = foedus === undefined ? 0 : Math.max(0, world.elapsedStep - foedus.sinceStep) / 365;
  const habit = Math.min(15, Math.floor(years * 2));
  if (habit > 0) { score += habit; reasons.push(`it has followed for ${Math.floor(years)} years`); }
  const offered = offer === "citizenship" ? 25 : offer === "sine_suffragio" ? 15 : 0;
  if (offered > 0) { score += offered; reasons.push(offer === "citizenship" ? "it is offered the full citizenship" : "it is offered the citizenship without the vote"); }
  if (hasGrievance(world, follower, leader)) {
    score -= 30;
    reasons.push("it holds a grievance against its leader");
  }
  score += (stableHash(["union", follower, leader, seed]) % 11) - 5;
  return { score, reasons };
}

export interface UnionVerdict {
  readonly answer: "accepted" | "refused";
  readonly follower: string;
  readonly leader: string;
  /** In the engine's words: why. Appended to the model's reply, or the whole reply where nobody wrote one. */
  readonly why: string;
}

/** The rule's answer to a union offer, or null where the letter is not one. */
export function unionVerdict(world: WorldState, message: DiplomaticMessage): UnionVerdict | null {
  if (!isUnionOffer(world, message)) return null;
  const follower = message.toPolityId;
  const leader = message.fromPolityId;
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const judged = unionScore(world, follower, leader, franchiseOffered(message, leader), message.id);
  const answer = judged.score >= UNION_ACCEPTS_AT ? "accepted" as const : "refused" as const;
  const because = judged.reasons.join("; ").replaceAll(leader, name(leader));
  return {
    answer, follower, leader,
    why: answer === "accepted"
      ? `${name(follower)} will be one state with ${name(leader)}: ${because}.`
      : `${name(follower)} will keep its own laws: ${because}.`,
  };
}

/**
 * What the answer does: an ally that accepts is one state with its leader --
 * whether or not the letter also offered an agreement for its clauses to ride
 * on, since a letter of union bound nothing when it offered none -- and a
 * refusal is remembered by the leader that asked: an ally that will not be
 * taken in has said what it thinks of being ruled.
 */
export function carryOutUnion(world: WorldState, verdict: UnionVerdict, atStep: number, emit: (fact: FactProposalDraft) => void): WorldState {
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  if (verdict.answer === "refused") return addGrievance(world, verdict.leader, verdict.follower, `${name(verdict.follower)} refused to be one state with it`, atStep);
  const follower = world.map.polities.find((polity) => polity.id === verdict.follower);
  if (follower === undefined || !isStanding(follower)) return world;
  const ended = endPolity(world, verdict.follower, "absorbed", verdict.leader, atStep, true);
  for (const fact of ended.facts) emit(fact);
  return ended.world;
}

/**
 * Union offers the tick settles by rule: those to an ally nobody can answer
 * for, the day they arrive, and those whose answer is due and has not come.
 * Run before silence is counted, so an offer is never "refused by silence".
 */
export function settleUnionOffers(world: WorldState, toDay: number, facts: FactProposalDraft[]): WorldState {
  let next = world;
  for (const message of world.diplomacy) {
    if (message.status !== "awaiting_reply" || !isDelivered(message, toDay)) continue;
    const unaskable = message.toCharacterId === null || !next.characters.some((character) => character.id === message.toCharacterId && character.alive);
    const due = message.replyDueByStep !== null && message.replyDueByStep <= toDay;
    if (!unaskable && !due) continue;
    const current = next.diplomacy.find((candidate) => candidate.id === message.id);
    if (current === undefined || current.status !== "awaiting_reply") continue;
    const verdict = unionVerdict(next, current);
    if (verdict === null) continue;
    const follower = next.map.polities.find((polity) => polity.id === verdict.follower);
    if (follower === undefined || !isStanding(follower)) continue;
    next = {
      ...next,
      diplomacy: next.diplomacy.map((candidate) => (candidate.id === message.id
        ? { ...candidate, status: "answered" as const, answer: verdict.answer, answerText: verdict.why.slice(0, 1_200), answeredAtStep: toDay }
        : candidate)),
    };
    facts.push({
      localId: `union_${message.id}`.slice(0, 60),
      kind: "letter_answered",
      summary: verdict.why.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: verdict.follower }, { kind: "polity", id: verdict.leader }],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 55,
    });
    next = carryOutUnion(next, verdict, toDay, (fact) => facts.push(fact));
  }
  return next;
}

/**
 * Deditio: a power beaten by the one it fights gives itself up to it, rather
 * than waiting two months to be counted extinct. Its last city taken by a
 * power at war with it that dictates the peace, or -- an ally that rose
 * against its old leader and is beaten -- the revolt is over and it is
 * taken in. Never the player's own power: his surrender is his to make.
 */
export function deditio(world: WorldState, toDay: number, playerPolityId: string | null): { world: WorldState; facts: FactProposalDraft[] } {
  let next = world;
  const facts: FactProposalDraft[] = [];
  const holderOf = (settlementId: string | null): string | null => settlementId === null ? null
    : next.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === settlementId)?.controllerPolityId ?? null;
  for (const polity of world.map.polities) {
    if (polity.id === playerPolityId) continue;
    const current = next.map.polities.find((candidate) => candidate.id === polity.id);
    if (current === undefined || !isStanding(current)) continue;
    const enemies = next.polityAgreements
      .filter((agreement) => agreement.status === "active" && agreement.kind === "war" && (agreement.polityId === polity.id || agreement.otherPolityId === polity.id))
      .map((agreement) => (agreement.polityId === polity.id ? agreement.otherPolityId : agreement.polityId));
    const victor = enemies.find((enemy) => {
      if (!atWar(next.polityAgreements, enemy, polity.id) || !warStanding(next, enemy, polity.id).dictates) return false;
      const landed = next.map.provinces.some((province) => province.controllerPolityId === polity.id
        || province.settlements.some((settlement) => settlement.controllerPolityId === polity.id));
      // An army still in the field is a government in exile, and fights on (`polity-end.ts`).
      const armed = next.material.forces.some((force) => force.polityId === polity.id && force.personnel.some((group) => group.fit > 0));
      const cityTaken = !landed && !armed && current.capitalSettlementId !== null && holderOf(current.capitalSettlementId) === enemy;
      const oldAlly = next.polityAgreements.some((agreement) => agreement.kind === "foedus" && agreement.status === "ended" && agreement.polityId === polity.id && agreement.otherPolityId === enemy);
      return cityTaken || oldAlly;
    });
    if (victor === undefined) continue;
    const ended = endPolity(next, polity.id, "absorbed", victor, toDay, false);
    next = ended.world;
    facts.push(...ended.facts.map((fact) => ({ ...fact, localId: `deditio_${polity.id}`.slice(0, 60), kind: "deditio" })));
  }
  return { world: next, facts };
}

/**
 * A law giving allies the citizenship: each named ally that follows the power
 * by foedus decides by the same rule, with the franchise on the table, and
 * those that will have it are taken in. Returns what was said of it.
 */
export function grantFranchise(
  world: WorldState,
  polityId: string,
  polityIds: readonly string[],
  status: "citizenship" | "sine_suffragio",
  atStep: number,
  seed: string,
): { world: WorldState; facts: FactProposalDraft[]; said: string[] } {
  let next = world;
  const facts: FactProposalDraft[] = [];
  const joined: string[] = [];
  const declined: string[] = [];
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  for (const ally of polityIds) {
    const polity = next.map.polities.find((candidate) => candidate.id === ally);
    if (polity === undefined || !isStanding(polity) || leaderOf(next.polityAgreements, ally) !== polityId) continue;
    const judged = unionScore(next, ally, polityId, status, seed);
    if (judged.score >= UNION_ACCEPTS_AT) {
      const ended = endPolity(next, ally, "absorbed", polityId, atStep, true);
      next = ended.world;
      facts.push(...ended.facts);
      joined.push(name(ally));
    } else {
      declined.push(name(ally));
    }
  }
  const what = status === "citizenship" ? "the citizenship" : "the citizenship without the vote";
  const said = [
    ...(joined.length === 0 ? [] : [`${joined.join(", ")} took ${what} and are one state with ${name(polityId)}`]),
    ...(declined.length === 0 ? [] : [`${declined.join(", ")} would not give up their own laws for ${what}`]),
  ];
  return { world: next, facts, said };
}
