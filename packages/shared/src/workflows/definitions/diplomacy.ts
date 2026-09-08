import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../../material-state";
import { DiplomaticAnswerSchema, DiplomaticMessageKindSchema, applyDiplomaticAnswerToStance, type DiplomaticMessage } from "../../world/diplomacy";
import type { WorldState } from "../../world/world-state";
import { defineWorkflow, refuse, type AnyWorkflowDefinition } from "../types";

// Diplomacy workflows.
//
// A letter, an offer, an ultimatum, and the answer to one. These exist
// because the engine could conclude a treaty but not propose one: a player
// writing to a neighbouring king had no tool his order could become, so it
// was filed as an unsupported attempt and the world never heard from him.
//
// Sending decides nothing. `send_diplomatic_message` creates an obligation on
// the receiving power and changes not one other thing; what the answer is
// belongs to whoever answers it. The consequences of an accepted offer still
// go through the workflows that already model them -- sign_treaty, end_war,
// impose_tribute, arrange_marriage_alliance. That separation is the point: a
// proposal a player makes is never a proposal a rival has accepted.

function polityName(world: WorldState, id: string): string {
  return world.map.polities.find((polity) => polity.id === id)?.name ?? id;
}

function readable(kind: string): string {
  return kind.replace(/_/g, " ");
}

export const diplomacyWorkflows: AnyWorkflowDefinition[] = [
  defineWorkflow({
    id: "send_diplomatic_message",
    description:
      "Send a letter, offer, request, demand, protest, or ultimatum from one power to another. Records the approach and obliges the receiving power to answer; it decides nothing on their behalf.",
    category: "political",
    parametersSchema: z
      .object({
        messageId: EntityIdSchema,
        kind: DiplomaticMessageKindSchema,
        fromPolityId: EntityIdSchema,
        fromCharacterId: EntityIdSchema,
        toPolityId: EntityIdSchema,
        toCharacterId: EntityIdSchema.nullable().default(null),
        subject: z.string().trim().min(1).max(240),
        terms: z.string().trim().min(1).max(1_200),
        replyDueByStep: ElapsedStepSchema.nullable().default(null),
        inReplyToMessageId: EntityIdSchema.nullable().default(null),
        visibility: VisibilitySchema.default("polity"),
      })
      .strict(),
    apply(world, params, context) {
      for (const [label, polityId] of [["sender", params.fromPolityId], ["recipient", params.toPolityId]] as const) {
        if (!world.map.polities.some((polity) => polity.id === polityId)) {
          return refuse(`There is no power with the id "${polityId}" to be the ${label}. Use one of the polity ids the world state lists.`);
        }
      }
      const sender = world.characters.find((character) => character.id === params.fromCharacterId);
      if (!sender) {
        return refuse(`No character with the id "${params.fromCharacterId}" can put their name to this message.`);
      }
      if (params.toCharacterId !== null) {
        const recipient = world.characters.find((character) => character.id === params.toCharacterId);
        if (!recipient) {
          return refuse(
            `No character with the id "${params.toCharacterId}" can receive this message. Address it to the power itself by passing null for toCharacterId, or give that power a leader first with create_world_character.`,
          );
        }
      }
      if (params.inReplyToMessageId !== null && !world.diplomacy.some((message) => message.id === params.inReplyToMessageId)) {
        return refuse(`No earlier message with the id "${params.inReplyToMessageId}" exists for this one to answer.`);
      }

      const message: DiplomaticMessage = {
        id: params.messageId,
        kind: params.kind,
        fromPolityId: params.fromPolityId,
        fromCharacterId: params.fromCharacterId,
        toPolityId: params.toPolityId,
        toCharacterId: params.toCharacterId,
        subject: params.subject,
        terms: params.terms,
        sentAtStep: context.atStep,
        replyDueByStep: params.replyDueByStep,
        status: "awaiting_reply",
        answer: null,
        answerText: null,
        answeredAtStep: null,
        inReplyToMessageId: params.inReplyToMessageId,
        visibility: params.visibility,
      };
      const recipientName = params.toCharacterId === null
        ? polityName(world, params.toPolityId)
        : world.characters.find((character) => character.id === params.toCharacterId)?.name ?? polityName(world, params.toPolityId);

      return {
        world: {
          ...world,
          diplomacy: [...world.diplomacy.filter((candidate) => candidate.id !== params.messageId), message],
        },
        result: {
          summary: `${sender.name} sends ${recipientName} a ${readable(params.kind)}: ${params.subject}`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "answer_diplomatic_message",
    description:
      "The receiving power answers a standing diplomatic message: accepted, refused, countered, or deliberately left unanswered, in its own words. Acceptance records agreement only — carry out what was agreed with the workflow that models it (sign_treaty, end_war, impose_tribute, arrange_marriage_alliance).",
    category: "political",
    parametersSchema: z
      .object({
        messageId: EntityIdSchema,
        answer: DiplomaticAnswerSchema,
        answeredByCharacterId: EntityIdSchema,
        answerText: z.string().trim().min(1).max(1_200),
      })
      .strict(),
    apply(world, params, context) {
      const message = world.diplomacy.find((candidate) => candidate.id === params.messageId);
      if (!message) {
        const open = world.diplomacy.filter((candidate) => candidate.status === "awaiting_reply");
        return refuse(
          open.length === 0
            ? `No message with the id "${params.messageId}" exists, and nothing anywhere is awaiting a reply.`
            : `No message with the id "${params.messageId}" exists. Still awaiting a reply: ${open.map((candidate) => `${candidate.id} (${candidate.subject})`).join("; ")}.`,
        );
      }
      const answerer = world.characters.find((character) => character.id === params.answeredByCharacterId);
      if (!answerer) {
        return refuse(`No character with the id "${params.answeredByCharacterId}" can answer for ${polityName(world, message.toPolityId)}.`);
      }

      const answered: DiplomaticMessage = {
        ...message,
        status: "answered",
        answer: params.answer,
        answerText: params.answerText,
        answeredAtStep: context.atStep,
      };
      const verb = params.answer === "accepted"
        ? "accepts"
        : params.answer === "refused"
          ? "refuses"
          : params.answer === "countered"
            ? "answers with terms of their own"
            : "lets stand without reply";

      return {
        world: {
          ...world,
          diplomacy: world.diplomacy.map((candidate) => (candidate.id === message.id ? answered : candidate)),
          polityStances: [...applyDiplomaticAnswerToStance(world.polityStances, answered, context.atStep)],
        },
        result: {
          summary: `${answerer.name} of ${polityName(world, message.toPolityId)} ${verb}: ${polityName(world, message.fromPolityId)}'s ${readable(message.kind)} concerning ${message.subject}.`,
          applied: true,
        },
      };
    },
  }),

  defineWorkflow({
    id: "withdraw_diplomatic_message",
    description: "The sender withdraws a message that has not yet been answered, so it no longer stands between the two powers.",
    category: "political",
    parametersSchema: z
      .object({ messageId: EntityIdSchema, withdrawnByCharacterId: EntityIdSchema, reason: z.string().trim().min(1).max(400) })
      .strict(),
    apply(world, params, context) {
      const message = world.diplomacy.find((candidate) => candidate.id === params.messageId);
      if (!message) return refuse(`No message with the id "${params.messageId}" exists.`);
      const actor = world.characters.find((character) => character.id === params.withdrawnByCharacterId);
      if (!actor) return refuse(`No character with the id "${params.withdrawnByCharacterId}" can withdraw it.`);

      const withdrawn: DiplomaticMessage = {
        ...message,
        status: "answered",
        answer: "ignored",
        answerText: `Withdrawn by the sender: ${params.reason}`,
        answeredAtStep: context.atStep,
      };
      return {
        world: { ...world, diplomacy: world.diplomacy.map((candidate) => (candidate.id === message.id ? withdrawn : candidate)) },
        result: {
          summary: `${actor.name} withdraws the ${readable(message.kind)} sent to ${polityName(world, message.toPolityId)}.`,
          applied: true,
        },
      };
    },
  }),
];
