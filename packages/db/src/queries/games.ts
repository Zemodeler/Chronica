import type { CharacterClaim } from "@chronica/shared";
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { ScenarioDefinitionSchema } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { users } from "../schema/auth";
import { characterClaims, gameInvites, games, players, scenarioMapAssets, scenarioVersions, scenarios } from "../schema/game";
import { creditHolds, creditLedgerEntries, creditLots, creditWallets } from "../schema/billing";
import { CHRONICA_SYSTEM_USER_ID, FIRST_PUNIC_WAR_SCENARIO_ID, FIRST_PUNIC_WAR_SLUG, firstPunicWarScenario } from "../built-in-scenarios";
import { PUNIC_WARS_SCENARIO_ID, PUNIC_WARS_SLUG, punicWarsScenario } from "../punic-wars-scenario";

/** The built-in Numidian map is a scenario-owned copy of the DEMO geography. */
export const FIRST_PUNIC_WAR_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000201";
export const PUNIC_WARS_MAP_ASSET_ID = "00000000-0000-4000-8000-000000000202";

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
    await tx.insert(scenarios).values({ id: FIRST_PUNIC_WAR_SCENARIO_ID, slug: FIRST_PUNIC_WAR_SLUG, title: "The Numidian Decision", period: "264 BCE · First Punic War", authorId: CHRONICA_SYSTEM_USER_ID, visibility: "public", currentVersion: 2 }).onConflictDoNothing();
    // Version 2 replaces the former Latium ID with the ID in the delivered
    // GeoJSON. Existing version-1 saves remain pinned to their immutable
    // record; new databases begin directly with the corrected version.
    await tx.insert(scenarioVersions).values({ scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID, version: 2, mapAssetId: FIRST_PUNIC_WAR_MAP_ASSET_ID, definition: firstPunicWarScenario.definition, initialWorld: firstPunicWarScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Aligns every simulated province with the delivered map geometry so armies always have a renderable location." }).onConflictDoNothing();
    // Version 3 is the first under Simulation Loop v1: the scenario clock is
    // now a calendar epoch plus day spans rather than seasons-per-year, and the
    // starting world is schema 2 (instant-authoritative). A version-2 row cannot
    // be edited in place, and a game pinned to it would no longer load.
    await tx.insert(scenarioVersions).values({ scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID, version: 3, mapAssetId: FIRST_PUNIC_WAR_MAP_ASSET_ID, definition: firstPunicWarScenario.definition, initialWorld: firstPunicWarScenario.initialWorld, schemaVersion: 2, origin: "built-in", validatedAt: new Date(), notes: "Continuous time: a calendar epoch and day-based spans replace the seasonal turn clock." }).onConflictDoNothing();
    // Version 4 widens the Roman command office's authorised actions. With only
    // force powers, a consul who raised legions and appointed their officers had
    // every appointment recorded as an authority breach.
    await tx.insert(scenarioVersions).values({ scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID, version: 4, mapAssetId: FIRST_PUNIC_WAR_MAP_ASSET_ID, definition: firstPunicWarScenario.definition, initialWorld: firstPunicWarScenario.initialWorld, schemaVersion: 2, origin: "built-in", validatedAt: new Date(), notes: "Gives the Roman command office the appointment and project powers a consul raising legions actually exercises." }).onConflictDoNothing();
    // Version 5 drops the workflow reference every political procedure carried.
    // The engine it named was removed with the turn system, nothing read it,
    // and a procedure's real need is to say what is being decided.
    await tx.insert(scenarioVersions).values({ scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID, version: 5, mapAssetId: FIRST_PUNIC_WAR_MAP_ASSET_ID, definition: firstPunicWarScenario.definition, initialWorld: firstPunicWarScenario.initialWorld, schemaVersion: 2, origin: "built-in", validatedAt: new Date(), notes: "Replaces each political procedure's dead workflow reference with a plain label saying what is being decided." }).onConflictDoNothing();
    await tx.update(scenarios).set({ title: "The Numidian Decision", period: "264 BCE · First Punic War", currentVersion: 5, updatedAt: new Date() }).where(eq(scenarios.id, FIRST_PUNIC_WAR_SCENARIO_ID));
    await tx.insert(scenarioMapAssets).values({
      id: PUNIC_WARS_MAP_ASSET_ID,
      ownerId: CHRONICA_SYSTEM_USER_ID,
      objectKey: "built-in/punic-wars-270-bce-map-v1.geojson",
      mimeType: "application/geo+json",
      byteSize: BigInt(1),
      checksum: "built-in-punic-wars-270-bce-map-v1",
      featureCount: 990,
      boundingBox: [-25, 20, 45, 72],
      rightsConfirmedAt: new Date(),
    }).onConflictDoNothing();
    await tx.insert(scenarios).values({ id: PUNIC_WARS_SCENARIO_ID, slug: PUNIC_WARS_SLUG, title: "Punic Wars", period: "270 BCE · Before the Punic Wars", authorId: CHRONICA_SYSTEM_USER_ID, visibility: "public", currentVersion: 1 }).onConflictDoNothing();
    // Version 5 fixes settlements missing a provinceId in some provinces,
    // which failed WorldStateSchema validation and blocked hosting entirely.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 5, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Fixes settlements missing provinceId that broke world-state validation on game creation." }).onConflictDoNothing();
    // Version 6 adds the Roman Senate institution and eligibility requirement
    // records that were missing entirely, which made every sponsor_procedure
    // (Senate petitions, command authorizations, office elections) fail its
    // dry run unconditionally -- canSponsorProcedure rejects any institutionId
    // that doesn't exist in world.material.institutions.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 6, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Adds the Roman Senate institution and eligibility requirements, which were missing and made every political procedure fail." }).onConflictDoNothing();
    // Version 7 adds the province adjacency graph (map.edges), which was
    // entirely empty -- every "which nearby polities might react" computation
    // (Reaction Director, near/far/coarse event scoping) silently had nothing
    // to read, so no neighboring polity could ever be proposed as a reactor
    // no matter what happened in its territory.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 7, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Adds the province adjacency graph, which was empty and silently disabled every neighbor-based reaction system." }).onConflictDoNothing();
    // Version 8 seats the second consul. Rome had two; the scenario modelled
    // one, already held, so a player who declared themselves consul found the
    // college full and started the game holding no office -- and therefore no
    // Authority at all.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 8, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Seats the second Roman consul, so a player who declares a consulship has a lawful seat to take." }).onConflictDoNothing();
    // Version 9 fixes the Mamertine spokesman's ambition, which named the
    // wrong-scenario settlement id "messana-city" instead of this scenario's
    // own "settlement-messana" (start_siege and any other settlement-naming
    // tool refuse an id that doesn't resolve). It also gives Carthage real
    // agency from the opening turn: an active goal, plot, and pressure over
    // the Messana crisis, and Hanno's own place among the storyline's
    // participants -- previously Carthage was a force with nothing for
    // character agency to act on, so it never proposed anything the Game
    // Master could invoke.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 9, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Fixes the Mamertine spokesman's ambition to name this scenario's own settlement id, and gives Carthage/Hanno an authored goal, plot, and pressure over the Messana crisis so Carthage has real agency from the opening turn." }).onConflictDoNothing();
    // Version 10 makes the playable world agree with the rendered map. A
    // settlement shown inside a simulated province is now present in that
    // province's authoritative state, so it can be inspected and besieged.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 10, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Adds every rendered settlement in a playable province to the authoritative starting world, preventing map-visible settlements from being impossible to inspect or besiege." }).onConflictDoNothing();
    // Version 11 aligns Etruria and Volsinii's authoritative controllers
    // with the opening map. Before this version the opening overlay displayed
    // Rome, but the seeded world assigned the territory to the Etruscan
    // cities; after the first turn the persisted state replaced the overlay
    // and made the territory appear to switch sides.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 11, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 1, origin: "built-in", validatedAt: new Date(), notes: "Aligns Etruria and Volsinii's authoritative Roman control with the opening map, preventing their controller from changing after the first turn." }).onConflictDoNothing();
    // Version 12: same cutover as the First Punic War's version 3 above.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 12, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 2, origin: "built-in", validatedAt: new Date(), notes: "Continuous time: a calendar epoch and day-based spans replace the seasonal turn clock." }).onConflictDoNothing();
    // Version 13: same office-powers widening as the First Punic War's version 4.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 13, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 2, origin: "built-in", validatedAt: new Date(), notes: "Gives the Roman consulship the appointment and project powers it actually exercises." }).onConflictDoNothing();
    // Version 14: same procedure-label change as the First Punic War's version 5.
    await tx.insert(scenarioVersions).values({ scenarioId: PUNIC_WARS_SCENARIO_ID, version: 14, mapAssetId: PUNIC_WARS_MAP_ASSET_ID, definition: punicWarsScenario.definition, initialWorld: punicWarsScenario.initialWorld, schemaVersion: 2, origin: "built-in", validatedAt: new Date(), notes: "Replaces each political procedure's dead workflow reference with a plain label saying what is being decided." }).onConflictDoNothing();
    await tx.update(scenarios).set({ title: "Punic Wars", period: "270 BCE · Before the Punic Wars", currentVersion: 14, updatedAt: new Date() }).where(eq(scenarios.id, PUNIC_WARS_SCENARIO_ID));
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
