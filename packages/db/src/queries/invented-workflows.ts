import { and, desc, eq, sql } from "drizzle-orm";
import type { InventedPatchOperation, RuntimeInventedWorkflow } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { inventedWorkflowUses, inventedWorkflows } from "../schema/game";

export interface InventedWorkflowRow extends RuntimeInventedWorkflow {
  readonly createdTurnId: string;
  readonly intent: string;
  readonly description: string;
  readonly successfulUseCount: number;
  readonly lastUsedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly disableNote: string | null;
  readonly createdAt: Date;
}

export interface InventedWorkflowUseInput {
  readonly workflowId: string;
  readonly parameters: Record<string, unknown>;
  readonly resolvedPatch?: readonly InventedPatchOperation[];
  readonly success: boolean;
  readonly failureReason?: string;
}

function mapRow(row: typeof inventedWorkflows.$inferSelect): InventedWorkflowRow {
  return {
    id: row.id,
    gameId: row.gameId,
    createdTurnId: row.createdTurnId,
    intent: row.intent,
    description: row.description,
    definition: row.definition,
    status: row.status,
    successfulUseCount: row.successfulUseCount,
    lastUsedAt: row.lastUsedAt,
    disabledAt: row.disabledAt,
    disableNote: row.disableNote,
    createdAt: row.createdAt,
  };
}

export async function listActiveInventedWorkflows(db: ChronicaDatabase, gameId: string): Promise<InventedWorkflowRow[]> {
  const rows = await db.select().from(inventedWorkflows)
    .where(eq(inventedWorkflows.gameId, gameId));
  return rows.filter((row) => row.status === "active").map(mapRow);
}

export async function listInventedWorkflows(db: ChronicaDatabase, limit = 50): Promise<InventedWorkflowRow[]> {
  const rows = await db.select().from(inventedWorkflows)
    .orderBy(desc(inventedWorkflows.successfulUseCount), desc(inventedWorkflows.lastUsedAt), desc(inventedWorkflows.createdAt))
    .limit(limit);
  return rows.map(mapRow);
}

export async function insertInventedWorkflows(
  db: ChronicaDatabase,
  workflows: readonly RuntimeInventedWorkflow[],
  turnId: string,
): Promise<void> {
  if (workflows.length === 0) return;
  await db.insert(inventedWorkflows).values(workflows.map((workflow) => ({
    id: workflow.id,
    gameId: workflow.gameId,
    createdTurnId: turnId,
    actionId: workflow.definition.actionId,
    intent: workflow.definition.intent,
    description: workflow.definition.description,
    definition: workflow.definition,
    status: workflow.status,
  }))).onConflictDoNothing();
}

export async function recordInventedWorkflowUses(
  db: ChronicaDatabase,
  uses: readonly InventedWorkflowUseInput[],
  turnId: string,
): Promise<void> {
  if (uses.length === 0) return;
  await db.insert(inventedWorkflowUses).values(uses.map((use) => ({
    workflowId: use.workflowId,
    turnId,
    parameters: use.parameters,
    resolvedPatch: use.resolvedPatch,
    success: use.success,
    failureReason: use.failureReason ?? null,
  })));
  const successfulIds = [...new Set(uses.filter((use) => use.success).map((use) => use.workflowId))];
  for (const workflowId of successfulIds) {
    const increment = uses.filter((use) => use.success && use.workflowId === workflowId).length;
    await db.update(inventedWorkflows)
      .set({ successfulUseCount: sql`${inventedWorkflows.successfulUseCount} + ${increment}`, lastUsedAt: new Date() })
      .where(eq(inventedWorkflows.id, workflowId));
  }
}

export async function setInventedWorkflowStatus(
  db: ChronicaDatabase,
  id: string,
  status: "active" | "disabled",
  reviewerId: string,
  note?: string,
): Promise<boolean> {
  const rows = await db.update(inventedWorkflows).set(status === "disabled"
    ? { status, disabledBy: reviewerId, disabledAt: new Date(), disableNote: note ?? null }
    : { status, disabledBy: null, disabledAt: null, disableNote: note ?? null },
  ).where(eq(inventedWorkflows.id, id)).returning({ id: inventedWorkflows.id });
  return rows.length > 0;
}

export async function listInventedWorkflowUses(db: ChronicaDatabase, workflowId: string, limit = 10) {
  return db.select().from(inventedWorkflowUses)
    .where(eq(inventedWorkflowUses.workflowId, workflowId))
    .orderBy(desc(inventedWorkflowUses.createdAt)).limit(limit);
}

/**
 * How many active campaign-defined workflows exist. `gameId` scopes to one
 * campaign, or omission returns the cross-campaign count. This is useful for
 * operational review, but active does not imply unsafe or unreviewed: a
 * workflow is validated whenever it is invoked.
 */
export async function getActiveDefinedWorkflowCount(db: ChronicaDatabase, gameId?: string): Promise<number> {
  const condition = gameId === undefined
    ? eq(inventedWorkflows.status, "active")
    : and(eq(inventedWorkflows.status, "active"), eq(inventedWorkflows.gameId, gameId));
  const rows = await db.select({ id: inventedWorkflows.id }).from(inventedWorkflows).where(condition);
  return rows.length;
}
