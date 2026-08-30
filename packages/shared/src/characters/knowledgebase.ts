import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import { CharacterSkillsSchema } from "./character";

// Character Knowledgebase (character-implementation).
//
// Produced once by the declare_character AI operation and stored as JSONB.
// Optimised for repeated AI reads: biography is dense prose, not bullet points.
// Skill values are always present; skill rationale is for AI context only.
// Invisible to the player entirely.

export const KnowledgebaseRelationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().min(1).max(80),
    historical: z.boolean(),
    notes: z.string().trim().min(1).max(300),
  })
  .strict();
export type KnowledgebaseRelation = z.infer<typeof KnowledgebaseRelationSchema>;

export const CharacterKnowledgebaseSchema = z
  .object({
    version: z.literal(1),
    characterId: EntityIdSchema,
    gameId: EntityIdSchema,

    // Core identity
    canonicalName: z.string().trim().min(1).max(120),
    /** Set when the player-supplied name is not historically accurate. */
    nickname: z.string().trim().min(1).max(120).nullable(),
    birthYearApprox: z.number().int().nullable(),
    deathYearApprox: z.number().int().nullable(),
    /** historical = researched from model knowledge; invented = fully AI-created; hybrid = real figure, filled gaps. */
    origin: z.enum(["historical", "invented", "hybrid"]),

    // Historical and cultural context
    period: z.string().trim().min(1).max(200),
    /** The scenario-map region in which the character is present at the opening. */
    locationProvinceId: EntityIdSchema.nullable().default(null),
    culture: z.string().trim().min(1).max(120),
    faith: z.string().trim().min(1).max(120).nullable(),
    /** 200–600 words. Dense prose, optimised for repeated AI reads. */
    biography: z.string().trim().min(50).max(3000),
    notableEvents: z.array(z.string().trim().min(1).max(300)),

    // Position
    role: z.string().trim().min(1).max(160),
    /** Concrete offices, commands, or holdings through which the character acts. */
    authority: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
    socioEconomicClass: z.string().trim().min(1).max(80),

    // Skills — always assigned; rationale is AI context only, never shown to player
    skills: CharacterSkillsSchema,
    skillRationale: z.record(z.string(), z.string().trim().min(1).max(200)),

    // Seed relations
    relations: z.array(KnowledgebaseRelationSchema),

    // Confirmation state
    confirmedByPlayer: z.boolean(),
    /** Shown to the player during the confirmation step; null once confirmed. */
    confirmationDraft: z.string().trim().min(1).max(1500).nullable(),
  })
  .strict();
export type CharacterKnowledgebase = z.infer<typeof CharacterKnowledgebaseSchema>;
