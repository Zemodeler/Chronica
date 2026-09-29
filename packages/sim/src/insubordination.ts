import {
  activeDepartments,
  computeOpinion,
  decideOrderAttempt,
  deriveRelationDimension,
  deriveReputation,
  honestyOf,
  leaning,
  receiveOrderAttempt,
  stableHash,
  type Character,
  type FactProposalDraft,
  type OrderAttempt,
  type OrderAttemptDecision,
  type WorldState,
} from "@chronica/shared";
import { remember, teach, type Grievance } from "./grievances";

/**
 * Whether a man handed an order will carry it out (docs/plans/departments.md
 * §8, insubordination).
 *
 * Refusing an order was the model's to decide, and the model decides the way
 * the situation suggests: a legate who loathes his consul, whose faction the
 * order hurts and whom nothing binds, accepted as readily as a devoted client.
 * The engine now decides a share of it. Before a man is asked, his loyalty to
 * the one giving it, his fear of him, his sense of duty and his conscience,
 * his own ambition and his faction's say whether he will not -- and if he will
 * not, the answer is his temperament's: an honest man refuses to your face, a
 * liar agrees and does otherwise, a careful man finds reasons to wait. The
 * rest, which is most orders, the man himself answers as before.
 *
 * Decided at the moment the order is given, never after the man has answered:
 * a man who has said yes has already done the thing, in the same breath.
 */

/** Never more than this: the engine takes a share of the decision, never all of it. */
const MAX_DEFIANCE_BPS = 6_000;
/** Below this it is not worth rolling: an ordinary man does as he is told. */
const MIN_DEFIANCE_BPS = 300;

export interface Defiance {
  readonly chanceBps: number;
  readonly answer: Exclude<OrderAttemptDecision, "accept" | "ignore">;
  /** Why, in words the man's commander would be given. */
  readonly why: string;
}

function holdsSalariedPost(world: WorldState, characterId: string): boolean {
  const offices = new Set(world.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId === characterId).map((seat) => seat.officeId));
  return activeDepartments(world).some((department) => department.pay === "salaried"
    && (department.officeIds.some((id) => offices.has(id)) || (department.headOfficeId !== null && offices.has(department.headOfficeId))));
}

/** The faction he belongs to, if its leader is at odds with the man giving the order. */
function factionAgainst(world: WorldState, recipient: Character, issuerId: string): string | null {
  for (const membership of world.material.groupMemberships) {
    if (membership.characterId !== recipient.id || membership.leftAtStep !== null) continue;
    const group = world.material.politicalGroups.find((candidate) => candidate.id === membership.groupId && candidate.active);
    if (group?.leaderCharacterId == null || group.leaderCharacterId === issuerId || group.leaderCharacterId === recipient.id) continue;
    const leader = world.characters.find((character) => character.id === group.leaderCharacterId);
    if (leader !== undefined && computeOpinion(leader, issuerId) <= -25) return group.name;
  }
  return null;
}

/**
 * How likely this man is to refuse this order, and how he would do it. Null
 * where he would simply do as he is told, or where it is not the engine's to
 * say: a man with no standing to command him is the man's own affair.
 */
export function defianceOf(world: WorldState, attempt: OrderAttempt): Defiance | null {
  if (attempt.standing === "presumptuous") return null;
  if (attempt.issuerRef.kind !== "character" || attempt.recipientRef.kind !== "character") return null;
  const recipient = world.characters.find((character) => character.id === attempt.recipientRef.id && character.alive);
  const issuer = world.characters.find((character) => character.id === attempt.issuerRef.id);
  if (recipient === undefined || issuer === undefined || recipient.id === issuer.id) return null;

  const opinion = computeOpinion(recipient, issuer.id);
  const fear = deriveRelationDimension(recipient, issuer.id, "fear");
  const { duty, status } = recipient.mind.drives;
  const honesty = honestyOf(recipient);
  const reasons: string[] = [];
  let chance = 0;
  if (opinion < 0) {
    chance += -opinion * 60;
    if (opinion <= -25) reasons.push(`he has no love for ${issuer.name}`);
  }
  // Fear keeps a man in line that nothing else would.
  if (fear > 0) chance -= fear * 40;
  chance -= (duty - 50) * 40 + leaning(recipient, "obligation") * 100;
  if (honesty < 50) chance += (50 - honesty) * 20;
  // An ambitious man serving a rival in his own city does not help him shine.
  if (status > 60 && recipient.polityId !== null && recipient.polityId === issuer.polityId) {
    chance += (status - 60) * 30 + leaning(recipient, "status") * 30;
    if (status >= 75) reasons.push("he means to rise, and not by another man's triumphs");
  }
  const faction = factionAgainst(world, recipient, issuer.id);
  if (faction !== null) {
    chance += 1_500;
    reasons.push(`${faction}, whom he follows, stands against ${issuer.name}`);
  }
  if (holdsSalariedPost(world, recipient.id)) chance -= 800;
  // A man well spoken of is obeyed more readily than one nobody trusts.
  chance -= deriveReputation(world, issuer.id) * 20;
  // Declining a request is easier than defying a command.
  if (attempt.standing === "requested") chance += 1_000;
  chance = Math.max(0, Math.min(MAX_DEFIANCE_BPS, Math.round(chance)));
  if (chance < MIN_DEFIANCE_BPS) return null;

  const { caution } = recipient.mind.temperament;
  const answer: Defiance["answer"] = honesty >= 60 || duty >= 70 ? "refuse"
    : honesty <= 35 ? "subvert"
      : caution >= 60 ? "delay"
        : opinion <= -40 ? "refuse" : "delay";
  const why = reasons.length > 0 ? reasons.join(", and ") : attempt.standing === "requested" ? "he did not care to" : "it did not suit him";
  return { chanceBps: chance, answer, why };
}

const VERB: Readonly<Record<Defiance["answer"], string>> = {
  refuse: "would not do as",
  delay: "has put off doing as",
  subvert: "seemed to agree with, and did otherwise than",
};

/**
 * Every order just given, answered by the man's own temper where it decides
 * it; the rest are left for him to answer. Idempotent: the roll is the
 * order's own, so asking twice gives the same answer.
 */
export function answerByTemper(world: WorldState, playerIds: readonly string[]): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let next = world;
  for (const attempt of world.orderAttempts) {
    if (attempt.status !== "issued" || playerIds.includes(attempt.recipientRef.id)) continue;
    const defiance = defianceOf(next, attempt);
    if (defiance === null || stableHash([attempt.id, "defiance"]) % 10_000 >= defiance.chanceBps) continue;
    const decided = decideOrderAttempt(receiveOrderAttempt(attempt), defiance.answer, `${defiance.why}.`.slice(0, 400), next.elapsedStep);
    next = { ...next, orderAttempts: next.orderAttempts.map((candidate) => (candidate.id === attempt.id ? decided : candidate)) };
    const who = (id: string): string => next.characters.find((character) => character.id === id)?.name ?? id;
    const subverted = decided.status === "subverted";
    facts.push({
      localId: `temper_${attempt.id}`.slice(0, 60),
      kind: `order_${decided.status}`,
      summary: `${who(attempt.recipientRef.id)} ${VERB[defiance.answer]} ${who(attempt.issuerRef.id)} asked (${attempt.instruction.slice(0, 200)}): ${defiance.why}.`,
      affectedRefs: [attempt.issuerRef, attempt.recipientRef],
      visibility: subverted ? "private" : "polity",
      discoveryState: subverted ? "private" : "polity",
      knowableInDays: 0,
      knownToRefs: subverted ? [attempt.recipientRef] : [attempt.issuerRef, attempt.recipientRef],
      significance: subverted ? 60 : attempt.standing === "binding" ? 55 : 40,
    });
    next = answered(next, decided);
  }
  return { world: next, facts };
}

/**
 * What a defied order does to the two men in it. The man refused thinks less
 * of the one who refused him; the one who refused, and got away with it, is
 * less afraid of him than he was -- and a little bolder for it.
 */
function answered(world: WorldState, decided: OrderAttempt): WorldState {
  const issuer = decided.issuerRef.id;
  const recipient = decided.recipientRef.id;
  const binding = decided.standing === "binding";
  const grievances: Grievance[] = decided.status === "refused"
    ? [
      { subjectCharacterId: issuer, targetCharacterId: recipient, label: binding ? "He refused me outright." : "He would not do it.", score: binding ? -12 : -5, dimensions: binding ? { trust: -14, respect: -8 } : { affection: -6 }, decayPerYearBps: 1_500 },
      { subjectCharacterId: recipient, targetCharacterId: issuer, label: "I refused him, and am none the worse for it.", score: -3, dimensions: { fear: -8, affection: -4 }, decayPerYearBps: 1_500 },
    ]
    : decided.status === "delayed"
      ? [{ subjectCharacterId: issuer, targetCharacterId: recipient, label: "He is taking his time about it.", score: -3, dimensions: { trust: -4 }, decayPerYearBps: 1_500 }]
      : [{ subjectCharacterId: recipient, targetCharacterId: issuer, label: "I agreed to his face and did otherwise.", score: -10, dimensions: { trust: -12, respect: -6, fear: -6 }, decayPerYearBps: 1_500 }];
  const remembered = remember(world, grievances, world.elapsedStep, `${decided.id}:temper`);
  return decided.status === "delayed" ? remembered : teach(remembered, recipient, "defied", world.elapsedStep);
}
