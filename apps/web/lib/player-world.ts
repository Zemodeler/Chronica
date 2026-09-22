import "server-only";

import { getCharacterKnowledgebase, getSharedDatabase, getWorldView, schema, type ChronicaDatabase, type WorldView } from "@chronica/db";
import { materializePlayerCharacter, type ScenarioGovernmentRules, type WorldState } from "@chronica/shared";
import { materializeCanvasProvince } from "./canvas-world";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { requiredDatabaseUrl } from "./database-url";

/**
 * The world as this player's own character stands in it.
 *
 * Before the first burst commits there is no snapshot, so the stored world is
 * the scenario's authored one, which has never heard of a character the
 * player declared. `getPlayerAuthoritySummary` has projected the player in
 * since it was written and explains why; nothing else did. A declared consul
 * who opened the Treasury before giving his first order read a private
 * citizen's books -- and the muster and the standing panel would each have
 * inherited the same bug.
 *
 * So the projection, the session check and the player lookup live here once,
 * and every read path that answers "what is mine" goes through it.
 */

export interface PlayerWorld {
  readonly world: WorldState;
  /** Null when the viewer has no character in this game -- a spectator, or a save mid-declaration. */
  readonly characterId: string | null;
  /** The player row, which the dialogue layer keys its contacts and knowledgebases by. */
  readonly playerId: string | null;
  readonly view: WorldView;
  readonly db: ChronicaDatabase;
}

/**
 * The world with this player's declared character projected into it.
 *
 * Falls back to the world as-is whenever the projection cannot be made -- an
 * unconfirmed draft, a knowledgebase for somebody else, a starting location
 * the scenario does not have. A read path must never fail because a character
 * is half-created.
 */
export async function materializeDeclaredPlayer(
  db: ChronicaDatabase,
  gameId: string,
  world: WorldState,
  characterId: string,
  scenarioGovernment: ScenarioGovernmentRules | undefined,
  mapAssetId: string | null,
): Promise<WorldState> {
  if (world.characters.some((character) => character.id === characterId)) return world;
  const playerId = characterId.startsWith("declared-") ? characterId.slice("declared-".length) : null;
  if (playerId === null) return world;
  const knowledgebase = await getCharacterKnowledgebase(db, gameId, playerId).catch(() => null);
  if (knowledgebase === null || !knowledgebase.confirmedByPlayer) return world;
  try {
    return materializePlayerCharacter(
      materializeCanvasProvince(world, mapAssetId, knowledgebase.locationProvinceId),
      characterId,
      knowledgebase,
      scenarioGovernment,
    );
  } catch {
    return world;
  }
}

/**
 * Open the world for the signed-in player of `gameId`, and close it after.
 *
 * `read` is handed a world their character already stands in. Returns null
 * when there is no session, no authentication configured, or no world -- the
 * caller answers with "there is nothing you may read" rather than an error.
 */
export async function withPlayerWorld<T>(
  gameId: string,
  read: (context: PlayerWorld) => T | Promise<T>,
): Promise<T | null> {
  if (!isAuthenticationConfigured()) return null;
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  const userId = session?.user?.id ?? null;
  if (userId === null) return null;

  /**
   * One pool for every read, not one per request.
   *
   * `createDatabase` opens a fresh pool of up to ten connections each time it
   * is called, and the Office opens five of these endpoints while a game page
   * is loading -- room, books, forces, standing, people -- on top of
   * everything the page itself reads. Under a test run that was enough
   * concurrent pools to exhaust Postgres, and the page came back as an
   * Internal Server Error whose cause was `write CONNECT_TIMEOUT
   * localhost:5432`.
   *
   * `getSharedDatabase` was written for exactly this and had no callers. It
   * is safe here because nothing on this path writes: it reads the player,
   * reads the world, and projects a declared character in memory. Nothing to
   * close, either -- the pool outlives the request on purpose.
   */
  const db = getSharedDatabase(requiredDatabaseUrl());
  {
    const [player] = await db
      .select({ id: schema.players.id, characterId: schema.players.characterId })
      .from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active")))
      .limit(1);
    const view = await getWorldView(db, gameId);
    if (view === undefined) return null;

    const characterId = player?.characterId ?? null;
    const world = characterId === null
      ? view.world
      : await materializeDeclaredPlayer(db, gameId, view.world, characterId, view.scenarioGovernment, view.mapAssetId);

    return await read({ world, characterId, playerId: player?.id ?? null, view, db });
  }
}
