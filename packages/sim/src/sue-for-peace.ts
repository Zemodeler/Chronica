import {
  PEACE_AT,
  TRUCE_AT,
  atWar,
  diplomaticSituationKey,
  newsDaysBetween,
  readDepartments,
  warStanding,
  warWeariness,
  warsOf,
  type DiplomaticMessage,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Powers that sue for peace by themselves (docs/plans/departments.md §13).
 *
 * A war between two powers ended only if the model thought of ending it, so
 * nobody's war ever ended. Now a power tired of its war asks, once a month
 * at most: for a truce first, past forty -- to bury the dead, to see a
 * winter through -- and for peace past sixty, on terms that follow how the
 * war stands. It writes through whoever is in charge of its peace-making, to
 * whoever is in charge of the enemy's, and the answer is theirs: a letter
 * like any other, which the enemy's people answer, or the player does.
 *
 * A refused offer does not end the asking. The next is more generous.
 */

/** A power waits this long after an offer before making another. */
const ASKS_EVERY_DAYS = 120;
const TRUCE_DAYS = 180;

const nameOf = (world: WorldState, polityId: string): string => world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;

export function sueForPeace(world: WorldState, toDay: number, ids: IdFactory): { world: WorldState; facts: FactProposalDraft[] } {
  const reader = readDepartments(world);
  const facts: FactProposalDraft[] = [];
  const letters: DiplomaticMessage[] = [];
  const seen = new Set<string>();

  for (const polity of world.map.polities) {
    for (const enemyId of warsOf(world.polityAgreements, polity.id)) {
      if (seen.has(`${polity.id}:${enemyId}`) || !atWar(world.polityAgreements, polity.id, enemyId)) continue;
      seen.add(`${polity.id}:${enemyId}`);
      const weariness = warWeariness(world, polity.id, enemyId);
      if (weariness.score < TRUCE_AT) continue;

      // Both exhausted powers need a negotiation, not two simultaneous
      // opening offers. The second side answers the first side's terms.
      const pendingAcross = [...world.diplomacy, ...letters].some((message) => message.status === "awaiting_reply"
        && ((message.fromPolityId === polity.id && message.toPolityId === enemyId) || (message.fromPolityId === enemyId && message.toPolityId === polity.id))
        && (message.kind === "peace_offer" || (message.proposes ?? []).some((kind) => kind === "peace" || kind === "truce")));
      if (pendingAcross) continue;
      const ours = world.diplomacy.filter((message) => message.fromPolityId === polity.id && message.toPolityId === enemyId
        && (message.kind === "peace_offer" || (message.proposes ?? []).includes("truce")));
      if (ours.some((message) => message.status === "awaiting_reply" || toDay - message.sentAtStep < ASKS_EVERY_DAYS)) continue;
      const writer = reader.holding({ kind: "polity", id: polity.id }, "peace_talks").people[0];
      if (writer === undefined) continue;
      const reader_ = reader.holding({ kind: "polity", id: enemyId }, "peace_talks").people[0] ?? null;
      const refused = ours.filter((message) => message.answer === "refused" || message.answer === "ignored").length;
      const us = nameOf(world, polity.id);
      const them = nameOf(world, enemyId);
      const more = refused === 0 ? "" : ", and more than was offered before";

      const peace = weariness.score >= PEACE_AT;
      const standing = warStanding(world, polity.id, enemyId).score;
      const terms = !peace
        ? `A truce of six months between ${us} and ${them}: the fighting to stop, the dead to be buried, and neither to move against the other's ground while it holds${more}.`
        : standing <= -30
          ? `Peace between ${us} and ${them}, and ${us} will pay what is asked of it for the war's end${more}.`
          : standing <= 10
            ? `Peace between ${us} and ${them}, each keeping the ground it holds today${more}.`
            : `Peace between ${us} and ${them}, if ${them} gives up what it has taken in the war${more}.`;
      const travel = writer.locationProvinceId === null || reader_?.locationProvinceId == null ? 0 : newsDaysBetween(world, writer.locationProvinceId, reader_.locationProvinceId);
      const messageId = ids.next("message");
      const letter: DiplomaticMessage = {
        id: messageId,
        kind: peace ? "peace_offer" : "letter",
        fromPolityId: polity.id,
        fromCharacterId: writer.id,
        toPolityId: enemyId,
        toCharacterId: reader_?.id ?? null,
        subject: (peace ? `${us} asks for peace` : `${us} asks for a truce`).slice(0, 240),
        terms: terms.slice(0, 1_200),
        sentAtStep: toDay,
        deliveredOnDay: toDay + travel,
        replyDueByStep: toDay + travel + 30,
        negotiationId: ours[0]?.negotiationId ?? ours[0]?.id ?? messageId,
        negotiationOwnerCharacterId: ours[0]?.negotiationOwnerCharacterId ?? writer.id,
        situationKey: diplomaticSituationKey(world, polity.id, enemyId),
        negotiation: { issueKey: peace ? "peace" : "truce", objective: `End the war with ${them}`, question: peace ? "On what terms will the war end?" : "Will the fighting pause for six months?", positions: [{ issue: peace ? "peace terms" : "truce duration", value: peace ? terms.slice(0, 240) : String(TRUCE_DAYS) }], ...(ours.length === 0 ? {} : { reopening: { kind: "reminder" as const, reason: "War exhaustion persists after the previous offer." } }) },
        status: "awaiting_reply",
        answer: null,
        answerText: null,
        answeredAtStep: null,
        inReplyToMessageId: null,
        visibility: "public",
        ...(peace ? {} : { proposes: ["truce" as const], forDays: TRUCE_DAYS }),
      };
      letters.push(letter);
      facts.push({
        localId: `sues_${polity.id}_${enemyId}`.slice(0, 60),
        kind: "diplomacy",
        summary: `${writer.name} wrote to ${them} for ${us}, asking for ${peace ? "peace" : "a truce"}: ${weariness.parts.slice(0, 3).join(", ") || "the war has gone on long enough"}.`.slice(0, 400),
        affectedRefs: [{ kind: "polity", id: polity.id }, { kind: "polity", id: enemyId }, { kind: "character", id: writer.id }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: peace ? 60 : 45,
      });
    }
  }
  return letters.length === 0 ? { world, facts } : { world: { ...world, diplomacy: [...world.diplomacy, ...letters] }, facts };
}
