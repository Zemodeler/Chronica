import type { DiplomaticMessage } from "./diplomacy";
import { offeredAgreementKinds } from "./diplomacy";
import type { WorldState } from "./world-state";
import { stableHash } from "../determinism";

// The ledger is the durable message record. Derive the current stage instead
// of maintaining a second mutable copy which can disagree with its letters.
type Offer = Pick<DiplomaticMessage, "kind" | "fromPolityId" | "toPolityId" | "terms" | "subject"> & Partial<DiplomaticMessage>;
const normal = (text: string): string => text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${key}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
};

/** Conservative legacy classification; unrelated personal letters have no business key. */
export function negotiationIssue(message: Offer): string | null {
  if (message.negotiation !== undefined) return message.negotiation.issueKey.toLowerCase().trim();
  const agreements = offeredAgreementKinds(message);
  if (agreements.length > 0) return agreements.slice().sort().join("+");
  if (message.kind !== "letter" && message.kind !== "congratulation") return message.kind;
  const text = normal(`${message.subject} ${message.terms}`);
  if (/\bconsult(?:ation|ations)?\b/.test(text)) return "consultation";
  if (/\b(?:guarantees|safeguards)\b/.test(text)) return "guarantees";
  return null;
}
export function sameNegotiation(a: Offer, b: Offer): boolean {
  const issue = negotiationIssue(a);
  return issue !== null && issue === negotiationIssue(b)
    && [a.fromPolityId, a.toPolityId].sort().join(":") === [b.fromPolityId, b.toPolityId].sort().join(":");
}

/** Compare the actual positions/clauses; titles and JSON ordering are immaterial. */
export function sameDiplomaticTerms(a: Offer, b: Offer): boolean {
  if (canonical(offeredAgreementKinds(a)) !== canonical(offeredAgreementKinds(b)) || canonical(a.clauses ?? []) !== canonical(b.clauses ?? []) || (a.onRefusal ?? null) !== (b.onRefusal ?? null) || (a.forDays ?? null) !== (b.forDays ?? null)) return false;
  if ((a.negotiation?.positions.length ?? 0) > 0 && (b.negotiation?.positions.length ?? 0) > 0) {
    return canonical(a.negotiation!.positions.map(({ issue, value }) => ({ issue: normal(issue), value: normal(value) })))
      === canonical(b.negotiation!.positions.map(({ issue, value }) => ({ issue: normal(issue), value: normal(value) })));
  }
  // Clauses do not cover all prose (safe conduct, exceptions, added terms).
  // Never suppress a changed number or negation, even in a near paraphrase.
  const left = normal(a.terms), right = normal(b.terms);
  if (left === right) return true;
  if (canonical(left.match(/\b\d+\b/g) ?? []) !== canonical(right.match(/\b\d+\b/g) ?? []) || /\b(not|never|without|except|unless|no)\b/.test(left) !== /\b(not|never|without|except|unless|no)\b/.test(right)) return false;
  const tokens = (text: string) => new Set(text.split(" ").filter((word) => word.length > 3 && !["will", "shall", "please", "again", "proposes", "requests", "renewed"].includes(word)));
  const l = tokens(left), r = tokens(right);
  const overlap = [...l].filter((word) => r.has(word)).length;
  return l.size >= 5 && r.size >= 5 && overlap / new Set([...l, ...r]).size >= 0.85;
}

/** Changes which can give an unchanged diplomatic position a new purpose. */
export function diplomaticSituationKey(world: WorldState, a: string, b: string): string {
  const parties = new Set([a, b]);
  return String(stableHash([canonical({
    treasuries: world.material.accounts.filter((account) => account.owner.kind === "polity" && parties.has(account.owner.id)).map((account) => [account.id, account.balance > 0]),
    officers: world.material.officeSeats.filter((seat) => world.characters.some((person) => person.id === seat.holderCharacterId && parties.has(person.polityId ?? ""))).map((seat) => [seat.officeId, seat.holderCharacterId, seat.status]),
    agreements: world.polityAgreements.filter((entry) => parties.has(entry.polityId) && parties.has(entry.otherPolityId)).map((entry) => [entry.kind, entry.status]),
    ground: world.map.provinces.filter((entry) => parties.has(entry.controllerPolityId ?? "") || parties.has(entry.lostBy?.polityId ?? "")).map((entry) => [entry.id, entry.controllerPolityId, entry.settlements.map((city) => [city.id, city.controllerPolityId])]),
    forces: world.material.forces.filter((entry) => parties.has(entry.polityId)).map((entry) => [entry.id, entry.locationId, Math.floor(entry.personnel.reduce((sum, group) => sum + group.fit, 0) / 1_000)]),
    sieges: world.sieges.filter((entry) => parties.has(entry.besiegerPolityId) || parties.has(entry.defenderPolityId)).map((entry) => [entry.id, entry.status]),
  })]));
}

export const DIPLOMATIC_REMINDER_DAYS = 30;
/** An unchanged offer is idempotent until there is a reason to revisit it. */
export function redundantDiplomaticOffer(messages: readonly DiplomaticMessage[], offer: Offer, day: number, situationKey: string): DiplomaticMessage | undefined {
  const previous = [...messages].reverse().find((message) => message.fromPolityId === offer.fromPolityId && message.toPolityId === offer.toPolityId && (offer.visibility !== "private" || (message.fromCharacterId === offer.fromCharacterId && message.toCharacterId === offer.toCharacterId)) && sameNegotiation(message, offer));
  if (previous === undefined || !sameDiplomaticTerms(previous, offer)) return undefined;
  const reopening = offer.negotiation?.reopening;
  if (reopening?.kind === "rival_intervention" && previous.fromCharacterId !== offer.fromCharacterId) return undefined;
  if (reopening?.kind === "new_event" && previous.situationKey !== undefined && previous.situationKey !== situationKey) return undefined;
  const due = previous.replyDueByStep ?? previous.deliveredOnDay ?? previous.sentAtStep;
  if (reopening?.kind === "reminder" && day >= Math.max(due, previous.sentAtStep + DIPLOMATIC_REMINDER_DAYS)) return undefined;
  return previous;
}

export function substantiveDiplomaticMessage(message: Pick<DiplomaticMessage, "kind" | "proposes" | "clauses" | "onRefusal">): boolean {
  return offeredAgreementKinds(message).length > 0 || (message.clauses ?? []).length > 0 || message.onRefusal != null
    || !["letter", "congratulation"].includes(message.kind);
}

/** Repeating an outcome for the same terms earns no second trust change. */
export function diplomaticAnswerChangesTrust(messages: readonly DiplomaticMessage[], message: DiplomaticMessage): boolean {
  return substantiveDiplomaticMessage(message) && !messages.some((previous) => previous.id !== message.id
    && previous.fromPolityId === message.fromPolityId && previous.toPolityId === message.toPolityId
    && previous.status === "answered" && previous.answer === message.answer && previous.sentAtStep <= message.sentAtStep
    && sameNegotiation(previous, message) && sameDiplomaticTerms(previous, message));
}

export interface NegotiationBusiness {
  readonly id: string;
  readonly issueKey: string;
  readonly ownerCharacterId: string;
  readonly objective: string;
  readonly question: string;
  readonly stage: "awaiting_reply" | "agreed" | "refused" | "countered";
  readonly messages: readonly DiplomaticMessage[];
  readonly latest: DiplomaticMessage;
}
export function negotiationBusinesses(messages: readonly DiplomaticMessage[]): NegotiationBusiness[] {
  const groups = new Map<string, DiplomaticMessage[]>();
  for (const message of [...messages].sort((a, b) => a.sentAtStep - b.sentAtStep)) {
    const issue = negotiationIssue(message);
    if (issue === null) continue;
    const key = `${[message.fromPolityId, message.toPolityId].sort().join(":")}:${issue}`;
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }
  return [...groups.values()].map((entries) => {
    const first = entries[0]!, latest = entries.at(-1)!;
    return { id: first.negotiationId ?? first.id, issueKey: negotiationIssue(latest)!, ownerCharacterId: first.negotiationOwnerCharacterId ?? first.fromCharacterId,
      objective: latest.negotiation?.objective ?? first.subject, question: latest.negotiation?.question ?? latest.subject,
      stage: latest.status === "awaiting_reply" ? "awaiting_reply" : latest.answer === "accepted" ? "agreed" : latest.answer === "countered" ? "countered" : "refused",
      messages: entries, latest };
  });
}
