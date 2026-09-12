import "server-only";

import { createAiAdapter } from "@chronica/ai";
import { createDatabase, getOrdersForTurn, getQueuedTurn, getWorldView, releaseExpiredTurnClaims, schema, updateTurnProgressStep, type ChronicaDatabase } from "@chronica/db";
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
  // Unified action runtime, Stage 7: a turn whose claimant crashed before
  // finishing is stuck in "resolving" forever otherwise -- nothing else ever
  // looks at it once it falls out of `getQueuedTurn`'s "queued" filter.
  await releaseExpiredTurnClaims(db, gameId);
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
    scenarioChronicle: worldView.scenarioChronicle, mapAssetId: worldView.mapAssetId,
  }, progressWriter);
}

/**
 * Bounds how many times one `dispatchQueuedTurn` call retries in place after
 * a failed attempt (unified action runtime, Stage 7). Independent of
 * `failTurn`'s own `MAX_TURN_RESOLVE_ATTEMPTS`: that cap only applies once a
 * turn reaches `resolveTurn`'s try block, so a precondition that throws
 * earlier every time (e.g. "Game not found") would otherwise never touch
 * `resolveAttempts` and could loop here forever without its own bound.
 */
const MAX_DISPATCH_RETRIES = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Server-owned entrypoint used after order submission. */
export async function dispatchQueuedTurn(gameId: string): Promise<ResolveTurnResult | undefined> {
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        return await resolveQueuedTurn(db, gameId);
      } catch (error) {
        // `failTurn` (inside resolveTurn's catch, packages/db/src/queries/resolution.ts)
        // already requeued the turn if it has attempts left, or left it
        // terminally "failed" otherwise -- either way, retrying here just
        // means calling back in, not re-deriving that decision.
        const stillQueued = attempt < MAX_DISPATCH_RETRIES && (await getQueuedTurn(db, gameId)) !== undefined;
        if (!stillQueued) throw error;
        console.error(`[resolution-dispatch] attempt ${attempt} failed, retrying`, error);
        await delay(1000 * attempt);
      }
    }
  } finally { await close(); }
}
