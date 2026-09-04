import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";

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
