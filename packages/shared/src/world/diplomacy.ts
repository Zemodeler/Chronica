import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, SignedScoreSchema, VisibilitySchema } from "../material-state";

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
): readonly PolityStance[] {
  if (message.answer === null) return stances;
  const shift = TRUST_SHIFT_BY_ANSWER[message.answer];
  const existing = findStance(stances, message.fromPolityId, message.toPolityId);
  const updated: PolityStance = {
    polityId: message.fromPolityId,
    towardPolityId: message.toPolityId,
    trustScore: clampTrust((existing?.trustScore ?? 0) + shift),
    lastShiftReason: `${message.toPolityId} ${message.answer} "${message.subject}"`,
    lastShiftAtStep: atStep,
  };
  return [...stances.filter((stance) => !(stance.polityId === message.fromPolityId && stance.towardPolityId === message.toPolityId)), updated];
}
