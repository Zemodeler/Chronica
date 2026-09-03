import "server-only";

import { createAiAdapter } from "@chronica/ai";
import { createDatabase, getOrdersForTurn, getQueuedTurn, getWorldView, schema, updateTurnProgressStep, type ChronicaDatabase } from "@chronica/db";
import { OrderBatchSchema } from "@chronica/shared";
import { and, eq } from "drizzle-orm";
import { resolveTurn, type ResolveTurnResult } from "./pipeline";
import type { ResolutionProgress } from "./types";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

/** Claims and resolves the durable queued turn for a game. */
export async function resolveQueuedTurn(
  db: ChronicaDatabase,
  gameId: string,
  onProgress: (progress: ResolutionProgress) => void = () => {},
): Promise<ResolveTurnResult | undefined> {
  const queuedTurn = await getQueuedTurn(db, gameId);
  if (queuedTurn === undefined) return undefined;
  const worldView = await getWorldView(db, gameId);
  if (worldView === undefined) throw new Error("Game not found for resolution.");
  const playerOrder = (await getOrdersForTurn(db, queuedTurn.id))[0];
  if (playerOrder === undefined) throw new Error("Queued turn has no submitted orders.");
  const batchParse = OrderBatchSchema.safeParse(playerOrder.directives);
  if (!batchParse.success) throw new Error("Queued turn contains an invalid order batch.");
  const [player] = await db.select({ id: schema.players.id, characterId: schema.players.characterId }).from(schema.players)
    .where(and(eq(schema.players.id, playerOrder.playerId), eq(schema.players.gameId, gameId), eq(schema.players.status, "active"))).limit(1);
  if (player === undefined) throw new Error("Queued turn's player is no longer active.");
  const progressWriter: typeof onProgress = (progress) => {
    onProgress(progress);
    void updateTurnProgressStep(db, queuedTurn.id, progress.step).catch(() => {});
  };
  return resolveTurn(db, createAiAdapter(), {
    gameId, turnId: queuedTurn.id, world: worldView.world, batch: batchParse.data,
    actorCharacterId: player.characterId ?? worldView.world.characters[0]?.id ?? "", playerId: player.id,
    scenarioClock: worldView.scenarioClock, scenarioLife: worldView.scenarioLife, scenarioGovernment: worldView.scenarioGovernment,
  }, progressWriter);
}

/** Server-owned entrypoint used after order submission. */
export async function dispatchQueuedTurn(gameId: string): Promise<ResolveTurnResult | undefined> {
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try { return await resolveQueuedTurn(db, gameId); }
  finally { await close(); }
}
