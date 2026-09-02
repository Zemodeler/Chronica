import { and, desc, eq } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { pendingWorkflowProposals } from "../schema/game";
import type { NovelActionProposal } from "@chronica/shared";
import type { TemporaryWorkflowPatch } from "@chronica/shared";

// CRUD for Workflow Manager novel action proposals (Issue #6).
//
// Novel proposals are emitted when the Workflow Manager needs a world action
// that no registered workflow (skill) covers. They are persisted here for
// developer review and eventual conversion into new workflow definitions.

export interface WorkflowProposalRow {
  readonly id: string;
  readonly turnId: string;
  readonly gameId: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly intent: string;
  readonly targetEntityIds: string[];
  readonly estimatedMutationDescription: string;
  readonly temporaryPatch: TemporaryWorkflowPatch | null;
  readonly implementationReport: string | null;
  readonly source: string;
  readonly sourceRef: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
  readonly createdAt: Date;
}

export async function insertNovelActionProposals(
  db: ChronicaDatabase,
  proposals: readonly NovelActionProposal[],
  turnId: string,
  gameId: string,
): Promise<void> {
  if (proposals.length === 0) return;
  await db.insert(pendingWorkflowProposals).values(
    proposals.map((p) => ({
      turnId,
      gameId,
      intent: p.intent,
      targetEntityIds: p.targetEntityIds,
      estimatedMutationDescription: p.estimatedMutationDescription,
      temporaryPatch: p.temporaryPatch,
      implementationReport: p.implementationReport,
      source: p.source,
      sourceRef: p.sourceRef,
    })),
  );
}

export async function listPendingWorkflowProposals(
  db: ChronicaDatabase,
  opts: { status?: "pending" | "approved" | "rejected"; gameId?: string; limit?: number; offset?: number } = {},
): Promise<WorkflowProposalRow[]> {
  const { status, gameId, limit = 50, offset = 0 } = opts;
  const conditions = [];
  if (status) conditions.push(eq(pendingWorkflowProposals.status, status));
  if (gameId) conditions.push(eq(pendingWorkflowProposals.gameId, gameId));

  const rows = await db
    .select()
    .from(pendingWorkflowProposals)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(pendingWorkflowProposals.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    id: r.id,
    turnId: r.turnId,
    gameId: r.gameId,
    status: r.status,
    intent: r.intent,
    targetEntityIds: r.targetEntityIds,
    estimatedMutationDescription: r.estimatedMutationDescription,
    temporaryPatch: r.temporaryPatch ?? null,
    implementationReport: r.implementationReport ?? null,
    source: r.source,
    sourceRef: r.sourceRef,
    reviewedBy: r.reviewedBy ?? null,
    reviewedAt: r.reviewedAt ?? null,
    reviewNote: r.reviewNote ?? null,
    createdAt: r.createdAt,
  }));
}

export async function getWorkflowProposalById(
  db: ChronicaDatabase,
  id: string,
): Promise<WorkflowProposalRow | undefined> {
  const [row] = await db
    .select()
    .from(pendingWorkflowProposals)
    .where(eq(pendingWorkflowProposals.id, id))
    .limit(1);
  if (!row) return undefined;
  return {
    id: row.id,
    turnId: row.turnId,
    gameId: row.gameId,
    status: row.status,
    intent: row.intent,
    targetEntityIds: row.targetEntityIds,
    estimatedMutationDescription: row.estimatedMutationDescription,
    temporaryPatch: row.temporaryPatch ?? null,
    implementationReport: row.implementationReport ?? null,
    source: row.source,
    sourceRef: row.sourceRef,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt ?? null,
    reviewNote: row.reviewNote ?? null,
    createdAt: row.createdAt,
  };
}

export async function reviewWorkflowProposal(
  db: ChronicaDatabase,
  id: string,
  reviewerId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<boolean> {
  const rows = await db
    .update(pendingWorkflowProposals)
    .set({
      status: decision,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNote: note ?? null,
    })
    .where(and(eq(pendingWorkflowProposals.id, id), eq(pendingWorkflowProposals.status, "pending")))
    .returning({ id: pendingWorkflowProposals.id });
  return rows.length > 0;
}
