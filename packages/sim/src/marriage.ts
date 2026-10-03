import {
  computeOpinion,
  currentAgeYears,
  familyLinksOf,
  isDelivered,
  marriageBar,
  MARRIAGE_AGE,
  stableHash,
  type Character,
  type DiplomaticMessage,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";
import { remember } from "./grievances";
import type { IdFactory } from "./ports";

/**
 * Marrying into a house (play-test L10).
 *
 * "marriage_offer" was a kind of letter and nothing else: answered by whoever
 * the model asked, accepted in words, and nobody was married by it. A man
 * could not marry into the nobility, and a house had no way to an heir but
 * the model inventing one. Now an offer of marriage is answered by rule, by
 * the man whose daughter it asks for -- by the suitor's standing, his money,
 * his side and what the father thinks of him -- and an acceptance makes the
 * marriage: the tie, the dowry from the bride's father, a step up in standing
 * for the lesser house, and the two heads of house bound by it. Children
 * follow from `births.ts`.
 */

/** Of the bride's father's purse, the dowry he gives with her. */
export const DOWRY_SHARE = 0.15;
/** What the lesser house gains by the match, at most: half the distance between them, and no more than this. */
const MATCH_STANDING_BPS = 400;
/** Below this the father refuses. */
const WILLING_AT = 0;

/** The two to be married, and who answers for each side. */
interface Match {
  readonly groom: Character;
  readonly bride: Character;
  /** Who gives the bride: her father, or the bride herself where she has none. */
  readonly giver: Character;
  /** Who asks: the suitor himself, or the father asking for his son. */
  readonly asker: Character;
}

const living = (world: WorldState, id: string | null): Character | undefined => (id === null ? undefined : world.characters.find((character) => character.id === id && character.alive));

/** Someone of this house it could be: named in the letter where he or she is, else the eldest who may marry. */
function marriageableOf(world: WorldState, parentId: string, gender: Character["gender"], text: string): Character | undefined {
  const children = familyLinksOf(world, parentId, world.elapsedStep)
    .filter((view) => view.kind === "parent")
    .map((view) => living(world, view.counterpartCharacterId))
    .filter((child): child is Character => child !== undefined && child.gender === gender && currentAgeYears(child, world.elapsedStep) >= MARRIAGE_AGE[gender])
    .filter((child) => !familyLinksOf(world, child.id, world.elapsedStep).some((view) => view.kind === "spouse_or_partner" && living(world, view.counterpartCharacterId) !== undefined))
    .sort((a, b) => currentAgeYears(b, world.elapsedStep) - currentAgeYears(a, world.elapsedStep) || a.id.localeCompare(b.id));
  const lower = text.toLowerCase();
  return children.find((child) => lower.includes(child.name.toLowerCase().split(" ")[0]!)) ?? children[0];
}

const unwed = (world: WorldState, person: Character): boolean => !familyLinksOf(world, person.id, world.elapsedStep).some((view) => view.kind === "spouse_or_partner" && living(world, view.counterpartCharacterId) !== undefined);
const ofAge = (world: WorldState, person: Character): boolean => currentAgeYears(person, world.elapsedStep) >= MARRIAGE_AGE[person.gender];
const fatherOf = (world: WorldState, person: Character): Character | undefined => familyLinksOf(world, person.id, world.elapsedStep)
  .filter((view) => view.kind === "child")
  .map((view) => living(world, view.counterpartCharacterId))
  .find((parent): parent is Character => parent !== undefined && parent.gender === "male");

/**
 * Who is to marry whom, from who wrote and who was written to: a man asking
 * for the recipient's daughter (or for the recipient herself), a father
 * offering his daughter to the recipient, or a father asking the recipient's
 * daughter for his son.
 */
export function matchOf(world: WorldState, message: Pick<DiplomaticMessage, "fromCharacterId" | "toCharacterId" | "subject" | "terms">): Match | null {
  const sender = living(world, message.fromCharacterId);
  const recipient = living(world, message.toCharacterId);
  if (sender === undefined || recipient === undefined) return null;
  const text = `${message.subject} ${message.terms}`;
  // He asks for her, or for a daughter of the house.
  if (sender.gender === "male" && ofAge(world, sender) && unwed(world, sender)) {
    if (recipient.gender === "female" && ofAge(world, recipient) && unwed(world, recipient)) return { groom: sender, bride: recipient, giver: fatherOf(world, recipient) ?? recipient, asker: sender };
    const daughter = marriageableOf(world, recipient.id, "female", text);
    if (daughter !== undefined) return { groom: sender, bride: daughter, giver: recipient, asker: sender };
  }
  // A father offers his daughter to a man who may marry.
  const offered = marriageableOf(world, sender.id, "female", text);
  if (offered !== undefined && recipient.gender === "male" && ofAge(world, recipient) && unwed(world, recipient)) return { groom: recipient, bride: offered, giver: sender, asker: recipient };
  // Or asks the recipient's daughter for his son.
  const son = marriageableOf(world, sender.id, "male", text);
  const theirs = marriageableOf(world, recipient.id, "female", text);
  if (son !== undefined && theirs !== undefined) return { groom: son, bride: theirs, giver: recipient, asker: sender };
  return null;
}

const purseOf = (world: WorldState, person: Character): number => world.material.accounts.find((account) => account.id === person.personalAccountId)?.balance ?? 0;
const groupsOf = (world: WorldState, id: string): Set<string> => new Set(world.material.groupMemberships.filter((membership) => membership.characterId === id && membership.leftAtStep === null).map((membership) => membership.groupId));

/**
 * Whether the bride's house will have the match, and why: by rule, from the
 * suitor's standing against the father's, his money, whether he is of the
 * father's party and his people, and what the father thinks of him. A hash on
 * the pair breaks the even cases, so the same suit is answered the same way.
 */
export function willingnessToWed(world: WorldState, match: Match): { readonly score: number; readonly reasons: readonly string[] } {
  // Who decides is whoever was written to; whose house the suitor is weighed by is the asking side.
  const decider = match.giver.id === match.asker.id ? match.groom : match.giver;
  const suitor = match.asker;
  const reasons: string[] = [];
  let score = 0;
  const standing = Math.round((suitor.prestigeBps - decider.prestigeBps) / 200);
  score += standing;
  if (standing <= -5) reasons.push(`${suitor.name} stands well below ${decider.name}`);
  else if (standing >= 5) reasons.push(`${suitor.name} stands above ${decider.name}`);
  const theirs = purseOf(world, suitor);
  const his = Math.max(1, purseOf(world, decider));
  const wealth = Math.max(-15, Math.min(15, Math.round((theirs / his - 0.5) * 20)));
  score += wealth;
  if (wealth >= 5) reasons.push(`${suitor.name} is rich`);
  else if (wealth <= -5) reasons.push(`${suitor.name} has little`);
  if (suitor.polityId !== decider.polityId) { score -= 30; reasons.push("he is a foreigner"); }
  const shared = [...groupsOf(world, suitor.id)].some((group) => groupsOf(world, decider.id).has(group));
  if (shared) { score += 10; reasons.push("they stand together in politics"); }
  const opinion = computeOpinion(decider, suitor.id);
  score += Math.round(opinion / 2);
  if (opinion >= 10) reasons.push(`${decider.name} thinks well of him`);
  else if (opinion <= -10) reasons.push(`${decider.name} thinks ill of him`);
  score += (stableHash([match.groom.id, match.bride.id, "match"]) % 11) - 5;
  return { score, reasons };
}

/**
 * Every offer of marriage that has reached a man the model is not playing for
 * the player, answered by rule. Accepted, the two are married that day, the
 * bride goes to her husband's house, the dowry is paid, and the houses are
 * bound; refused, the letter says why.
 */
export function answerMarriageOffers(world: WorldState, ids: IdFactory, toDay: number, playerCharacterId: string | null): { world: WorldState; facts: FactProposalDraft[] } {
  const due = world.diplomacy.filter((message) => message.kind === "marriage_offer" && message.status === "awaiting_reply" && message.toCharacterId !== null
    && message.toCharacterId !== playerCharacterId && isDelivered(message, toDay));
  if (due.length === 0) return { world, facts: [] };
  const facts: FactProposalDraft[] = [];
  let next = world;
  for (const message of due) {
    const match = matchOf(next, message);
    const barred = match === null ? "there is nobody in the house to marry" : marriageBar(next, match.groom.id, match.bride.id);
    const answerOf = (answer: "accepted" | "refused", text: string): WorldState => ({
      ...next,
      diplomacy: next.diplomacy.map((candidate) => (candidate.id === message.id ? { ...candidate, status: "answered" as const, answer, answerText: text.slice(0, 1_200), answeredAtStep: toDay } : candidate)),
    });
    const sender = next.characters.find((character) => character.id === message.fromCharacterId)?.name ?? "the sender";
    const recipient = next.characters.find((character) => character.id === message.toCharacterId)?.name ?? "the house";
    if (match === null || barred !== null) {
      next = answerOf("refused", `No marriage can come of it: ${barred}.`);
      facts.push({
        localId: `marriage_refused_${message.id}`.slice(0, 60), kind: "marriage_refused",
        summary: `${recipient} answers ${sender}'s offer of marriage: no marriage can come of it, for ${barred}.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: message.fromCharacterId }, { kind: "character", id: message.toCharacterId! }],
        visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 20,
      });
      continue;
    }
    const verdict = willingnessToWed(next, match);
    const why = verdict.reasons.length === 0 ? "" : ` (${verdict.reasons.join("; ")})`;
    if (verdict.score < WILLING_AT) {
      next = answerOf("refused", `${recipient} will not give ${match.bride.name} to ${match.groom.name}${why}.`);
      facts.push({
        localId: `marriage_refused_${message.id}`.slice(0, 60), kind: "marriage_refused",
        summary: `${recipient} has refused the match between ${match.groom.name} and ${match.bride.name}${why}.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: match.groom.id }, { kind: "character", id: match.bride.id }, { kind: "character", id: match.giver.id }],
        visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 25,
      });
      continue;
    }
    next = answerOf("accepted", `${recipient} gives ${match.bride.name} to ${match.groom.name}${why}.`);
    next = wed(next, match, ids, toDay, facts);
  }
  return { world: next, facts };
}

/** The marriage itself: the tie, her going to his house, the dowry, the standing, and the houses bound. */
function wed(world: WorldState, match: Match, ids: IdFactory, atStep: number, facts: FactProposalDraft[]): WorldState {
  const { groom, bride, giver } = match;
  const fromPurse = world.material.accounts.find((account) => account.id === giver.personalAccountId && account.status === "active");
  const toPurse = world.material.accounts.find((account) => account.id === groom.personalAccountId && account.status === "active");
  const dowry = fromPurse === undefined || toPurse === undefined || fromPurse.id === toPurse.id ? 0 : Math.floor(fromPurse.balance * DOWRY_SHARE);
  // The lesser house rises by the match: the groom's, or the bride's father's.
  const groomSide = groom.prestigeBps;
  const brideSide = giver.prestigeBps;
  const gain = Math.min(MATCH_STANDING_BPS, Math.floor(Math.abs(groomSide - brideSide) / 2));
  const risesId = groomSide < brideSide ? groom.id : giver.id;
  let next: WorldState = {
    ...world,
    familyLinks: [...world.familyLinks, {
      id: ids.next("family"), characterId: groom.id, relatedCharacterId: bride.id, kind: "spouse_or_partner",
      startedAtStep: atStep, endedAtStep: null, visibility: "public", provenanceEventId: null,
    }],
    characters: world.characters.map((character) => {
      if (character.id === bride.id) return { ...character, locationProvinceId: groom.locationProvinceId };
      if (character.id === risesId && gain > 0) return { ...character, prestigeBps: Math.min(10_000, character.prestigeBps + gain) };
      return character;
    }),
    material: dowry <= 0 ? world.material : {
      ...world.material,
      accounts: world.material.accounts.map((account) => (account.id === fromPurse!.id ? { ...account, balance: account.balance - dowry } : account.id === toPurse!.id ? { ...account, balance: account.balance + dowry } : account)),
      transactions: [...world.material.transactions, {
        id: ids.next("txn"), atStep, kind: "transfer" as const, amount: dowry, sourceAccountId: fromPurse!.id, destinationAccountId: toPurse!.id,
        cause: { kind: "action" as const, id: bride.id, explanation: `The dowry of ${bride.name}`.slice(0, 240) }, visibility: "polity" as const,
      }],
    },
  };
  // The heads of the two houses are kin now, and think the better of each other for it.
  const groomHead = fatherOf(next, groom) ?? groom;
  if (groomHead.id !== giver.id) {
    next = remember(next, [
      { subjectCharacterId: giver.id, targetCharacterId: groomHead.id, label: `Our houses are joined by ${groom.name}'s marriage to ${bride.name}.`, score: 15, dimensions: { affection: 15, trust: 10, obligation: 10 }, decayPerYearBps: 300 },
      { subjectCharacterId: groomHead.id, targetCharacterId: giver.id, label: `Our houses are joined by ${groom.name}'s marriage to ${bride.name}.`, score: 15, dimensions: { affection: 15, trust: 10, obligation: 10 }, decayPerYearBps: 300 },
    ], atStep, `marriage:${groom.id}:${bride.id}`);
  }
  const riser = next.characters.find((character) => character.id === risesId)?.name ?? "the lesser house";
  facts.push({
    localId: `marriage_${groom.id}_${bride.id}`.slice(0, 60), kind: "marriage",
    summary: `${groom.name} has married ${bride.name}, given by ${giver.id === bride.id ? "herself" : giver.name}${dowry > 0 ? `, with a dowry of ${dowry}` : ""}.${gain > 0 ? ` ${riser} stands the higher for the match.` : ""}`.slice(0, 600),
    affectedRefs: [{ kind: "character", id: groom.id }, { kind: "character", id: bride.id }, ...(giver.id === bride.id ? [] : [{ kind: "character" as const, id: giver.id }]), ...(groom.polityId === null ? [] : [{ kind: "polity" as const, id: groom.polityId }])],
    visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 45,
  });
  return next;
}
