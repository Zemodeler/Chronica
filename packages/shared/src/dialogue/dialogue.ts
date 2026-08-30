import { z } from "zod";
import { EntityIdSchema } from "../material-state";

// Character dialogue (docs/17, ADR-0025).
//
// Players speak to the people in their character's world through a
// messenger-style chat panel. Conversations are always in-character and
// affect NPC knowledgebases, which in turn influence future world events.

export const DialogueChannelSchema = z.enum([
  "in_person_private",
  "in_person_public",
  "audience",
  "messenger",
  "correspondence",
]);
export type DialogueChannel = z.infer<typeof DialogueChannelSchema>;

export const DialogueMessageSchema = z
  .object({
    id: EntityIdSchema,
    sessionId: EntityIdSchema,
    sequence: z.number().int().nonnegative(),
    speakerCharacterId: z.string(),
    isPlayerMessage: z.boolean(),
    body: z.string().trim().min(1).max(4_000),
  })
  .strict();
export type DialogueMessage = z.infer<typeof DialogueMessageSchema>;

export const ConversationMemoryEntrySchema = z
  .object({
    exchange: z.string().trim().min(1).max(600),
    stepOccurred: z.number().int().nonnegative(),
    salience: z.enum(["low", "medium", "high"]),
  })
  .strict();
export type ConversationMemoryEntry = z.infer<typeof ConversationMemoryEntrySchema>;

export const ConversationConsequenceSchema = z
  .object({
    id: EntityIdSchema,
    type: z.enum(["deal", "enmity", "alliance", "information", "insult"]),
    description: z.string().trim().min(1).max(400),
    parties: z.array(z.string()),
    occurredAtStep: z.number().int().nonnegative(),
  })
  .strict();
export type ConversationConsequence = z.infer<typeof ConversationConsequenceSchema>;

export const NpcChatKnowledgebaseSchema = z
  .object({
    id: EntityIdSchema,
    gameId: EntityIdSchema,
    playerId: EntityIdSchema,
    npcCharacterId: z.string(),
    canonicalName: z.string().trim().min(1),
    personalitySummary: z.string().max(600),
    relationshipLabel: z.enum(["ally", "rival", "neutral", "suspicious", "superior", "subordinate"]),
    relationshipScore: z.number().int().min(-100).max(100),
    conversationMemory: z.array(ConversationMemoryEntrySchema),
    significantEvents: z.array(z.string()),
    consequences: z.array(ConversationConsequenceSchema),
    relevancyScore: z.number().int().nonnegative(),
    interactionCount: z.number().int().nonnegative(),
    locationProvinceId: z.string().nullable(),
    isAvailable: z.boolean(),
  })
  .strict();
export type NpcChatKnowledgebase = z.infer<typeof NpcChatKnowledgebaseSchema>;

/**
 * A role the scenario declares people can be found in.
 * Used by the scenario definition (scenario.ts) for role-based NPC resolution.
 */
export const RoleSlotSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(80),
    phrases: z.array(z.string().trim().min(1).max(80)).min(1),
    unique: z.boolean(),
    institutionId: EntityIdSchema.nullable(),
  })
  .strict();
export type RoleSlot = z.infer<typeof RoleSlotSchema>;

export const ScenarioDialogueRulesSchema = z
  .object({
    roleSlots: z.array(RoleSlotSchema),
    namePools: z.record(EntityIdSchema, z.array(z.string().trim().min(1).max(80)).min(1)),
  })
  .strict();
export type ScenarioDialogueRules = z.infer<typeof ScenarioDialogueRulesSchema>;
