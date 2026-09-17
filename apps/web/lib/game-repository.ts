import "server-only";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { GameCreationSchema, type GameCreation } from "@chronica/shared";
import { MICRO_UNITS_PER_COIN } from "@chronica/billing";
import {
  SlotCapError,
  countActiveHostedGames,
  createDatabase,
  createGame as createGameQuery,
  deleteOwnedGame,
  ensureBuiltInScenarios,
  findPublicScenario,
  getAccountProfile,
  getActiveCharacterClaimForPlayer,
  getWorldView,
  listHostedGames,
  listJoinedGames,
  listPublicScenarios as listPublicScenariosQuery,
  requestGameEnd,
  resumePaymentPausedGame,
  schema,
  type GameSummaryRow,
  type PublicScenarioSummary,
} from "@chronica/db";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { requiredDatabaseUrl } from "./database-url";
import { builtInScenarioMap } from "./built-in-scenario-maps";
import { projectWorldView, type GameWorldView } from "./world-view";

/**
 * The pages' read/write surface over persistence.
 *
 * Its predecessor was deleted with the turn system. This is not a restoration:
 * the in-memory demo repository is gone, and so are every Orders, News and turn
 * method. What remains is the eleven operations the pages actually call, each
 * going straight to `@chronica/db`. The simulation itself does not come through
 * here at all -- that is `simulation-service.ts`.
 */

export type { GameSummaryRow, PublicScenarioSummary };

export type Viewer = Readonly<{
  userId: string;
  displayName: string;
  email: string;
  role: "user" | "developer" | "admin";
}>;

export interface GameWorldViewWithMap extends GameWorldView {
  readonly mapGeoJson?: ReturnType<typeof builtInScenarioMap>;
}

async function viewerUserId(): Promise<string | null> {
  if (!isAuthenticationConfigured()) return null;
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

async function withDatabase<T>(run: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>): Promise<T> {
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    return await run(db);
  } finally {
    await close();
  }
}

/** Resolves the signed-in user to their active player row in this game. */
async function resolvePlayerId(db: ReturnType<typeof createDatabase>["db"], gameId: string, userId: string): Promise<string | null> {
  const [player] = await db
    .select({ id: schema.players.id })
    .from(schema.players)
    .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active")))
    .limit(1);
  return player?.id ?? null;
}

function parseCoinAmount(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * MICRO_UNITS_PER_COIN + BigInt(fraction.padEnd(6, "0"));
}

export const gameRepository = {
  async getViewer(): Promise<Viewer> {
    const session = isAuthenticationConfigured()
      ? await getAuthentication().api.getSession({ headers: await headers() })
      : null;
    const user = session?.user;
    if (user === undefined || user === null) throw new Error("An account is required.");
    return withDatabase(async (db) => {
      const profile = await getAccountProfile(db, user.id);
      return {
        userId: user.id,
        displayName: user.name ?? user.email,
        email: user.email,
        role: profile?.role ?? "user",
      };
    });
  },

  async listGames(): Promise<{ hosted: GameSummaryRow[]; joined: GameSummaryRow[]; activeHostedCount: number }> {
    const userId = await viewerUserId();
    if (userId === null) throw new Error("An account is required to list saves.");
    return withDatabase(async (db) => {
      const [hosted, joined, activeHostedCount] = await Promise.all([
        listHostedGames(db, userId),
        listJoinedGames(db, userId),
        countActiveHostedGames(db, userId),
      ]);
      return { hosted, joined, activeHostedCount };
    });
  },

  async listPublicScenarios(): Promise<readonly PublicScenarioSummary[]> {
    const userId = await viewerUserId();
    if (userId === null) return [];
    return withDatabase(async (db) => {
      await ensureBuiltInScenarios(db);
      return listPublicScenariosQuery(db, userId);
    });
  },

  async getPublicScenario(scenarioId: string): Promise<PublicScenarioSummary | null> {
    const userId = await viewerUserId();
    if (userId === null) return null;
    return withDatabase(async (db) => {
      await ensureBuiltInScenarios(db);
      return (await findPublicScenario(db, scenarioId, userId)) ?? null;
    });
  },

  async createGame(input: GameCreation): Promise<string> {
    const parsed = GameCreationSchema.parse(input);
    const userId = await viewerUserId();
    if (userId === null) throw new Error("An account is required to host a saved game.");
    return withDatabase(async (db) => {
      await ensureBuiltInScenarios(db);
      if ((await countActiveHostedGames(db, userId)) >= 3) throw new SlotCapError(userId);
      return createGameQuery(db, {
        title: parsed.title,
        scenarioId: parsed.scenarioId,
        startingSeatCount: parsed.continuity.startingSeatCount,
        extraPrincipalsPerPlayer: parsed.continuity.extraPrincipalsPerPlayer,
        hostUserId: userId,
        coinBudgetMicroUnits: parseCoinAmount(parsed.coinCap),
      });
    });
  },

  async needsCharacterDeclaration(gameId: string): Promise<boolean> {
    const userId = await viewerUserId();
    if (userId === null) throw new Error("This account cannot access the save.");
    return withDatabase(async (db) => {
      const playerId = await resolvePlayerId(db, gameId, userId);
      if (playerId === null) throw new Error("This account cannot access the save.");
      const [player] = await db
        .select({ characterId: schema.players.characterId })
        .from(schema.players)
        .where(eq(schema.players.id, playerId))
        .limit(1);
      if (player === undefined || player.characterId.startsWith("pending:")) return true;
      if (!player.characterId.startsWith("declared-")) return false;
      const claim = await getActiveCharacterClaimForPlayer(db, gameId, playerId);
      return claim?.resolvedRole === null || claim?.resolvedRole === undefined;
    });
  },

  /** `omitGeo` skips the multi-megabyte map document for callers that only want the overlay. */
  async getWorld(gameId: string, omitGeo = false): Promise<GameWorldViewWithMap | null> {
    const userId = await viewerUserId();
    if (userId === null) throw new Error("This account cannot access the save.");
    return withDatabase(async (db) => {
      const playerId = await resolvePlayerId(db, gameId, userId);
      if (playerId === null) throw new Error("This account cannot access the save.");
      const view = await getWorldView(db, gameId);
      if (view === undefined) return null;

      const [player] = await db
        .select({ characterId: schema.players.characterId })
        .from(schema.players)
        .where(eq(schema.players.id, playerId))
        .limit(1);
      const characterId = player?.characterId ?? view.world.characters[0]?.id ?? "";

      const world = projectWorldView(view.world, { gameId: view.gameId, gameTitle: view.gameTitle, clock: view.scenarioClock }, characterId);
      const mapGeoJson = omitGeo ? undefined : builtInScenarioMap(view.mapAssetId);
      return mapGeoJson === undefined ? world : { ...world, mapGeoJson };
    });
  },

  async resumeGame(gameId: string): Promise<boolean> {
    const userId = await viewerUserId();
    if (userId === null) return false;
    return withDatabase((db) => resumePaymentPausedGame(db, gameId, userId));
  },

  async endGame(gameId: string): Promise<void> {
    const userId = await viewerUserId();
    if (userId === null) throw new Error("An account is required.");
    await withDatabase((db) => requestGameEnd(db, gameId, userId));
  },

  async deleteSave(gameId: string): Promise<boolean> {
    const userId = await viewerUserId();
    if (userId === null) return false;
    return withDatabase((db) => deleteOwnedGame(db, gameId, userId));
  },
};
