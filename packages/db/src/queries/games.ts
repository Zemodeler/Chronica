import type { CharacterClaim } from "@chronica/shared";
import { and, count, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { ScenarioDefinitionSchema } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { users } from "../schema/auth";
import { characterClaims, gameInvites, games, players, scenarioMapAssets, scenarioVersions, scenarios, turnNewsReadiness, turns } from "../schema/game";
import { CHRONICA_SYSTEM_USER_ID, FIRST_PUNIC_WAR_SCENARIO_ID, FIRST_PUNIC_WAR_SLUG, firstPunicWarScenario } from "../built-in-scenarios";

/** The built-in Numidian map is a scenario-owned copy of the DEMO geography. */
export const FIRST_PUNIC_WAR_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000201";

export type PublicScenarioSummary = Readonly<{
  scenarioId: string;
  version: number;
  title: string;
  period: string;
  authorName: string;
  recommendedPlayers: number;
}>;

/** Ensures the First Punic War copy exists as a normal, versioned public scenario. */
export async function ensureBuiltInScenarios(db: ChronicaDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: CHRONICA_SYSTEM_USER_ID, name: "Chronica", email: "scenarios@chronica.local", username: "chronica", role: "admin" }).onConflictDoNothing();
    await tx.insert(scenarioMapAssets).values({
      id: FIRST_PUNIC_WAR_MAP_ASSET_ID,
      ownerId: CHRONICA_SYSTEM_USER_ID,
      objectKey: "built-in/numidian-decision-demo-map-v1.geojson",
      mimeType: "application/geo+json",
      byteSize: BigInt(1),
      checksum: "built-in-numidian-decision-demo-map-v1",
      featureCount: 889,
      boundingBox: [-25, 20, 45, 72],
      rightsConfirmedAt: new Date(),
    }).onConflictDoNothing();
    await tx.insert(scenarios).values({ id: FIRST_PUNIC_WAR_SCENARIO_ID, slug: FIRST_PUNIC_WAR_SLUG, title: "The Numidian Decision", period: "264 BCE · First Punic War", authorId: CHRONICA_SYSTEM_USER_ID, visibility: "public", currentVersion: 1 }).onConflictDoNothing();
    await tx.insert(scenarioVersions).values({ scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID, version: 1, mapAssetId: FIRST_PUNIC_WAR_MAP_ASSET_ID, definition: firstPunicWarScenario.definition, initialWorld: firstPunicWarScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Built-in scenario with its own copy of the DEMO opening map." }).onConflictDoUpdate({
      target: [scenarioVersions.scenarioId, scenarioVersions.version],
      // Existing game snapshots remain immutable; this refreshes the opening
      // position only for saves created after the built-in scenario is seeded.
      set: { mapAssetId: FIRST_PUNIC_WAR_MAP_ASSET_ID, definition: firstPunicWarScenario.definition, initialWorld: firstPunicWarScenario.initialWorld },
    });
  });
}

/**
 * The playable catalogue is intentionally derived from persisted, author-owned
 * scenarios.  Seed/demo data must never leak into the Worlds surface.
 */
export async function listPublicScenarios(
  db: ChronicaDatabase,
  viewerUserId: string | null,
): Promise<PublicScenarioSummary[]> {
  const filters = [
    eq(scenarios.visibility, "public"),
    isNotNull(scenarioVersions.validatedAt),
    eq(scenarioVersions.version, scenarios.currentVersion),
    isNotNull(scenarios.authorId),
  ];
  if (viewerUserId !== null) filters.push(ne(scenarios.authorId, viewerUserId));

  const rows = await db
    .select({
      scenarioId: scenarios.id,
      version: scenarioVersions.version,
      title: scenarios.title,
      period: scenarios.period,
      authorName: users.name,
      definition: scenarioVersions.definition,
    })
    .from(scenarios)
    .innerJoin(scenarioVersions, and(
      eq(scenarioVersions.scenarioId, scenarios.id),
      eq(scenarioVersions.version, scenarios.currentVersion),
    ))
    .innerJoin(users, eq(users.id, scenarios.authorId))
    .where(and(...filters))
    .orderBy(desc(scenarios.updatedAt));

  return rows.map((row) => ({
    scenarioId: row.scenarioId,
    version: row.version,
    title: row.title,
    period: row.period,
    authorName: row.authorName,
    recommendedPlayers: ScenarioDefinitionSchema.parse(row.definition).continuity.startingSeatCount,
  }));
}

/** Returns one catalogue item only when the viewer is allowed to host it. */
export async function findPublicScenario(
  db: ChronicaDatabase,
  scenarioId: string,
  viewerUserId: string,
): Promise<PublicScenarioSummary | undefined> {
  const scenarios = await listPublicScenarios(db, viewerUserId);
  return scenarios.find((scenario) => scenario.scenarioId === scenarioId);
}

/** Thrown when createGame would exceed the 3-active-hosted-games cap. */
export class SlotCapError extends Error {
  constructor(userId: string) {
    super(`User ${userId} already has 3 active hosted games. End or replace one before creating another.`);
    this.name = "SlotCapError";
  }
}

/** How many lobby/active games this user currently hosts. */
export async function countActiveHostedGames(db: ChronicaDatabase, userId: string): Promise<number> {
  const [result] = await db
    .select({ value: count(games.id) })
    .from(games)
    .where(and(eq(games.createdBy, userId), inArray(games.status, ["lobby", "active"])));
  return result?.value ?? 0;
}

/**
 * Marks the player's seat as vacated without ending the game for anyone else.
 * Does not touch end_requested_at; the worker's applyAbsentPlayerFallback
 * covers vacated seats at each turn deadline.
 */
export async function leaveGame(db: ChronicaDatabase, gameId: string, userId: string): Promise<void> {
  await db
    .update(players)
    .set({ status: "vacated" })
    .where(and(eq(players.gameId, gameId), eq(players.userId, userId)));
}

export type CharacterClaimResult = "claimed" | "already-claimed" | "not-eligible";
export type ConsumedGameInvite = Readonly<{ gameId: string; playerId: string; guestSessionVersion: number; accountAttached: boolean }>;

export async function consumeGameInvite(
  db: ChronicaDatabase,
  input: Readonly<{ tokenHash: string; consumedAt: Date; userId?: string }>,
): Promise<ConsumedGameInvite | null> {
  return db.transaction(async (tx) => {
    const [invite] = await tx.select({
      id: gameInvites.id,
      gameId: gameInvites.gameId,
      expiresAt: gameInvites.expiresAt,
      claimedAt: gameInvites.claimedAt,
      revokedAt: gameInvites.revokedAt,
      startingSeatCount: games.startingSeatCount,
      gameStatus: games.status,
    }).from(gameInvites)
      .innerJoin(games, eq(games.id, gameInvites.gameId))
      .where(eq(gameInvites.tokenHash, input.tokenHash))
      .for("update")
      .limit(1);

    if (invite === undefined
      || invite.claimedAt !== null
      || invite.revokedAt !== null
      || invite.expiresAt <= input.consumedAt
      || invite.gameStatus !== "lobby") return null;

    const [occupancy] = await tx.select({ value: count(players.id) }).from(players)
      .where(and(eq(players.gameId, invite.gameId), eq(players.status, "active")));
    if ((occupancy?.value ?? 0) >= invite.startingSeatCount) return null;
    if (input.userId !== undefined) {
      const [existingSeat] = await tx.select({ id: players.id }).from(players).where(and(eq(players.gameId, invite.gameId), eq(players.userId, input.userId), eq(players.status, "active"))).limit(1);
      if (existingSeat !== undefined) return null;
    }

    const [player] = await tx.insert(players).values({
      gameId: invite.gameId,
      userId: input.userId,
      characterId: `pending:${invite.id}`,
      status: "active",
    }).returning({ id: players.id, guestSessionVersion: players.guestSessionVersion });
    if (player === undefined) return null;

    await tx.update(gameInvites).set({
      claimedAt: input.consumedAt,
      claimedPlayerId: player.id,
    }).where(eq(gameInvites.id, invite.id));

    return { gameId: invite.gameId, playerId: player.id, guestSessionVersion: player.guestSessionVersion, accountAttached: input.userId !== undefined };
  });
}

export async function claimCharacter(
  db: ChronicaDatabase,
  input: Readonly<{ gameId: string; playerId: string; claim: CharacterClaim; characterId: string }>,
): Promise<CharacterClaimResult> {
  return db.transaction(async (tx) => {
    const [player] = await tx.select({ id: players.id }).from(players).where(and(
      eq(players.id, input.playerId),
      eq(players.gameId, input.gameId),
      eq(players.status, "active"),
    )).for("update").limit(1);
    if (player === undefined) return "not-eligible";

    const [existingPlayerClaim] = await tx.select({ id: characterClaims.id }).from(characterClaims).where(and(
      eq(characterClaims.gameId, input.gameId),
      eq(characterClaims.playerId, input.playerId),
      isNull(characterClaims.releasedAt),
    )).limit(1);
    if (existingPlayerClaim !== undefined) return "not-eligible";

    const inserted = await tx.insert(characterClaims).values({
      gameId: input.gameId,
      playerId: input.playerId,
      characterId: input.characterId,
      origin: input.claim.origin,
      declaration: input.claim.origin === "declared" ? input.claim.declaration : null,
    }).onConflictDoNothing().returning({ id: characterClaims.id });

    if (inserted.length === 0) return "already-claimed";
    await tx.update(players).set({ characterId: input.characterId }).where(eq(players.id, input.playerId));
    return "claimed";
  });
}

export interface CharacterClaimRow {
  readonly id: string;
  readonly characterId: string;
  readonly playerId: string;
  readonly resolvedRole: unknown;
}

/**
 * Resolved claims waiting to be materialized into `world.characters`.
 *
 * `resolvedRole is not null and introducedAtTurnId is null and releasedAt is
 * null` **is** the staging state -- no separate table. This is the raw
 * row-fetch only; the transformation into `CharacterIntroduction[]` shapes
 * happens in apps/worker, which has the world context needed to resolve
 * `cultureId`/`officeId` for each contact.
 */
export async function getPendingCharacterIntroductions(db: ChronicaDatabase, gameId: string): Promise<readonly CharacterClaimRow[]> {
  const rows = await db
    .select({
      id: characterClaims.id,
      characterId: characterClaims.characterId,
      playerId: characterClaims.playerId,
      resolvedRole: characterClaims.resolvedRole,
    })
    .from(characterClaims)
    .where(and(
      eq(characterClaims.gameId, gameId),
      isNotNull(characterClaims.resolvedRole),
      isNull(characterClaims.introducedAtTurnId),
      isNull(characterClaims.releasedAt),
    ));
  return rows;
}

export interface GameSummaryRow {
  readonly gameId: string;
  readonly title: string;
  readonly status: "lobby" | "active" | "finished" | "abandoned";
}

/** Up to 3 active hosted games for the dashboard save-slot rail. */
export async function listHostedGames(db: ChronicaDatabase, userId: string): Promise<GameSummaryRow[]> {
  return db
    .select({ gameId: games.id, title: games.title, status: games.status })
    .from(games)
    // Exclude games where the host already requested an end: they disappear
    // from the active slot immediately even if the worker hasn't yet closed the
    // last turn boundary (ADR-0040). The audit record is preserved in the DB.
    .where(and(eq(games.createdBy, userId), inArray(games.status, ["lobby", "active"]), isNull(games.endRequestedAt)))
    .orderBy(desc(games.createdAt));
}

/** Active games the user joined as a guest (not the host). */
export async function listJoinedGames(db: ChronicaDatabase, userId: string): Promise<GameSummaryRow[]> {
  return db
    .select({ gameId: games.id, title: games.title, status: games.status })
    .from(games)
    .innerJoin(players, and(eq(players.gameId, games.id), eq(players.userId, userId), eq(players.status, "active")))
    // Exclude games in the process of ending for the same reason as listHostedGames.
    .where(and(ne(games.createdBy, userId), inArray(games.status, ["lobby", "active"]), isNull(games.endRequestedAt)))
    .orderBy(desc(games.createdAt));
}

export async function acknowledgeTurnNews(
  db: ChronicaDatabase,
  input: Readonly<{ gameId: string; turnId: string; playerId: string; readyAt: Date }>,
): Promise<"acknowledged" | "not-eligible"> {
  return db.transaction(async (tx) => {
    const [eligible] = await tx.select({ turnId: turns.id }).from(turns)
      .innerJoin(players, and(eq(players.id, input.playerId), eq(players.gameId, turns.gameId)))
      .where(and(eq(turns.id, input.turnId), eq(turns.gameId, input.gameId), eq(turns.status, "news")))
      .limit(1);
    if (eligible === undefined) return "not-eligible";

    await tx.insert(turnNewsReadiness).values({
      turnId: input.turnId,
      playerId: input.playerId,
      readyAt: input.readyAt,
      autoReady: false,
    }).onConflictDoUpdate({
      target: [turnNewsReadiness.turnId, turnNewsReadiness.playerId],
      set: { readyAt: input.readyAt },
    });
    return "acknowledged";
  });
}

export interface ActiveCharacterClaimRow {
  readonly id: string;
  readonly declaration: string | null;
  readonly resolvedRole: unknown;
}

/**
 * The signed-in player's active (not-yet-released) character claim, if any.
 *
 * "Active" mirrors `character_claims_player_active_unique`: at most one row
 * per (gameId, playerId) with `releasedAt is null`. A row existing at all
 * means a declaration was made -- `resolvedRole` still null distinguishes
 * "pending" from "ready" for the caller.
 */
export async function getActiveCharacterClaimForPlayer(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
): Promise<ActiveCharacterClaimRow | undefined> {
  const [row] = await db
    .select({
      id: characterClaims.id,
      declaration: characterClaims.declaration,
      resolvedRole: characterClaims.resolvedRole,
    })
    .from(characterClaims)
    .where(and(
      eq(characterClaims.gameId, gameId),
      eq(characterClaims.playerId, playerId),
      isNull(characterClaims.releasedAt),
    ))
    .limit(1);
  return row;
}
