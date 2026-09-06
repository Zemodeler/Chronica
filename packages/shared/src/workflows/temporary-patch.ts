import { z } from "zod";
import { EntityIdSchema, VisibilitySchema } from "../material-state";

// Retired (docs/27, docs/28): this was a generic, four-operation-kind patch
// applier for the Workflow Manager/director-committee pipeline's "novel
// action proposal" mechanism -- a way to give a one-off, AI-described action
// bounded, reviewable powers for the current turn without writing a real
// workflow. That pipeline is gone; `applyTemporaryWorkflowPatch` had zero
// call sites (confirmed by repo-wide search) even before this file was
// trimmed, because `pipeline.ts` now hardcodes `novelActionProposals: []` on
// every turn. The schema below stays only so `NovelActionProposalSchema`
// (manager-types.ts) can still parse any `novelActionProposals` row a
// campaign persisted before the Game Master refactor; nothing parses one into
// a mutation any more, the same "keep the type, remove the executable path"
// treatment `invented-workflow.ts` received.
const AccountDeltaPatchSchema = z.object({
  kind: z.literal("account_delta"),
  accountId: EntityIdSchema,
  amount: z.number().int().refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(240),
}).strict();

const ProvinceControlPatchSchema = z.object({
  kind: z.literal("province_control"),
  provinceId: EntityIdSchema,
  controllerPolityId: EntityIdSchema,
  firmnessBps: z.number().int().min(0).max(10_000),
}).strict();

const CharacterStatePatchSchema = z.object({
  kind: z.literal("character_state"),
  characterId: EntityIdSchema,
  healthBps: z.number().int().min(0).max(10_000).optional(),
  locationProvinceId: EntityIdSchema.optional(),
  polityId: EntityIdSchema.optional(),
}).strict().refine((value) => value.healthBps !== undefined || value.locationProvinceId !== undefined || value.polityId !== undefined, {
  message: "Character patch must change at least one field.",
});

const StorylinePatchSchema = z.object({
  kind: z.literal("create_storyline"),
  storylineId: EntityIdSchema,
  title: z.string().trim().min(1).max(160),
  participantIds: z.array(EntityIdSchema).max(16),
  provinceId: EntityIdSchema.nullable(),
  phase: z.string().trim().min(1).max(80),
  stakes: z.string().trim().min(1).max(320),
  nextDevelopment: z.string().trim().min(1).max(320),
  visibility: VisibilitySchema,
}).strict();

export const TemporaryWorkflowPatchSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  rationale: z.string().trim().min(1).max(600),
  actorId: EntityIdSchema,
  operations: z.array(z.discriminatedUnion("kind", [
    AccountDeltaPatchSchema,
    ProvinceControlPatchSchema,
    CharacterStatePatchSchema,
    StorylinePatchSchema,
  ])).min(1).max(6),
}).strict();
export type TemporaryWorkflowPatch = z.infer<typeof TemporaryWorkflowPatchSchema>;
