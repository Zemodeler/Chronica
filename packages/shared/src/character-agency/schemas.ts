import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";
import { ProposedInvocationSchema } from "../actions/orders";

// Persistent character agency (Character Director, docs/XX).
//
// Characters important enough to receive Character Director attention maintain
// durable goals and plots that survive save/load and replay. Neither goals nor
// plots are authoritative facts: they are proposals the shared resolver must
// validate and execute. The resolver, not the Character Director, decides what
// actually happens.

export const CharacterGoalCategorySchema = z.enum([
  "preserve_power",
  "acquire_office",
  "discredit_rival",
  "alliance",
  "revenge",
  "resource",
  "narrative",
]);
export type CharacterGoalCategory = z.infer<typeof CharacterGoalCategorySchema>;

export const CharacterGoalStatusSchema = z.enum(["active", "achieved", "abandoned", "failed"]);
export type CharacterGoalStatus = z.infer<typeof CharacterGoalStatusSchema>;

const GoalHistoryEntrySchema = z
  .object({
    atStep: ElapsedStepSchema,
    note: z.string().trim().min(1).max(240),
  })
  .strict();

export const CharacterGoalSchema = z
  .object({
    id: EntityIdSchema,
    characterId: EntityIdSchema,
    objective: z.string().trim().min(1).max(240),
    category: CharacterGoalCategorySchema,
    targetEntityIds: z.array(EntityIdSchema).max(8),
    priority: z.number().int().min(1).max(5),
    status: CharacterGoalStatusSchema,
    visibility: VisibilitySchema,
    causalFactIds: z.array(EntityIdSchema).max(8),
    createdAtStep: ElapsedStepSchema,
    updatedAtStep: ElapsedStepSchema,
    history: z.array(GoalHistoryEntrySchema).max(10),
  })
  .strict();
export type CharacterGoal = z.infer<typeof CharacterGoalSchema>;

export const CharacterPlotStageSchema = z.enum([
  "forming",
  "preparing",
  "attempting",
  "consequence",
  "adapting",
  "resolved",
]);
export type CharacterPlotStage = z.infer<typeof CharacterPlotStageSchema>;

export const CharacterPlotStatusSchema = z.enum([
  "active",
  "succeeded",
  "failed",
  "abandoned",
  "exposed",
  "stalled",
]);
export type CharacterPlotStatus = z.infer<typeof CharacterPlotStatusSchema>;

const PlotHistoryEntrySchema = z
  .object({
    atStep: ElapsedStepSchema,
    stage: CharacterPlotStageSchema,
    note: z.string().trim().min(1).max(240),
  })
  .strict();

export const CharacterPlotSchema = z
  .object({
    id: EntityIdSchema,
    characterId: EntityIdSchema,
    goalId: EntityIdSchema,
    worldStorylineId: EntityIdSchema.nullable(),
    participantIds: z.array(EntityIdSchema).max(12),
    allyIds: z.array(EntityIdSchema).max(8),
    targetIds: z.array(EntityIdSchema).max(8),
    objective: z.string().trim().min(1).max(320),
    stage: CharacterPlotStageSchema,
    momentum: z.number().int().min(0).max(100),
    stakes: z.string().trim().min(1).max(320),
    visibility: VisibilitySchema,
    currentObstacle: z.string().trim().min(1).max(320).nullable(),
    nextIntendedMove: z.string().trim().min(1).max(320).nullable(),
    status: CharacterPlotStatusSchema,
    causalHistory: z.array(PlotHistoryEntrySchema).max(10),
    createdAtStep: ElapsedStepSchema,
    updatedAtStep: ElapsedStepSchema,
  })
  .strict();
export type CharacterPlot = z.infer<typeof CharacterPlotSchema>;

export const NemesisStateSchema = z
  .object({
    characterId: EntityIdSchema.nullable(),
    active: z.boolean(),
    assignedAtStep: ElapsedStepSchema,
    reason: z.string().trim().max(320),
    deactivatedAtStep: ElapsedStepSchema.nullable(),
    deactivationReason: z.string().trim().max(320).nullable(),
  })
  .strict();
export type NemesisState = z.infer<typeof NemesisStateSchema>;

export const DEFAULT_NEMESIS_STATE: NemesisState = {
  characterId: null,
  active: false,
  assignedAtStep: 0,
  reason: "",
  deactivatedAtStep: null,
  deactivationReason: null,
};

/** Multi-slot Nemesis entry — one entry per antagonist. */
export const NemesisEntrySchema = z
  .object({
    characterId: EntityIdSchema,
    active: z.boolean(),
    assignedAtStep: ElapsedStepSchema,
    reason: z.string().trim().max(320),
    deactivatedAtStep: ElapsedStepSchema.nullable().default(null),
    deactivationReason: z.string().trim().max(320).nullable().default(null),
  })
  .strict();
export type NemesisEntry = z.infer<typeof NemesisEntrySchema>;

/** Chronicle-appearance scoring entry for character relevance decay. */
export const CharacterAppearanceSchema = z
  .object({
    atStep: ElapsedStepSchema,
    role: z.enum(["protagonist", "antagonist", "participant", "mentioned"]),
  })
  .strict();

export const CharacterRelevanceEntrySchema = z
  .object({
    characterId: EntityIdSchema,
    chronicleAppearances: z.array(CharacterAppearanceSchema).max(20),
    lastAppearanceStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type CharacterRelevanceEntry = z.infer<typeof CharacterRelevanceEntrySchema>;

// Character Director suggestion output — advisor-only, no workflow invocations.
export const CharacterSuggestionKindSchema = z.enum([
  "create_goal",
  "update_goal",
  "create_plot",
  "advance_plot",
  "resolve_plot",
  "react",
  "develop_relationship",
]);
export type CharacterSuggestionKind = z.infer<typeof CharacterSuggestionKindSchema>;

const CharacterGoalInputSchema = z
  .object({
    objective: z.string().trim().min(1).max(240),
    category: CharacterGoalCategorySchema,
    targetEntityIds: z.array(EntityIdSchema).max(8),
    priority: z.number().int().min(1).max(5),
    visibility: VisibilitySchema,
  })
  .strict();

const CharacterPlotInputForSuggestionSchema = z
  .object({
    goalId: EntityIdSchema,
    objective: z.string().trim().min(1).max(320),
    participantIds: z.array(EntityIdSchema).max(12),
    targetIds: z.array(EntityIdSchema).max(8),
    visibility: VisibilitySchema,
    stakes: z.string().trim().min(1).max(320),
    currentObstacle: z.string().trim().min(1).max(320).nullable(),
  })
  .strict();

export const CharacterSuggestionSchema = z
  .object({
    characterId: EntityIdSchema,
    suggestionKind: CharacterSuggestionKindSchema,
    goalId: EntityIdSchema.nullable().default(null),
    plotId: EntityIdSchema.nullable().default(null),
    proposedGoal: CharacterGoalInputSchema.nullable().default(null),
    proposedPlot: CharacterPlotInputForSuggestionSchema.nullable().default(null),
    /** Required for a substantive update; null means record the rationale only. */
    goalStatus: CharacterGoalStatusSchema.nullable().default(null),
    /** Required to advance an existing plot; the resolver will not guess a stage. */
    plotStage: CharacterPlotStageSchema.nullable().default(null),
    /** Required to resolve a plot; only terminal statuses are accepted. */
    plotResolutionStatus: z.enum(["succeeded", "failed", "abandoned", "exposed", "stalled"]).nullable().default(null),
    rationale: z.string().trim().max(400),
    causalFactIds: z.array(EntityIdSchema).max(8).default([]),
    affectedEntityIds: z.array(EntityIdSchema).max(12).default([]),
    storylineId: EntityIdSchema.nullable().default(null),
    visibility: VisibilitySchema,
    salience: z.number().int().min(0).max(10),
  })
  .strict();
export type CharacterSuggestion = z.infer<typeof CharacterSuggestionSchema>;

export const CharacterSuggestionBatchSchema = z
  .object({
    suggestions: z.array(CharacterSuggestionSchema).max(16),
  })
  .strict();
export type CharacterSuggestionBatch = z.infer<typeof CharacterSuggestionBatchSchema>;

// Legacy Character Director decision output — kept for backward compat; new pipeline uses CharacterSuggestion.
export const CharacterDecisionKindSchema = z.enum([
  "wait",
  "prepare",
  "create_goal",
  "update_goal",
  "create_plot",
  "advance_plot",
  "act",
  "react",
  "adapt",
  "abandon",
  "resolve",
]);
export type CharacterDecisionKind = z.infer<typeof CharacterDecisionKindSchema>;

const CharacterPlotInputSchema = z
  .object({
    goalId: EntityIdSchema,
    objective: z.string().trim().min(1).max(320),
    participantIds: z.array(EntityIdSchema).max(12),
    targetIds: z.array(EntityIdSchema).max(8),
    visibility: VisibilitySchema,
    stakes: z.string().trim().min(1).max(320),
    currentObstacle: z.string().trim().min(1).max(320).nullable(),
  })
  .strict();

export const CharacterDecisionSchema = z
  .object({
    characterId: EntityIdSchema,
    kind: CharacterDecisionKindSchema,
    goalId: EntityIdSchema.nullable(),
    proposedGoal: CharacterGoalInputSchema.nullable(),
    plotId: EntityIdSchema.nullable(),
    proposedPlot: CharacterPlotInputSchema.nullable(),
    causalFactIds: z.array(EntityIdSchema).max(8),
    affectedEntityIds: z.array(EntityIdSchema).max(12),
    storylineId: EntityIdSchema.nullable(),
    privateRationale: z.string().trim().min(1).max(600),
    visibility: VisibilitySchema,
    salience: z.number().int().min(0).max(10),
    workflowInvocations: z.array(ProposedInvocationSchema).max(2),
  })
  .strict();
export type CharacterDecision = z.infer<typeof CharacterDecisionSchema>;

export const CharacterDecisionBatchSchema = z
  .object({
    decisions: z.array(CharacterDecisionSchema).max(16),
  })
  .strict();
export type CharacterDecisionBatch = z.infer<typeof CharacterDecisionBatchSchema>;

// Selection tier — used for diagnostics and to bound consideration cost.
export const CharacterSelectionTierSchema = z.enum(["persistent", "important", "background"]);
export type CharacterSelectionTier = z.infer<typeof CharacterSelectionTierSchema>;

export interface SelectedCharacter {
  readonly characterId: string;
  readonly tier: CharacterSelectionTier;
  readonly reasons: readonly string[];
}
