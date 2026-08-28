import { z } from "zod";
import { EntityIdSchema, VisibilitySchema } from "../material-state";
import { StepRangeSchema } from "./orders";
import { WorldStorylineSchema } from "../world/storylines";

export const OrderInterpretationSchema = z.object({
  directiveId: EntityIdSchema,
  intent: z.string().trim().min(1).max(600),
  targetIds: z.array(EntityIdSchema).max(16),
  priorities: z.array(z.string().trim().min(1).max(180)).max(8),
  conditions: z.array(z.string().trim().min(1).max(240)).max(8),
  proposedSteps: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
  risks: z.array(z.string().trim().min(1).max(240)).max(12),
  duration: StepRangeSchema,
}).strict();
export type OrderInterpretation = z.infer<typeof OrderInterpretationSchema>;

/** Effects the AI may propose. Hard world state is intentionally absent. */
export const BoundedAiEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("character_reaction"),
    cause: z.string().trim().min(1).max(320),
    characterId: EntityIdSchema,
    targetCharacterId: EntityIdSchema.nullable(),
    consequence: z.string().trim().min(1).max(480),
    visibility: VisibilitySchema,
  }).strict(),
  z.object({
    kind: z.literal("storyline_update"),
    cause: z.string().trim().min(1).max(320),
    storylineId: EntityIdSchema.nullable(),
    title: z.string().trim().min(1).max(160),
    participantIds: z.array(EntityIdSchema).max(16),
    provinceId: EntityIdSchema.nullable(),
    phase: z.string().trim().min(1).max(80),
    stakes: z.string().trim().min(1).max(320),
    development: z.string().trim().min(1).max(480),
    nextDevelopment: z.string().trim().min(1).max(320),
    visibility: VisibilitySchema,
  }).strict(),
]);
export type BoundedAiEffect = z.infer<typeof BoundedAiEffectSchema>;

export const SoloChronicleEntrySchema = z.object({
  directiveIds: z.array(EntityIdSchema).max(32),
  body: z.string().trim().min(1).max(2_000),
}).strict();
export type SoloChronicleEntry = z.infer<typeof SoloChronicleEntrySchema>;

export const SoloTurnOutcomeSchema = z.object({
  turnId: EntityIdSchema,
  elapsedSteps: z.number().int().min(1).max(12),
  interpretations: z.array(OrderInterpretationSchema).min(1).max(32),
  directiveResults: z.array(z.object({
    directiveId: EntityIdSchema,
    outcome: z.enum(["succeeds", "partially_succeeds", "fails", "blocked"]),
    consequence: z.string().trim().min(1).max(800),
  }).strict()).min(1).max(32),
  effects: z.array(BoundedAiEffectSchema).max(16),
  storylines: z.array(WorldStorylineSchema).max(16).default([]),
  chronicle: z.object({
    title: z.string().trim().min(1).max(180),
    summary: z.string().trim().min(1).max(800),
    entries: z.array(SoloChronicleEntrySchema).min(1).max(24),
  }).strict(),
}).strict();
export type SoloTurnOutcome = z.infer<typeof SoloTurnOutcomeSchema>;
