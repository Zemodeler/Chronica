import type { CharacterClaim } from "@chronica/shared";
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { ScenarioDefinitionSchema, WORLD_SCHEMA_VERSION } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { users } from "../schema/auth";
import { characterClaims, gameInvites, games, players, scenarioMapAssets, scenarioVersions, scenarios } from "../schema/game";
import { creditHolds, creditLedgerEntries, creditLots, creditWallets } from "../schema/billing";
import { CHRONICA_SYSTEM_USER_ID, FIRST_PUNIC_WAR_SCENARIO_ID, FIRST_PUNIC_WAR_SLUG, firstPunicWarScenario } from "../built-in-scenarios";
import { PUNIC_WARS_SCENARIO_ID, PUNIC_WARS_SLUG, punicWarsScenario } from "../punic-wars-scenario";
import { PUNIC_WARS_MAP_ASSET } from "../punic-map-asset";
import { FIRST_PUNIC_WAR_VERSIONS, PUNIC_WARS_VERSIONS, currentBuiltInVersion } from "../built-in-versions";

/** The built-in Numidian map is a scenario-owned copy of the DEMO geography. */
export const FIRST_PUNIC_WAR_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000201";
/** The 270 BCE map of 6,384 provinces (the 780-province map it replaced was ...0202). */
export const PUNIC_WARS_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000203";

export type PublicScenarioSummary = Readonly<{
  scenarioId: string;
  /** Stable per author; names the scenario's art, `public/worlds/<slug>.webp`. */
  slug: string;
  version: number;
  title: string;
  period: string;
  authorName: string;
  recommendedPlayers: number;
  /** The scenario's own opening situation, in a sentence or two; empty when it has none. */
  premise: string;
}>;

/**
 * Ensures the built-in scenarios exist as normal, versioned public scenarios,
 * with their current version (and only that one) written from code.
 */
export async function ensureBuiltInScenarios(db: ChronicaDatabase): Promise<void> {
  // Only the current version is written from code; see built-in-versions.ts.
  const numidian = currentBuiltInVersion(FIRST_PUNIC_WAR_VERSIONS);
  const punic = currentBuiltInVersion(PUNIC_WARS_VERSIONS);
  await db.transaction(async (tx) => {
    // The built-in scenario rows are locked against mutation by
    // prevent_unapproved_built_in_scenario_mutation() (see migrations 0020/0021)
    // to stop an accidental admin edit from silently changing curated content.
    // This function is the one already-reviewed, source-controlled path that is
    // allowed to advance the built-in scenario's version, so it carries its own
    // approval for its transaction only; SET LOCAL reverts automatically at commit.
    await tx.execute(sql`SET LOCAL chronica.scenario_mutation_approved = 'yes'`);
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
    await tx.insert(scenarios).values({ id: FIRST_PUNIC_WAR_SCENARIO_ID, slug: FIRST_PUNIC_WAR_SLUG, title: "The Numidian Decision", period: "264 BCE · First Punic War", authorId: CHRONICA_SYSTEM_USER_ID, visibility: "public", currentVersion: numidian.version }).onConflictDoNothing();
    await tx.insert(scenarioVersions).values({ scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID, version: numidian.version, mapAssetId: FIRST_PUNIC_WAR_MAP_ASSET_ID, definition: firstPunicWarScenario.definition, initialWorld: firstPunicWarScenario.initialWorld, schemaVersion: WORLD_SCHEMA_VERSION, origin: "built-in", validatedAt: new Date(), notes: numidian.notes }).onConflictDoNothing();
    await tx.update(scenarios).set({ title: "The Numidian Decision", period: "264 BCE · First Punic War", currentVersion: numidian.version, updatedAt: new Date() }).where(eq(scenarios.id, FIRST_PUNIC_WAR_SCENARIO_ID));
    await tx.insert(scenarioMapAssets).values({
      id: PUNIC_WARS_MAP_ASSET_ID,
      ownerId: CHRONICA_SYSTEM_USER_ID,
      objectKey: "built-in/punic-wars-270-bce-map-v2.geojson",
      mimeType: "application/geo+json",
      byteSize: BigInt(PUNIC_WARS_MAP_ASSET.byteSize),
      checksum: PUNIC_WARS_MAP_ASSET.checksum,
      featureCount: PUNIC_WARS_MAP_ASSET.featureCount,
      boundingBox: PUNIC_WARS_MAP_ASSET.boundingBox,
      rightsConfirmedAt: new Date(),
    }).onConflictDoNothing();
    await tx.insert(scenarios).values({ id: PUNIC_WARS_SCENARIO_ID, slug: PUNIC_WARS_SLUG, title: "Punic Wars", period: "270 BCE · Before the Punic Wars", authorId: CHRONICA_SYSTEM_USER_ID, visibility: "public", currentVersion: punic.version }).onConflictDoNothing();
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: punic.version, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: WORLD_SCHEMA_VERSION, origin: "built-in", validatedAt: new Date(), notes: punic.notes }).onConflictDoNothing();
    await tx.update(scenarios).set({ title: "Punic Wars", period: "270 BCE · Before the Punic Wars", currentVersion: punic.version, updatedAt: new Date() }).where(eq(scenarios.id, PUNIC_WARS_SCENARIO_ID));
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
      slug: scenarios.slug,
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

  return rows.map((row) => {
    const definition = ScenarioDefinitionSchema.parse(row.definition);
    return {
      scenarioId: row.scenarioId,
      slug: row.slug,
      version: row.version,
      title: row.title,
      period: row.period,
      authorName: row.authorName,
      recommendedPlayers: definition.continuity.startingSeatCount,
      premise: definition.chronicle.openingContext,
    };
  });
}

/**
 * The world a scenario version opens on, and its rules: what a catalogue page
 * reads to say when a world begins and who is in it. Callers cache it by
 * scenario and version, since a published version never changes.
 */
export async function getScenarioOpening(db: ChronicaDatabase, scenarioId: string, version: number): Promise<{ initialWorld: unknown; definition: unknown } | undefined> {
  const [row] = await db
    .select({ initialWorld: scenarioVersions.initialWorld, definition: scenarioVersions.definition })
    .from(scenarioVersions)
    .where(and(eq(scenarioVersions.scenarioId, scenarioId), eq(scenarioVersions.version, version)))
    .limit(1);
  return row;
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
    // An end-requested save has already released its slot in the dashboard;
    // count it the same way here so it cannot falsely block a new save.
    .where(and(eq(games.createdBy, userId), inArray(games.status, ["lobby", "active"]), isNull(games.endRequestedAt)));
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

export interface GameSummaryRow {
  readonly gameId: string;
  readonly title: string;
  readonly status: "lobby" | "active" | "finished" | "abandoned";
}

/** All saves created by this account, including paused and historical saves. */
export async function listHostedGames(db: ChronicaDatabase, userId: string): Promise<GameSummaryRow[]> {
  return db
    .select({ gameId: games.id, title: games.title, status: games.status })
    .from(games)
    .where(eq(games.createdBy, userId))
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

type LotAllocation = readonly Readonly<{ lotId: string; microUnits: string }>[];

/**
 * Permanently removes one account-owned save and all save-scoped data.
 * Financial and AI audit rows survive through their ON DELETE SET NULL links.
 */
export async function deleteOwnedGame(db: ChronicaDatabase, gameId: string, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select({ id: games.id, createdBy: games.createdBy }).from(games).where(eq(games.id, gameId)).for("update").limit(1);
    if (game === undefined) return false;
    if (game.createdBy !== userId) return false;

    const activeHolds = await tx.select().from(creditHolds)
      .where(and(eq(creditHolds.gameId, gameId), eq(creditHolds.status, "active")))
      .for("update");
    for (const hold of activeHolds) {
      const [wallet] = await tx.select().from(creditWallets).where(eq(creditWallets.id, hold.walletId)).for("update").limit(1);
      if (wallet === undefined) throw new Error("Coin wallet missing during save deletion.");
      for (const item of hold.lotAllocation as LotAllocation) {
        const amount = BigInt(item.microUnits);
        const [lot] = await tx.select().from(creditLots).where(eq(creditLots.id, item.lotId)).for("update").limit(1);
        if (lot !== undefined) await tx.update(creditLots).set({ heldMicrocredits: lot.heldMicrocredits - amount, remainingMicrocredits: lot.remainingMicrocredits + amount }).where(eq(creditLots.id, lot.id));
      }
      const availableAfter = wallet.availableMicrocredits + hold.maximumMicrocredits;
      await tx.update(creditWallets).set({ availableMicrocredits: availableAfter, heldMicrocredits: wallet.heldMicrocredits - hold.maximumMicrocredits, version: wallet.version + 1 }).where(eq(creditWallets.id, wallet.id));
      await tx.update(creditHolds).set({ status: "released" }).where(eq(creditHolds.id, hold.id));
      await tx.insert(creditLedgerEntries).values({ walletId: wallet.id, kind: "release", signedMicrocredits: hold.maximumMicrocredits, idempotencyKey: `release:deleted-save:${hold.id}`, gameId, workId: hold.workId, holdId: hold.id, balanceAfterMicrocredits: availableAfter, reason: "Save deleted before AI work completed" });
    }

    await tx.delete(games).where(eq(games.id, gameId));
    return true;
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
