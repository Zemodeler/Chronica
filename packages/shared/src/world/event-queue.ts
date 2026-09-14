import { z } from "zod";
import { EntityIdSchema } from "../material-state";
import { WorldInstantSchema, worldInstantToSortKey, type WorldInstant } from "./instant";

/**
 * The persistent event queue's Zod-validated shapes (docs/32, Phase 7).
 * Mirrors `packages/db/src/schema/events.ts`'s `worldEvents` table exactly --
 * enum values here must match the DB enums.
 */

export const WorldEventKindSchema = z.enum([
  "action_phase",
  "world_process_tick",
  "midnight_tick",
  "order_deadline",
  "reaction_window",
]);
export type WorldEventKind = z.infer<typeof WorldEventKindSchema>;

export const WorldEventStatusSchema = z.enum(["pending", "claimed", "resolved", "cancelled", "superseded"]);
export type WorldEventStatus = z.infer<typeof WorldEventStatusSchema>;

const SubjectRefSchema = z.object({ kind: z.string().min(1).max(40), id: EntityIdSchema }).strict();

/** Validated per-kind at enqueue and at claim time -- never a raw/untyped payload at the write path. */
export const WorldEventPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("action_phase"),
    actionId: EntityIdSchema,
    stageId: EntityIdSchema.optional(),
    /**
     * The actor and parameters to invoke `actionId` with when this event is
     * resolved (docs/32 corrective pass, requirement 3) -- present for an
     * event a reaction agent scheduled instead of mutating the world
     * immediately from a deferred-mutation session; absent for the
     * pre-existing bare `{actionId, stageId}` shape (a plan-stage
     * reference some other, not-yet-built handler resolves its own way).
     */
    actorId: EntityIdSchema.optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    kind: z.literal("world_process_tick"),
    // docs/32, Part C.6: "project" advances a Project's next due milestone (world/project.ts).
    // World matters, Phase 6 (docs/plans/ai-world-matters-runtime.md,
    // "Chronological integration"): "matter" reviews one named `WorldMatter`
    // at its own real `WorldInstant`. `processKind` lives only in this Zod
    // schema, not a Postgres enum (`packages/db/src/schema/events.ts` stores
    // `payload` as `jsonb`), so adding this value needs no migration.
    processKind: z.enum(["construction", "travel", "supply", "siege", "project", "matter"]),
    targetRef: SubjectRefSchema,
  }).strict(),
  z.object({ kind: z.literal("midnight_tick") }).strict(),
  z.object({ kind: z.literal("order_deadline"), orderId: EntityIdSchema, deadlineKind: z.string().min(1).max(60) }).strict(),
  z.object({
    kind: z.literal("reaction_window"),
    triggeringFactId: z.string().min(1).max(120),
    candidateEntityRefs: z.array(SubjectRefSchema).max(16).default([]),
  }).strict(),
]);
export type WorldEventPayload = z.infer<typeof WorldEventPayloadSchema>;

export const WorldEventRecordSchema = z
  .object({
    id: EntityIdSchema,
    gameId: EntityIdSchema,
    scheduledForTurnId: EntityIdSchema.nullable().default(null),
    kind: WorldEventKindSchema,
    status: WorldEventStatusSchema.default("pending"),
    instant: WorldInstantSchema,
    priority: z.number().int().default(0),
    isPlayerAction: z.boolean().default(false),
    subjectRef: SubjectRefSchema,
    actionId: EntityIdSchema.nullable().default(null),
    operationId: EntityIdSchema.nullable().default(null),
    payload: WorldEventPayloadSchema,
    causalDepth: z.number().int().nonnegative().default(0),
    causedByEventId: EntityIdSchema.nullable().default(null),
    causedByFactId: z.string().max(120).nullable().default(null),
    createdAtStep: z.number().int().nonnegative(),
    resolvedAtStep: z.number().int().nonnegative().nullable().default(null),
    resolvedFactIds: z.array(z.string().max(120)).default([]),
  })
  .strict()
  .refine((event) => event.payload.kind === event.kind, {
    message: "An event's payload discriminant must match its own kind.",
    path: ["payload"],
  });
export type WorldEventRecord = z.infer<typeof WorldEventRecordSchema>;

/** The 3-causal-layer reaction cap (docs/32, Phase 7): no new event may chain past this depth without resetting. */
export const MAX_REACTION_CAUSAL_DEPTH = 3;

/**
 * Pure selection over an in-memory batch of pending events: the next one due
 * at or before `atOrBefore`, ordered by exact instant, then priority, then
 * player-ready-action first among ties -- the ordering that guarantees an
 * earlier world event resolves before a same-or-later player order, while
 * two events genuinely tied at the same instant resolve the player's first.
 * Kept pure (no DB) so it is testable without a live database, matching how
 * `workflows/executor.ts` and `plans.ts` are pure over `WorldState`; the
 * resolver loads a bounded window of pending rows per turn and calls this.
 */
export function nextDueEvent(events: readonly WorldEventRecord[], atOrBefore: WorldInstant): WorldEventRecord | null {
  const dueKey = worldInstantToSortKey(atOrBefore);
  let best: WorldEventRecord | null = null;
  let bestKey = -1;
  for (const event of events) {
    if (event.status !== "pending") continue;
    const key = worldInstantToSortKey(event.instant);
    if (key > dueKey) continue;
    if (best === null) {
      best = event;
      bestKey = key;
      continue;
    }
    if (key < bestKey) {
      best = event;
      bestKey = key;
      continue;
    }
    if (key === bestKey) {
      const bestIsPlayer = best.isPlayerAction;
      const eventIsPlayer = event.isPlayerAction;
      if (eventIsPlayer && !bestIsPlayer) {
        best = event;
        continue;
      }
      if (eventIsPlayer === bestIsPlayer && event.priority > best.priority) {
        best = event;
      }
    }
  }
  return best;
}
