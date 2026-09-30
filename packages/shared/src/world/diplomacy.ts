import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, SignedScoreSchema, VisibilitySchema } from "../material-state";
import { PolityAgreementKindSchema, type PolityAgreementKind } from "./agreements";
import { aptitude, skillShare } from "../characters/aptitude";
import { leaning } from "../characters/traits";
import type { Character } from "../characters/character";

// Diplomacy: what one power says to another.
//
// Before this existed the engine could sign a treaty and end a war, but had
// no way to model the approach that produces either -- so a player writing to
// a neighbouring king proposing an alliance had nothing his order could
// become, and it was filed as an unsupported attempt. A letter is now a real,
// durable object: it is sent, it stands unanswered, and the power it was sent
// to must eventually answer it.
//
// Deliberately, sending says nothing about the reply. A message creates an
// obligation to respond and nothing else; the recipient's answer is their own
// decision, taken with their own interests in view.

export const DiplomaticMessageKindSchema = z.enum([
  "letter",
  "alliance_offer",
  "peace_offer",
  "trade_offer",
  "marriage_offer",
  "military_aid_request",
  "tribute_demand",
  "ultimatum",
  "warning",
  "protest",
  "congratulation",
]);
export type DiplomaticMessageKind = z.infer<typeof DiplomaticMessageKindSchema>;

export const DiplomaticAnswerSchema = z.enum(["accepted", "refused", "countered", "ignored"]);
export type DiplomaticAnswer = z.infer<typeof DiplomaticAnswerSchema>;

export const DiplomaticMessageSchema = z
  .object({
    id: EntityIdSchema,
    kind: DiplomaticMessageKindSchema,
    fromPolityId: EntityIdSchema,
    /** Who sent it. A power always speaks through somebody. */
    fromCharacterId: EntityIdSchema,
    toPolityId: EntityIdSchema,
    /** Named recipient where there is one; null when addressed to the power at large. */
    toCharacterId: EntityIdSchema.nullable().default(null),
    /** One line on what it is about, in the sender's own framing. */
    subject: z.string().trim().min(1).max(240),
    /** What is actually being proposed, demanded, or asked. */
    terms: z.string().trim().min(1).max(1_200),
    sentAtStep: ElapsedStepSchema,
    /** How long the sender is willing to wait, when they said. */
    replyDueByStep: ElapsedStepSchema.nullable().default(null),
    status: z.enum(["awaiting_reply", "answered"]).default("awaiting_reply"),
    answer: DiplomaticAnswerSchema.nullable().default(null),
    /** The recipient's own words, and the reason it went the way it did. */
    answerText: z.string().trim().max(1_200).nullable().default(null),
    answeredAtStep: ElapsedStepSchema.nullable().default(null),
    /** Set when this message is itself a counter-offer to an earlier one. */
    inReplyToMessageId: EntityIdSchema.nullable().default(null),
    visibility: VisibilitySchema.default("polity"),
    /**
     * What accepting it would make: the agreements it offers (`offeredAgreementKinds`).
     * Rome's letter taking Messana in "as an ally or as protected territory"
     * was accepted in so many words and bound nobody, because an accepted
     * letter was a letter and nothing more.
     */
    proposes: z.array(PolityAgreementKindSchema).max(4).optional(),
    /** The agreement its acceptance opened, when it opened one. */
    agreementId: EntityIdSchema.nullable().optional(),
    /** How long what it offers lasts, when it is for a time: a truce of six months. */
    forDays: z.number().int().positive().max(36_600).nullable().optional(),
    /**
     * The terms it offers, as treaty clauses (`agreement_open`'s): checked
     * and carried out when it is accepted, not when it is written.
     */
    clauses: z.array(z.record(z.string(), z.unknown())).max(6).optional(),
    /**
     * What its sender does if it is refused or goes unanswered: an ultimatum's
     * threat. Rome sent Syracuse "if you are not with us you are against us"
     * and declared the war in the same breath, before Hieron could answer; the
     * refusal that came afterwards arrived ten days after the battle.
     */
    onRefusal: z.enum(["war", "war_if_attacked"]).nullable().optional(),
    /**
     * The day a conditional threat was refused or went unanswered, so it now
     * stands: "cease hostilities or face war" answered with a refusal of the
     * wording, while the pause held. The war opens on the next hostile act,
     * not on the refusal (`threatWaitsOnAttack`). Null once it is carried out.
     */
    threatStandsSince: ElapsedStepSchema.nullable().optional(),
    /**
     * The day the letter was first put in front of the person who has to
     * answer it. Silence is a refusal only once somebody has read it: seven
     * of Rome's allies "refused by silence" letters they were never shown,
     * because the burst jumped past the reply date before asking them.
     */
    putToRecipientOnDay: ElapsedStepSchema.nullable().optional(),
    /**
     * The day it reaches the person it is written to: the road from the
     * writer to where the reader is (`newsDaysBetween`). A letter from Latium
     * reached Syracuse the day it was written, and was answered by return.
     * Until then it is in the courier's bag -- nobody can read it, answer it,
     * or be counted silent on it. Absent on letters written before letters
     * travelled, which were delivered the day they were sent.
     */
    deliveredOnDay: ElapsedStepSchema.nullable().optional(),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.status === "answered" && message.answer === null) {
      context.addIssue({ code: "custom", path: ["answer"], message: "An answered message must record its answer." });
    }
    if (message.status === "awaiting_reply" && message.answer !== null) {
      context.addIssue({ code: "custom", path: ["status"], message: "A message with an answer is not still awaiting one." });
    }
  });
export type DiplomaticMessage = z.infer<typeof DiplomaticMessageSchema>;

/**
 * The agreements a letter's acceptance can make: those it named, and the one
 * its kind already means -- an offer of alliance accepted is an alliance.
 */
const MEANT_BY_KIND: Partial<Record<DiplomaticMessageKind, PolityAgreementKind>> = {
  alliance_offer: "alliance",
  peace_offer: "peace",
  trade_offer: "trade_pact",
  tribute_demand: "tributary",
};

export function offeredAgreementKinds(message: Pick<DiplomaticMessage, "kind" | "proposes">): readonly PolityAgreementKind[] {
  const meant = MEANT_BY_KIND[message.kind];
  return [...new Set([...(message.proposes ?? []), ...(meant === undefined ? [] : [meant])])];
}

/** Whether the letter is in its reader's hands by that day, rather than still on the road. */
export const isDelivered = (message: Pick<DiplomaticMessage, "sentAtStep" | "deliveredOnDay">, day: number): boolean =>
  (message.deliveredOnDay ?? message.sentAtStep) <= day;

/** Messages nobody has answered yet, oldest first: the diplomatic debts of the world. */
export function unansweredMessages(messages: readonly DiplomaticMessage[]): readonly DiplomaticMessage[] {
  return messages.filter((message) => message.status === "awaiting_reply").slice().sort((a, b) => a.sentAtStep - b.sentAtStep);
}

/** One power's demand rebuffed again, on what is mechanically the same standing thread. */
export interface DiplomaticEscalationTrigger {
  readonly senderCharacterId: string;
  readonly senderPolityId: string;
  readonly recipientPolityId: string;
  readonly subject: string;
  /** How many times in a row, counting this one, the thread has ended in refusal or silence. */
  readonly refusalCount: number;
  readonly messageId: string;
}

/**
 * A rejected ultimatum must not simply repeat itself: the offended power is
 * meant to escalate. This reads no more than the message record already
 * says -- it never invents that a demand was repeated, it counts how many
 * times, in the same fromPolity/toPolity thread (linked by
 * `inReplyToMessageId`, the same chain a follow-up ultimatum uses), the
 * answer already recorded was `refused` or `ignored`.
 *
 * Returns one trigger per message answered THIS step whose thread has now
 * been rebuffed at least twice -- the caller turns each into a pressure on
 * the sender's own leader, exactly the same deterministic path the other
 * pressure triggers already use, so the sender's power is agency-eligible
 * (and pressed toward a real reaction) starting next turn without any of
 * this depending on the Game Master having chosen to notice on its own.
 */
export function deriveDiplomaticEscalations(
  messages: readonly DiplomaticMessage[],
  atStep: number,
): readonly DiplomaticEscalationTrigger[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const escalations: DiplomaticEscalationTrigger[] = [];

  for (const message of messages) {
    if (message.status !== "answered" || message.answeredAtStep !== atStep) continue;
    if (message.answer !== "refused" && message.answer !== "ignored") continue;

    let count = 1;
    let cursor: DiplomaticMessage = message;
    const seen = new Set<string>([message.id]);
    for (;;) {
      if (cursor.inReplyToMessageId === null) break;
      const ancestor = byId.get(cursor.inReplyToMessageId);
      if (
        ancestor === undefined
        || seen.has(ancestor.id)
        || ancestor.fromPolityId !== message.fromPolityId
        || ancestor.toPolityId !== message.toPolityId
        || ancestor.status !== "answered"
        || (ancestor.answer !== "refused" && ancestor.answer !== "ignored")
      ) break;
      seen.add(ancestor.id);
      count += 1;
      cursor = ancestor;
    }
    if (count < 2) continue;

    escalations.push({
      senderCharacterId: message.fromCharacterId,
      senderPolityId: message.fromPolityId,
      recipientPolityId: message.toPolityId,
      subject: message.subject,
      refusalCount: count,
      messageId: message.id,
    });
  }

  return escalations;
}

// Persistent, evolving posture (GM refactor, requirement: causal chaining and
// inter-actor relations, docs/34).
//
// `deriveDiplomaticEscalations` reads the message log fresh each time it is
// asked and never remembers anything between turns; a thread that goes quiet
// leaves no trace once it stops being "the most recent answer." PolityStance
// is the accumulator that thread history was missing: one power's standing
// trust toward another, nudged a little every time a message between them is
// answered, so a Game Master reading it on turn thirty sees the accumulated
// weight of thirty turns of behaviour, not just the last reply.

/** One power's accumulated posture toward another. Directed: A's trust of B is not B's of A. */
export const PolityStanceSchema = z
  .object({
    polityId: EntityIdSchema,
    towardPolityId: EntityIdSchema,
    /** -100 (open hostility) to 100 (firm trust); 0 is neutral/unknown. */
    trustScore: SignedScoreSchema,
    lastShiftReason: z.string().trim().min(1).max(240),
    lastShiftAtStep: ElapsedStepSchema,
  })
  .strict()
  .refine((stance) => stance.polityId !== stance.towardPolityId, {
    message: "A polity's stance toward itself is not tracked.",
    path: ["towardPolityId"],
  });
export type PolityStance = z.infer<typeof PolityStanceSchema>;

/** How much one answered message shifts the recipient's trust in the sender. */
const TRUST_SHIFT_BY_ANSWER: Record<DiplomaticAnswer, number> = {
  accepted: 12,
  countered: 2,
  refused: -10,
  ignored: -14,
};

function clampTrust(score: number): number {
  return Math.max(-100, Math.min(100, score));
}

function findStance(stances: readonly PolityStance[], polityId: string, towardPolityId: string): PolityStance | undefined {
  return stances.find((stance) => stance.polityId === polityId && stance.towardPolityId === towardPolityId);
}

/**
 * Nudge the recipient's trust in the sender after one message is answered,
 * returning the updated stance list. Directed and asymmetric on purpose: the
 * recipient's opinion of the sender moves on how the sender's approach was
 * received (nothing here, deliberately); the sender's opinion of the
 * recipient moves on how it was answered, which is the information this
 * function actually has.
 */
export function applyDiplomaticAnswerToStance(
  stances: readonly PolityStance[],
  message: Pick<DiplomaticMessage, "fromPolityId" | "toPolityId" | "answer" | "subject">,
  atStep: number,
  /**
   * The two people the letter passed between, where they are known. Diplomacy
   * moved nothing in diplomacy: a Fabricius and a boor wrote the same letter.
   * An answerer with a gift for it refuses without giving offence -- up to half
   * the sting taken out, or half again added -- and a persuasive writer warms
   * the power he writes to, a little, whatever it answers.
   */
  hands: {
    readonly writer?: (Pick<Character, "skills"> & { readonly traits?: readonly string[] }) | undefined;
    readonly answerer?: (Pick<Character, "skills"> & { readonly traits?: readonly string[] }) | undefined;
    /**
     * What the head of each side's foreign business adds, where the letter
     * went in a power's name (`departments.ts` `headLift`): a seventh either
     * way on the writer's warmth and on the answerer's tact.
     */
    readonly writerLift?: number;
    readonly answererLift?: number;
  } = {},
): readonly PolityStance[] {
  if (message.answer === null) return stances;
  // A letter within one power -- a subject petitioning his own government --
  // moves no trust between powers, because there is only the one.
  if (message.fromPolityId === message.toPolityId) return stances;
  const base = TRUST_SHIFT_BY_ANSWER[message.answer];
  // A man's finer gift and his diplomacy at large count half each.
  // And his nature: a man disposed to negotiate softens what he must refuse.
  const tact = hands.answerer === undefined ? 50
    : (aptitude(hands.answerer, "arbitration") + hands.answerer.skills.diplomacy) / 2 + leaning({ traits: hands.answerer.traits ?? [] }, "negotiation");
  const existing = findStance(stances, message.fromPolityId, message.toPolityId);
  // A refusal stings the less from a tactful man; and where trust had been
  // lost, a good answer from one wins it back the faster.
  const shift = base < 0 && hands.answerer !== undefined ? Math.round(base * (1 - skillShare(tact, 0.5) - (hands.answererLift ?? 0)))
    : base > 0 && hands.answerer !== undefined && (existing?.trustScore ?? 0) < 0 ? Math.round(base * (1 + Math.max(0, skillShare(tact, 0.5))))
      : base;
  const updated: PolityStance = {
    polityId: message.fromPolityId,
    towardPolityId: message.toPolityId,
    trustScore: clampTrust((existing?.trustScore ?? 0) + shift),
    lastShiftReason: `${message.toPolityId} ${message.answer} "${message.subject}"`,
    lastShiftAtStep: atStep,
  };
  let next = [...stances.filter((stance) => !(stance.polityId === message.fromPolityId && stance.towardPolityId === message.toPolityId)), updated];
  // A warm man writes warmly: a sociable writer's letter is read a little kinder.
  const warmth = hands.writer === undefined ? 0
    : Math.round(skillShare((aptitude(hands.writer, "rhetoric") + hands.writer.skills.diplomacy) / 2, 6) * (1 + (hands.writerLift ?? 0)) + leaning({ traits: hands.writer.traits ?? [] }, "sociability") / 5);
  if (warmth !== 0) {
    const reader = findStance(next, message.toPolityId, message.fromPolityId);
    next = [...next.filter((stance) => !(stance.polityId === message.toPolityId && stance.towardPolityId === message.fromPolityId)), {
      polityId: message.toPolityId,
      towardPolityId: message.fromPolityId,
      trustScore: clampTrust((reader?.trustScore ?? 0) + warmth),
      lastShiftReason: `${message.fromPolityId} wrote "${message.subject}"`.slice(0, 200),
      lastShiftAtStep: atStep,
    }];
  }
  return next;
}

/**
 * Whether an ultimatum's threat waits on the other side's doing something --
 * attacking, going on attacking -- rather than on its answer. Hieron kept the
 * pause and refused to renounce his claim, and war opened because the letter
 * was refused, when what it threatened war for was continued attack (R15).
 * Read from its words where the sender did not say.
 */
export function threatWaitsOnAttack(message: Pick<DiplomaticMessage, "onRefusal" | "terms" | "subject">): boolean {
  if (message.onRefusal === "war_if_attacked") return true;
  if (message.onRefusal !== "war") return false;
  return /\b(cease|stop|halt|end)\b[^.]{0,40}\b(hostilit|attack|fighting|raids?|war)|\bif (you|they|he|syracuse|carthage|[a-z]+) (continue|keep|attack|march|move|strike|resume)|\b(continue|continued|renewed|further) (hostilit|attacks?|aggression)/i.test(`${message.subject} ${message.terms}`);
}

/**
 * What an acceptance asks for that the letter it accepts did not offer, in the
 * acceptor's own words, or null. "We accept Messana's protectorate ... in
 * exchange we shall receive money and manpower as well as your participation
 * in any war Rome is in" was bound as the Mamertines' bare request for
 * protection, and the money, the men and the war service were lost (R13).
 */
export function termsAddedIn(answerText: string): string | null {
  const match = /\b(in exchange|in return|provided that|on condition that|so long as|as long as|we shall receive|you shall (?:pay|send|give|provide|join)|you will (?:pay|send|give|provide|join)|and in addition|but (?:you|we) (?:shall|will|must))\b[\s\S]*/i.exec(answerText);
  return match === null ? null : match[0].trim().slice(0, 600);
}
