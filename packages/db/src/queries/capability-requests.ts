import { desc, eq } from "drizzle-orm";
import type { RecordedCapabilityRequest } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { capabilityRequests } from "../schema/game";

// Capability-gap requests (Game Master refactor, requirement 7).
//
// Write and read only. There is deliberately no query here that turns a
// request into an executable workflow: a request is reserved for needs that
// cannot be expressed as a safe world-data interaction.

export interface CapabilityRequestRow {
  readonly id: string;
  readonly gameId: string;
  readonly turnId: string;
  readonly atStep: number;
  readonly actorId: string;
  readonly proposedToolName: string;
  readonly requestedIntent: string;
  readonly request: unknown;
  readonly status: string;
  readonly reviewNote: string | null;
  readonly createdAt: Date;
}

export async function insertCapabilityRequests(
  db: ChronicaDatabase,
  requests: readonly RecordedCapabilityRequest[],
  gameId: string,
  turnId: string,
): Promise<void> {
  if (requests.length === 0) return;
  await db.insert(capabilityRequests).values(
    requests.map((recorded) => ({
      gameId,
      turnId,
      atStep: recorded.atStep,
      actorId: recorded.request.actorId,
      proposedToolName: recorded.request.proposedToolName,
      requestedIntent: recorded.request.requestedIntent,
      request: recorded.request,
      status: recorded.resolution,
    })),
  );
}

/** Developer review listing, newest first. */
export async function listCapabilityRequests(db: ChronicaDatabase, limit = 100): Promise<CapabilityRequestRow[]> {
  const rows = await db
    .select()
    .from(capabilityRequests)
    .orderBy(desc(capabilityRequests.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    gameId: row.gameId,
    turnId: row.turnId,
    atStep: row.atStep,
    actorId: row.actorId,
    proposedToolName: row.proposedToolName,
    requestedIntent: row.requestedIntent,
    request: row.request,
    status: row.status,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt,
  }));
}

export async function listCapabilityRequestsForGame(db: ChronicaDatabase, gameId: string, limit = 100): Promise<CapabilityRequestRow[]> {
  const rows = await db
    .select()
    .from(capabilityRequests)
    .where(eq(capabilityRequests.gameId, gameId))
    .orderBy(desc(capabilityRequests.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    gameId: row.gameId,
    turnId: row.turnId,
    atStep: row.atStep,
    actorId: row.actorId,
    proposedToolName: row.proposedToolName,
    requestedIntent: row.requestedIntent,
    request: row.request,
    status: row.status,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt,
  }));
}

/**
 * Record a developer's judgement on a request. `status` is a review label
 * only — nothing in the engine reads it to decide what may execute.
 */
export async function markCapabilityRequestReviewed(
  db: ChronicaDatabase,
  id: string,
  status: "unsupported" | "planned" | "implemented" | "declined",
  reviewerId: string,
  note?: string,
): Promise<boolean> {
  const rows = await db
    .update(capabilityRequests)
    .set({ status, reviewedBy: reviewerId, reviewedAt: new Date(), reviewNote: note ?? null })
    .where(eq(capabilityRequests.id, id))
    .returning({ id: capabilityRequests.id });
  return rows.length > 0;
}
