import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";

// Canonical character intent (character-sim phase 3).
//
// The intent hierarchy, from most to least enduring:
//   Drive (Phase 2 `CharacterMind.drives`) -> Ambition (`Character.ambitions`)
//   -> Goal (`CharacterGoal`) -> Plan (`CharacterPlot`, a bounded route toward
//   a goal) -> Intent (this) -> Commitment (`Commitment`, an obligation owed
//   to another character, which can itself become the source of a later
//   intent to fulfil/defer/break it).
//
// An intent is a proposal, not an outcome: it names one concrete action a
// character wants to take this turn, where it came from, and what it needs.
// It becomes `executed` only once the Game Master actually invokes the
// resulting workflow candidate (docs/30) -- the same command-contract gate
// every player and world-director action already goes through. A separate
// deterministic conflict-resolution pass used to run before that; it is
// retired (docs/31) since a genuinely conflicting second attempt is now
// refused by that command's own precondition check.

export const CharacterIntentActionTypeSchema = z.enum([
  "fulfill_commitment",
  "defer_commitment",
  "renegotiate_commitment",
  "break_commitment",
  "seek_support",
  "offer_favour",
  "request_assistance",
  "travel",
  "prepare",
  "wait",
  "reconcile",
  "threaten",
  "negotiate",
  "publicly_oppose",
  "investigate",
  "spread_belief",
  "advance_plot",
  "seek_office",
  "military_action",
  "economic_action",
  "sponsor_procedure",
  "pledge_support",
]);
export type CharacterIntentActionType = z.infer<typeof CharacterIntentActionTypeSchema>;

export const CharacterIntentStatusSchema = z.enum([
  "proposed",
  "prepared",
  "blocked",
  "executed",
  "deferred",
  "failed",
  "abandoned",
]);
export type CharacterIntentStatus = z.infer<typeof CharacterIntentStatusSchema>;

export const CharacterIntentSchema = z
  .object({
    id: EntityIdSchema,
    actorCharacterId: EntityIdSchema,
    sourceGoalId: EntityIdSchema.nullable().default(null),
    sourcePlotId: EntityIdSchema.nullable().default(null),
    sourceCommitmentId: EntityIdSchema.nullable().default(null),
    actionType: CharacterIntentActionTypeSchema,
    targetIds: z.array(EntityIdSchema).max(8),
    rationale: z.string().trim().max(400),
    /** Plain descriptions of what must hold for this to be legal -- not re-derived, just recorded for diagnostics. */
    prerequisites: z.array(z.string().trim().min(1).max(200)).max(6),
    /** Workflow registry ids this intent could execute through, if it is chosen and clears validation. */
    intendedWorkflowIds: z.array(EntityIdSchema).max(4),
    priority: z.number().int().min(0).max(100),
    status: CharacterIntentStatusSchema,
    createdAtStep: ElapsedStepSchema,
    reviewedAtStep: ElapsedStepSchema.nullable().default(null),
    expiresAtStep: ElapsedStepSchema.nullable().default(null),
    visibility: VisibilitySchema,
    sourceEventIds: z.array(EntityIdSchema).max(8).default([]),
    /** Filled in once this intent is resolved -- why it ended up where it did. */
    resolutionReason: z.string().trim().max(400).nullable().default(null),
  })
  .strict();
export type CharacterIntent = z.infer<typeof CharacterIntentSchema>;
