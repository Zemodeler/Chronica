import { z } from "zod";
import { EntityIdSchema, MoneyAmountSchema } from "../material-state";
import { CharacterSkillsSchema } from "./character";

// Character Knowledgebase (character-implementation).
//
// Produced once by the declare_character AI operation and stored as JSONB.
// Optimised for repeated AI reads: biography is dense prose, not bullet points.
// Skill values are always present; skill rationale is for AI context only.
// Invisible to the player entirely.

const NonPersonRelationPattern = /\b(army|navy|fleet|legion|senate|council|assembly|republic|empire|kingdom|state|tribe|dynasty|house)\b/i;

export const KnowledgebaseRelationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().min(1).max(80),
    historical: z.boolean(),
    notes: z.string().trim().min(1).max(300),
    /** Relations are always individually named people, never organisations or forces. */
    kind: z.literal("person"),
    category: z.enum(["family", "other"]),
    /** Placement in the compact family view; not applicable to other NPCs. */
    familyRole: z.enum(["parent", "partner", "sibling", "child", "other_relative"]).nullable(),
  })
  .strict()
  .superRefine((relation, context) => {
    if (NonPersonRelationPattern.test(relation.name)) {
      context.addIssue({ code: "custom", path: ["name"], message: "A key relation must be an individually named person, not an institution or force." });
    }
    if (relation.category === "family" && relation.familyRole === null) {
      context.addIssue({ code: "custom", path: ["familyRole"], message: "Family relations require a family-tree role." });
    }
    if (relation.category === "other" && relation.familyRole !== null) {
      context.addIssue({ code: "custom", path: ["familyRole"], message: "Only family relations may have a family-tree role." });
    }
  });
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
    /**
     * A person already in the world whose place the player takes: asked for a
     * station and no name, the player is the man who holds it, not a stranger
     * beside him. Unset or null, the player is somebody new.
     */
    becomesCharacterId: EntityIdSchema.nullable().optional(),

    // Historical and cultural context
    period: z.string().trim().min(1).max(200),
    /** The scenario-map region in which the character is present at the opening. */
    locationProvinceId: EntityIdSchema.nullable().default(null),
    culture: z.string().trim().min(1).max(120),
    faith: z.string().trim().min(1).max(120).nullable(),
    /** Optional, so a declaration from before these existed still parses as a free man. */
    gender: z.enum(["male", "female"]).optional(),
    legalStatus: z.enum(["free", "freed", "enslaved"]).optional(),
    /** Worked out from the birth year and the scenario's opening when the declaration is made. */
    ageYearsAtOpening: z.number().int().min(0).max(120).optional(),
    /** 200–600 words. Dense prose, optimised for repeated AI reads. */
    biography: z.string().trim().min(50).max(3000),
    notableEvents: z.array(z.string().trim().min(1).max(300)),

    // Position
    role: z.string().trim().min(1).max(160),
    /** Concrete offices, commands, or holdings through which the character acts. */
    authority: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
    socioEconomicClass: z.string().trim().min(1).max(80),
    /** Liquid personal funds at the scenario opening, in the scenario currency's base unit. */
    startingMoney: MoneyAmountSchema,

    // Skills — always assigned; rationale is AI context only, never shown to player
    skills: CharacterSkillsSchema,
    skillRationale: z.record(z.string(), z.string().trim().min(1).max(200)),

    // Seed relations
    relations: z.array(KnowledgebaseRelationSchema).min(4).max(8).superRefine((relations, context) => {
      if (!relations.some((relation) => relation.category === "family")) {
        context.addIssue({ code: "custom", message: "At least one family relation is required." });
      }
      if (!relations.some((relation) => relation.category === "other")) {
        context.addIssue({ code: "custom", message: "At least one non-family relation is required." });
      }
    }),

    // Confirmation state
    confirmedByPlayer: z.boolean(),
    /** Shown to the player during the confirmation step; null once confirmed. */
    confirmationDraft: z.string().trim().min(1).max(1500).nullable(),
  })
  .strict();
export type CharacterKnowledgebase = z.infer<typeof CharacterKnowledgebaseSchema>;
