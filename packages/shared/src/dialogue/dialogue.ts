import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";

// Character dialogue (docs/17, ADR-0025).
//
// Players speak to the people in their character's world, not to an omniscient
// chatbot. What was said is canonical; who heard it follows ordinary knowledge
// rules; a person who matters becomes part of continuity.
//
// The boundary that keeps simultaneous play fair is expressed in these shapes:
// there is no field anywhere here through which speech can move money, grant an
// office or conclude an agreement. "I will pay you one hundred coins" is a
// promise that can be remembered; the coins move when a pay order resolves.

export const DialogueChannelSchema = z.enum([
  "in_person_private",
  "in_person_public",
  "audience",
  "messenger",
  "correspondence",
]);
export type DialogueChannel = z.infer<typeof DialogueChannelSchema>;

export const ContactRequestSchema = z
  .object({
    gameId: EntityIdSchema,
    turnId: EntityIdSchema,
    playerCharacterId: EntityIdSchema,
    targetCharacterId: EntityIdSchema.nullable(),
    roleQuery: z.string().trim().min(1).max(200).nullable(),
    requestedChannel: DialogueChannelSchema.nullable(),
  })
  .strict()
  .refine(
    ({ targetCharacterId, roleQuery }) => (targetCharacterId === null) !== (roleQuery === null),
    "Provide exactly one of targetCharacterId or roleQuery",
  );
export type ContactRequest = z.infer<typeof ContactRequestSchema>;

/**
 * What the simulation says about reaching someone.
 *
 * The `unavailable` branch carries only an explanation, deliberately. A stale
 * link, a guessed character id and a request outside the bubble all receive the
 * same response: it must not confirm whether the person exists, where they are,
 * or why a hidden access check failed.
 */
export const ContactabilityResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      characterId: EntityIdSchema,
      provisional: z.boolean(),
      channels: z.array(DialogueChannelSchema).min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("choose"),
      characterIds: z.array(EntityIdSchema).min(2),
    })
    .strict(),
  z.object({ status: z.literal("unavailable"), explanation: z.string().trim().min(1).max(300) }).strict(),
]);
export type ContactabilityResult = z.infer<typeof ContactabilityResultSchema>;

export const DialogueActSchema = z
  .object({
    kind: z.enum([
      "introduce", "ask", "answer", "disclose", "claim", "praise",
      "insult", "refuse", "threaten", "apologise", "promise", "other",
    ]),
    targetCharacterId: EntityIdSchema,
    /** Fact ids the speaker is entitled to reference. Checked before acceptance. */
    groundedFactIds: z.array(EntityIdSchema),
  })
  .strict();
export type DialogueAct = z.infer<typeof DialogueActSchema>;

export const DialogueReplySchema = z
  .object({
    body: z.string().trim().min(1).max(4_000),
    interpretedPlayerActs: z.array(DialogueActSchema),
    npcActs: z.array(DialogueActSchema),
    npcDisclosedFactIds: z.array(EntityIdSchema),
    endsSession: z.boolean(),
  })
  .strict();
export type DialogueReply = z.infer<typeof DialogueReplySchema>;

/**
 * A role the scenario declares people can be found in.
 *
 * `unique` slots have one holder per anchor -- a place has one guard captain --
 * so two players asking in the same turn converge on the same person. Repeatable
 * slots do not, so two players may meet different dockworkers.
 */
export const RoleSlotSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    /** Surface forms a player might type. Matched after normalisation. */
    phrases: z.array(z.string().trim().min(1).max(80)).min(1),
    unique: z.boolean(),
    /** Which institution, if any, the role belongs to. */
    institutionId: EntityIdSchema.nullable(),
  })
  .strict();
export type RoleSlot = z.infer<typeof RoleSlotSchema>;

export const ScenarioDialogueRulesSchema = z
  .object({
    roleSlots: z.array(RoleSlotSchema),
    /** Name pools per culture, so a provisional person is named in period. */
    namePools: z.record(EntityIdSchema, z.array(z.string().trim().min(1).max(80)).min(1)),
  })
  .strict();
export type ScenarioDialogueRules = z.infer<typeof ScenarioDialogueRulesSchema>;

export const DialogueMessageSchema = z
  .object({
    id: EntityIdSchema,
    sessionId: EntityIdSchema,
    sequence: z.number().int().nonnegative(),
    speakerCharacterId: EntityIdSchema,
    /** Immutable once appended. A retraction is another message, not an edit. */
    body: z.string().trim().min(1).max(4_000),
    acts: z.array(DialogueActSchema),
    disclosedFactIds: z.array(EntityIdSchema),
  })
  .strict();
export type DialogueMessage = z.infer<typeof DialogueMessageSchema>;

/**
 * What one conversation staged for the open turn.
 *
 * Merged into world knowledge and continuity at resolution, in canonical order.
 * It is an overlay rather than a write because two players may talk to the same
 * NPC in the same turn and must not see each other's exchange.
 */
export const DialogueOverlaySchema = z
  .object({
    sessionId: EntityIdSchema,
    threadId: EntityIdSchema,
    playerCharacterId: EntityIdSchema,
    npcCharacterId: EntityIdSchema,
    channel: DialogueChannelSchema,
    /** The exact turn-opening state this session was isolated against. */
    baseStateHash: z.string().trim().min(1).max(128),
    disclosedFactIds: z.array(EntityIdSchema),
    acts: z.array(DialogueActSchema),
    witnessIds: z.array(EntityIdSchema),
    visibility: VisibilitySchema,
    /** Set when the exchange was meaningful enough to write the person in. */
    encounterCandidate: z
      .object({ kind: z.literal("conversation"), outcome: z.string().trim().min(1).max(400) })
      .strict()
      .nullable(),
    openedAtStep: ElapsedStepSchema,
  })
  .strict();
export type DialogueOverlay = z.infer<typeof DialogueOverlaySchema>;
