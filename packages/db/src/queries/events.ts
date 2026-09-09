import { and, asc, eq, lte } from "drizzle-orm";
import type { Fact, WorldEventKind, WorldEventPayload, WorldEventRecord, WorldInstant } from "@chronica/shared";
import { worldInstantFromSortKey, worldInstantToSortKey } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { worldEvents, worldFacts } from "../schema/events";

// The persistent event queue (docs/32, Phase 7). Write and read only --
// selection logic itself (`nextDueEvent`) is pure and lives in
// `@chronica/shared`'s `world/event-queue.ts`; this module's job is only to
// get rows in and out of Postgres in the shapes that function expects.

export interface NewWorldEvent {
  readonly kind: WorldEventKind;
  readonly instant: WorldInstant;
  readonly priority?: number;
  readonly isPlayerAction?: boolean;
  readonly subjectRef: { readonly kind: string; readonly id: string };
  readonly actionId?: string | null;
  readonly operationId?: string | null;
  readonly payload: WorldEventPayload;
  readonly causalDepth?: number;
  readonly causedByEventId?: string | null;
  readonly causedByFactId?: string | null;
  readonly createdAtStep: number;
}

function toRecord(row: typeof worldEvents.$inferSelect): WorldEventRecord {
  return {
    id: row.id,
    gameId: row.gameId,
    scheduledForTurnId: row.scheduledForTurnId,
    kind: row.kind,
    status: row.status,
    instant: { day: row.instantDay, minute: row.instantMinute },
    priority: row.priority,
    isPlayerAction: row.isPlayerAction,
    subjectRef: row.subjectRef,
    actionId: row.actionId,
    operationId: row.operationId,
    payload: row.payload as WorldEventPayload,
    causalDepth: row.causalDepth,
    causedByEventId: row.causedByEventId,
    causedByFactId: row.causedByFactId,
    createdAtStep: row.createdAtStep,
    resolvedAtStep: row.resolvedAtStep,
    resolvedFactIds: row.resolvedFactIds ?? [],
  };
}

export async function insertWorldEvents(db: ChronicaDatabase, gameId: string, events: readonly NewWorldEvent[]): Promise<WorldEventRecord[]> {
  if (events.length === 0) return [];
  const rows = await db
    .insert(worldEvents)
    .values(
      events.map((event) => ({
        gameId,
        kind: event.kind,
        instantSortKey: worldInstantToSortKey(event.instant),
        instantDay: event.instant.day,
        instantMinute: event.instant.minute,
        priority: event.priority ?? 0,
        isPlayerAction: event.isPlayerAction ?? false,
        subjectRef: event.subjectRef,
        actionId: event.actionId ?? null,
        operationId: event.operationId ?? null,
        payload: event.payload,
        causalDepth: event.causalDepth ?? 0,
        causedByEventId: event.causedByEventId ?? null,
        causedByFactId: event.causedByFactId ?? null,
        createdAtStep: event.createdAtStep,
      })),
    )
    .returning();
  return rows.map(toRecord);
}

/** A bounded batch of pending events due at or before `atOrBefore`, for `nextDueEvent` (pure, in `@chronica/shared`) to select from. */
export async function listDuePendingEvents(db: ChronicaDatabase, gameId: string, atOrBefore: WorldInstant, limit = 200): Promise<WorldEventRecord[]> {
  const rows = await db
    .select()
    .from(worldEvents)
    .where(and(eq(worldEvents.gameId, gameId), eq(worldEvents.status, "pending"), lte(worldEvents.instantSortKey, worldInstantToSortKey(atOrBefore))))
    .orderBy(asc(worldEvents.instantSortKey), asc(worldEvents.priority))
    .limit(limit);
  return rows.map(toRecord);
}

/**
 * Releases any event this game claimed whose claim has expired (the caller
 * crashed or timed out mid-resolution) back to `pending`, so it is picked up
 * again rather than stuck forever -- same purpose as `turns.claimExpiresAt`,
 * applied per-event since a turn's own single claim isn't fine-grained
 * enough for a queue of many small events within it.
 */
export async function releaseExpiredWorldEventClaims(db: ChronicaDatabase, gameId: string): Promise<number> {
  const rows = await db
    .update(worldEvents)
    .set({ status: "pending", claimedBy: null, claimExpiresAt: null })
    .where(and(eq(worldEvents.gameId, gameId), eq(worldEvents.status, "claimed"), lte(worldEvents.claimExpiresAt, new Date())))
    .returning({ id: worldEvents.id });
  return rows.length;
}

export async function claimWorldEvent(db: ChronicaDatabase, id: string, claimedBy: string, claimExpiresAt: Date, turnId: string | null): Promise<boolean> {
  const rows = await db
    .update(worldEvents)
    .set({ status: "claimed", claimedBy, claimExpiresAt, scheduledForTurnId: turnId })
    .where(and(eq(worldEvents.id, id), eq(worldEvents.status, "pending")))
    .returning({ id: worldEvents.id });
  return rows.length > 0;
}

export async function resolveWorldEvent(db: ChronicaDatabase, id: string, resolvedAtStep: number, resolvedFactIds: readonly string[]): Promise<boolean> {
  const rows = await db
    .update(worldEvents)
    .set({ status: "resolved", resolvedAtStep, resolvedFactIds: [...resolvedFactIds] })
    .where(eq(worldEvents.id, id))
    .returning({ id: worldEvents.id });
  return rows.length > 0;
}

export async function cancelWorldEvent(db: ChronicaDatabase, id: string): Promise<boolean> {
  const rows = await db.update(worldEvents).set({ status: "cancelled" }).where(eq(worldEvents.id, id)).returning({ id: worldEvents.id });
  return rows.length > 0;
}

export async function supersedeWorldEvent(db: ChronicaDatabase, id: string): Promise<boolean> {
  const rows = await db.update(worldEvents).set({ status: "superseded" }).where(eq(worldEvents.id, id)).returning({ id: worldEvents.id });
  return rows.length > 0;
}

// The canonical Fact ledger (`world/facts.ts`'s `FactSchema`).

export async function insertWorldFacts(db: ChronicaDatabase, gameId: string, turnId: string | null, facts: readonly Fact[]): Promise<void> {
  if (facts.length === 0) return;
  await db.insert(worldFacts).values(
    facts.map((fact) => ({
      id: fact.id,
      gameId,
      turnId,
      atStep: fact.atStep,
      instantDay: fact.time.day,
      instantMinute: fact.time.minute,
      kind: fact.kind,
      visibility: fact.visibility,
      data: fact,
    })),
  );
}

export async function listFactsForGame(db: ChronicaDatabase, gameId: string, limit = 500): Promise<Fact[]> {
  const rows = await db
    .select({ data: worldFacts.data })
    .from(worldFacts)
    .where(eq(worldFacts.gameId, gameId))
    .orderBy(asc(worldFacts.atStep))
    .limit(limit);
  return rows.map((row) => row.data);
}

export { worldInstantFromSortKey };
