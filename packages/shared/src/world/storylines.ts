import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";
import { OrderPartyRefSchema } from "./party-ref";

/**
 * A durable, world-owned thread of history rather than one-off narration.
 *
 * Where a storyline comes from is not where it goes: a plot the narrator seeded
 * and a crisis the scenario authored are advanced by the same delta and read by
 * the same people. `origin` records provenance for inspection and the sprawl
 * guard, nothing more.
 */
export const StorylinePhaseSchema = z.enum(["brewing", "escalating", "crisis", "resolving", "closed"]);
export type StorylinePhase = z.infer<typeof StorylinePhaseSchema>;

export const StorylineOriginSchema = z.enum(["scenario", "world", "character"]);
export type StorylineOrigin = z.infer<typeof StorylineOriginSchema>;

export const WorldStorylineSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().trim().min(1).max(160),
    participantIds: z.array(EntityIdSchema).max(16),
    provinceId: EntityIdSchema.nullable(),
    phase: StorylinePhaseSchema,
    stakes: z.string().trim().min(1).max(320),
    history: z.array(z.string().trim().min(1).max(480)).max(24),
    nextDevelopment: z.string().trim().min(1).max(320),
    /** A private storyline is known to its participants alone; the world sees it, nobody in the world does. */
    visibility: VisibilitySchema,
    origin: StorylineOriginSchema.default("scenario"),
    /** Null for scenario data; the world's own ref when the orchestrator opened it; the NPC when one of them did. */
    openedByRef: OrderPartyRefSchema.nullable().default(null),
    openedAtStep: ElapsedStepSchema.default(0),
    updatedAtStep: ElapsedStepSchema,
    closedAtStep: ElapsedStepSchema.nullable().default(null),
    /** The facts on record that belong to this thread, most recent last. */
    causalFactIds: z.array(EntityIdSchema).max(16).default([]),
    /** Set when the narrator seeded it: the handle the engine checks to know its seed was taken up. */
    seedKey: z.string().trim().min(1).max(80).nullable().default(null),
  })
  .strict();
export type WorldStoryline = z.infer<typeof WorldStorylineSchema>;

/** Threads still running: everything a model should be shown or weighed by. */
export function openStorylines(storylines: readonly WorldStoryline[]): WorldStoryline[] {
  return storylines.filter((storyline) => storyline.phase !== "closed");
}
