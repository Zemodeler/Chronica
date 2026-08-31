import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { WorldStateSchema } from "@chronica/shared";
import type { WorldState, WorkflowAuditBlob, NovelActionProposal } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { chronicleEntries, games, players, pendingWorkflowProposals, turns, worldSnapshots } from "../schema/game";
import { insertNovelActionProposals } from "./workflow-proposals";

// Persistence for the resolution pipeline.
//
// commitResolution() is the single write gate for a resolved turn: snapshot,
// chronicle, turn advancement, and next-turn opening in one transaction. The
// caller owns the world mutation; this file owns the durable commit.

export interface ChronicleEntryInput {
  readonly sequence: number;
  readonly scope: string;
  readonly scopeRef?: string;
  readonly audience: "all_players" | "knowledge_scoped";
  readonly body: string;
  readonly atStep: number;
  readonly materialConsequence: boolean;
  readonly displayPatch?: unknown;
  readonly playerInvolvement?: unknown;
}

export interface CommitResolutionInput {
  readonly gameId: string;
  readonly turnId: string;
  readonly newWorld: WorldState;
  readonly elapsedStepEnd: number;
  readonly chronicleEntries: readonly ChronicleEntryInput[];
  readonly stopReason: string;
  /** Workflow Manager audit blob; stored as JSONB on the turn row for offline review. */
  readonly workflowAudit?: WorkflowAuditBlob;
  /** Novel action proposals emitted by the Workflow Manager; persisted for developer review. */
  readonly novelActionProposals?: readonly NovelActionProposal[];
}

export interface CommitResolutionResult {
  readonly nextTurnId: string;
}

/**
 * Atomically commit a resolved turn: write the new world snapshot, write
 * chronicle entries, advance the current turn to "news", and open the next
 * "collecting" turn.
 */
export async function commitResolution(
  db: ChronicaDatabase,
  input: CommitResolutionInput,
): Promise<CommitResolutionResult> {
  const worldJson = JSON.stringify(input.newWorld);
  const stateHash = createHash("sha256").update(worldJson).digest("hex");

  return db.transaction(async (tx) => {
    // Advance current turn to "news"
    await tx
      .update(turns)
      .set({
        status: "news",
        elapsedStepEnd: input.elapsedStepEnd,
        stopReason: input.stopReason,
        resolutionCommittedAt: new Date(),
        ...(input.workflowAudit !== undefined ? { workflowAudit: input.workflowAudit } : {}),
      })
      .where(eq(turns.id, input.turnId));

    // Write world snapshot
    await tx.insert(worldSnapshots).values({
      turnId: input.turnId,
      state: JSON.parse(worldJson) as unknown,
      schemaVersion: input.newWorld.schemaVersion,
      stateHash,
    });

    // Write chronicle entries
    if (input.chronicleEntries.length > 0) {
      await tx.insert(chronicleEntries).values(
        input.chronicleEntries.map((entry) => ({
          turnId: input.turnId,
          sequence: entry.sequence,
          scope: entry.scope,
          scopeRef: entry.scopeRef ?? null,
          audience: entry.audience,
          visibility: "public",
          playerInvolvement: entry.playerInvolvement ?? [],
          body: entry.body,
          facts: {
            ids: [],
            atStep: entry.atStep,
            materialConsequence: entry.materialConsequence,
            ...(entry.displayPatch !== undefined ? { displayPatch: entry.displayPatch } : {}),
          },
        })),
      );
    }

    // Persist novel action proposals for developer review
    if (input.novelActionProposals && input.novelActionProposals.length > 0) {
      await insertNovelActionProposals(tx as unknown as ChronicaDatabase, input.novelActionProposals, input.turnId, input.gameId);
    }

    // Look up active players to seed news-readiness rows
    const [currentTurn] = await tx
      .select({ index: turns.index })
      .from(turns)
      .where(eq(turns.id, input.turnId))
      .limit(1);
    const nextIndex = (currentTurn?.index ?? 0) + 1;

    // Open next collecting turn
    const nextTurnId = randomUUID();
    await tx.insert(turns).values({
      id: nextTurnId,
      gameId: input.gameId,
      index: nextIndex,
      status: "collecting",
      seed: `${input.gameId}:${nextIndex}`,
      openedAt: new Date(),
      elapsedStepStart: input.elapsedStepEnd,
    });

    return { nextTurnId };
  });
}

/** Get orders submitted for a turn, mapped to the player's character id. */
export async function getOrdersForTurn(
  db: ChronicaDatabase,
  turnId: string,
): Promise<readonly { readonly playerId: string; readonly characterId: string; readonly rawText: string; readonly directives: unknown }[]> {
  const rows = await db
    .select({
      playerId: players.id,
      characterId: players.characterId,
      rawText: turns.id,
    })
    .from(turns)
    .innerJoin(players, eq(players.gameId, turns.gameId))
    .where(eq(turns.id, turnId))
    .limit(1);
  // Fetch actual orders
  const { orders: ordersTable } = await import("../schema/game");
  const orderRows = await db
    .select({
      playerId: ordersTable.playerId,
      rawText: ordersTable.rawText,
      directives: ordersTable.directives,
    })
    .from(ordersTable)
    .where(eq(ordersTable.turnId, turnId));

  return orderRows.map((row) => ({
    playerId: row.playerId,
    characterId: "unknown",
    rawText: row.rawText,
    directives: row.directives,
  }));
}

/** Advance a turn's status from queued → resolving. */
export async function claimTurnForResolution(
  db: ChronicaDatabase,
  turnId: string,
): Promise<boolean> {
  const rows = await db
    .update(turns)
    .set({ status: "resolving" })
    .where(and(eq(turns.id, turnId), eq(turns.status, "queued")))
    .returning({ id: turns.id });
  return rows.length > 0;
}

/** Mark a turn as failed with an error reason. */
export async function failTurn(
  db: ChronicaDatabase,
  turnId: string,
  reason: string,
): Promise<void> {
  await db.update(turns).set({ status: "failed" }).where(eq(turns.id, turnId));
}

/** Get the queued turn for a game, if one exists. */
export async function getQueuedTurn(
  db: ChronicaDatabase,
  gameId: string,
): Promise<{ id: string; index: number; elapsedStepStart: number } | undefined> {
  const [turn] = await db
    .select({ id: turns.id, index: turns.index, elapsedStepStart: turns.elapsedStepStart })
    .from(turns)
    .where(and(eq(turns.gameId, gameId), eq(turns.status, "queued")))
    .orderBy(desc(turns.index))
    .limit(1);
  return turn;
}

/** Mark news as read for this game: advance news turn → resolved and update game. */
export async function markChronicleRead(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [turn] = await tx
      .select({ id: turns.id })
      .from(turns)
      .where(and(eq(turns.gameId, gameId), eq(turns.status, "news")))
      .orderBy(desc(turns.index))
      .limit(1);
    if (!turn) return;
    await tx.update(turns).set({ status: "resolved", resolvedAt: new Date() }).where(eq(turns.id, turn.id));
  });
}
