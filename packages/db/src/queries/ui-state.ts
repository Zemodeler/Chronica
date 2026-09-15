import { and, eq } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { playerGameUiState } from "../schema/ui-state";

export interface PlayerGameUiStateRow {
  readonly gameId: string;
  readonly playerId: string;
  readonly generatedCast: unknown;
  readonly selectedThreadId: string | null;
  readonly updatedAt: Date;
}

/** A player's durable UI state for a game -- selection, generated cast. */
export async function getPlayerGameUiState(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
): Promise<PlayerGameUiStateRow | undefined> {
  const [row] = await db
    .select({
      gameId: playerGameUiState.gameId,
      playerId: playerGameUiState.playerId,
      generatedCast: playerGameUiState.generatedCast,
      selectedThreadId: playerGameUiState.selectedThreadId,
      updatedAt: playerGameUiState.updatedAt,
    })
    .from(playerGameUiState)
    .where(and(eq(playerGameUiState.gameId, gameId), eq(playerGameUiState.playerId, playerId)))
    .limit(1);
  return row;
}

export interface UpsertPlayerGameUiStateInput {
  readonly gameId: string;
  readonly playerId: string;
  readonly generatedCast?: unknown;
  readonly selectedThreadId?: string | null;
}

/**
 * Inserts or partially patches a player's UI state row.
 *
 * Only the fields the caller actually passes are written on conflict -- a
 * caller updating just `selectedThreadId` must never clobber a previously
 * persisted `generatedCast` with null.
 */
export async function upsertPlayerGameUiState(db: ChronicaDatabase, input: UpsertPlayerGameUiStateInput): Promise<void> {
  const updatedAt = new Date();
  const set: Partial<typeof playerGameUiState.$inferInsert> = { updatedAt };
  if (input.generatedCast !== undefined) set.generatedCast = input.generatedCast;
  if (input.selectedThreadId !== undefined) set.selectedThreadId = input.selectedThreadId;

  await db
    .insert(playerGameUiState)
    .values({
      gameId: input.gameId,
      playerId: input.playerId,
      generatedCast: input.generatedCast ?? null,
      selectedThreadId: input.selectedThreadId ?? null,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [playerGameUiState.gameId, playerGameUiState.playerId],
      set,
    });
}
