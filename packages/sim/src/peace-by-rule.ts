import {
  atWar,
  isDelivered,
  isStanding,
  type DiplomaticMessage,
  type FactProposalDraft,
  type Office,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";
import { diplomaticAnswererOf } from "./letters";
import { concludePeace, type PeaceClause } from "./peace";
import { safeLocalId } from "./safe-local-id";

/**
 * Terms of peace offered to a power nobody plays, answered by rule (docs/reports/consul-run-issues.md, H4).
 *
 * The consul dictated peace to the Campanians of Rhegium at a war score of a hundred, and offered the Messapians terms after
 * every battle they lost; every letter was "refused by silence", while the same powers wrote asking for peace. Whether a beaten
 * power takes the terms it is offered was a model's mood, and a model that said nothing said no. The rule that already prices a
 * peace at the table (`concludePeace`: what each clause costs the side giving it, against what its war has cost it, and any
 * terms at all where the victor dictates) now answers the letter too, on the day its answer is due -- before silence is counted,
 * as union offers are (`submission.ts`).
 *
 * Only offers the player's own power makes: what the world's powers write one another is still theirs to answer.
 */
export interface PeaceByRuleInput {
  readonly offices: readonly Office[];
  readonly warfare: ScenarioWarfareRules;
  readonly ids: IdFactory;
  readonly gameId: string;
  readonly playerPolityId: string | null;
}

/** Whether a letter offers peace on terms: a peace offer, or a letter whose acceptance makes a peace. */
const offersPeace = (message: DiplomaticMessage): boolean => message.kind === "peace_offer" || (message.proposes ?? []).includes("peace");

export function settlePeaceByRule(world: WorldState, toDay: number, facts: FactProposalDraft[], input: PeaceByRuleInput): WorldState {
  if (input.playerPolityId === null) return world;
  let next = world;
  for (const message of world.diplomacy) {
    if (message.status !== "awaiting_reply" || message.fromPolityId !== input.playerPolityId || !offersPeace(message) || !isDelivered(message, toDay)) continue;
    const unaskable = message.toCharacterId === null || !next.characters.some((character) => character.id === message.toCharacterId && character.alive);
    const due = message.replyDueByStep !== null && message.replyDueByStep <= toDay;
    if (!unaskable && !due) continue;
    const current = next.diplomacy.find((candidate) => candidate.id === message.id);
    const recipient = next.map.polities.find((polity) => polity.id === message.toPolityId);
    if (current === undefined || current.status !== "awaiting_reply" || recipient === undefined || !isStanding(recipient)) continue;
    if (!atWar(next.polityAgreements, message.fromPolityId, message.toPolityId)) continue;
    const answerer = diplomaticAnswererOf(next, message.toPolityId, input.offices) ?? (message.toCharacterId !== null && next.characters.some((character) => character.id === message.toCharacterId && character.alive) ? message.toCharacterId : null);
    if (answerer === null) continue;

    const outcome = concludePeace(next, {
      proposerPolityId: message.fromPolityId,
      otherPolityId: message.toPolityId,
      // Stored as the letter carried them; read as the treaty clauses they were written as (as `acceptedAgreementDelta` does).
      clauses: (message.clauses ?? []) as unknown as PeaceClause[],
      terms: message.terms,
      representativeId: answerer,
      speakerId: message.fromCharacterId,
    }, { now: { day: toDay, minute: 0 }, offices: input.offices, warfare: input.warfare, ids: input.ids, gameId: input.gameId }, input.offices);

    const made = outcome.made;
    const base = made ? outcome.world : next;
    const peace = made
      ? [...base.polityAgreements].reverse().find((agreement) => agreement.kind === "peace" && agreement.sinceStep === toDay
        && [agreement.polityId, agreement.otherPolityId].includes(message.fromPolityId) && [agreement.polityId, agreement.otherPolityId].includes(message.toPolityId))
      : undefined;
    const said = made
      ? `${recipient.name} takes the terms: ${message.subject}.`
      : outcome.refusal ?? `${recipient.name} will not take these terms.`;
    next = {
      ...base,
      diplomacy: base.diplomacy.map((candidate) => (candidate.id === message.id
        ? { ...candidate, status: "answered" as const, answer: made ? "accepted" as const : "refused" as const, answerText: said.slice(0, 1_200), answeredAtStep: toDay, ...(peace === undefined ? {} : { agreementId: peace.id }) }
        : candidate)),
    };
    facts.push(...outcome.facts);
    facts.push({
      localId: safeLocalId(`peace_by_rule_${message.id}`).slice(0, 60),
      kind: "letter_answered",
      summary: `${recipient.name} ${made ? "accepted" : "refused"} "${message.subject}": ${said}`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: message.toPolityId }, { kind: "polity", id: message.fromPolityId }],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: made ? 75 : 45,
    });
  }
  return next;
}
