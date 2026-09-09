import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { createCanonicalNpc, ensureCharacterAccounts, linkCanonicalCharacters, WorldStateSchema } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { games, turns, worldSnapshots } from "../schema/game";
import { listGameNpcRecords } from "./dialogue";
import { dialogueSessions, npcChatKnowledgebases } from "../schema/dialogue";
import { characterProfiles } from "../schema/character-social";
import { players } from "../schema/game";

// Backfill: `gameNpcRecords` → `WorldState.characters` (character-sim phase 1).
//
// `gameNpcRecords` is deprecated as a runtime source (dialogue-service.ts no
// longer reads or writes it); `listGameNpcRecords` survives solely so this
// script and its verification can still read the legacy rows. Idempotent: a
// character already present in the latest snapshot is counted as a duplicate
// and skipped, so running this twice changes nothing the second time.
//
// A snapshot is a hashed, immutable-by-convention document (ADR-0002), but
// this is a one-time data correction, not a new turn -- the same pattern the
// existing coin-denomination migration used (0009_account_coin_wallet.sql):
// a direct UPDATE of already-persisted rows, recomputing the hash.

export interface BackfillUnmatchedRecord {
  readonly gameId: string;
  readonly characterId: string;
  readonly reason: string;
}

export interface BackfillReport {
  gamesScanned: number;
  gamesWithRecords: number;
  gamesUpdated: number;
  recordsScanned: number;
  charactersAdded: number;
  duplicatesSkipped: number;
  knowledgebasesCreated: number;
  contactsCreated: number;
  unmatchedRecords: BackfillUnmatchedRecord[];
}

export async function backfillNpcCharacters(db: ChronicaDatabase): Promise<BackfillReport> {
  const report: BackfillReport = {
    gamesScanned: 0,
    gamesWithRecords: 0,
    gamesUpdated: 0,
    recordsScanned: 0,
    charactersAdded: 0,
    duplicatesSkipped: 0,
    knowledgebasesCreated: 0,
    contactsCreated: 0,
    unmatchedRecords: [],
  };

  const allGames = await db.select({ id: games.id }).from(games);

  for (const game of allGames) {
    report.gamesScanned++;
    const [records, knowledgebases, sessions, profiles, gamePlayers] = await Promise.all([
      listGameNpcRecords(db, game.id),
      db.select().from(npcChatKnowledgebases).where(eq(npcChatKnowledgebases.gameId, game.id)),
      db.select().from(dialogueSessions).where(eq(dialogueSessions.gameId, game.id)),
      db.select().from(characterProfiles).where(eq(characterProfiles.gameId, game.id)),
      db.select({ id: players.id, characterId: players.characterId }).from(players).where(eq(players.gameId, game.id)),
    ]);
    if (records.length === 0 && knowledgebases.length === 0 && sessions.length === 0 && profiles.length === 0) continue;
    report.gamesWithRecords++;

    const [snapshotRow] = await db
      .select({ turnId: worldSnapshots.turnId, state: worldSnapshots.state })
      .from(worldSnapshots)
      .innerJoin(turns, eq(turns.id, worldSnapshots.turnId))
      .where(eq(turns.gameId, game.id))
      .orderBy(desc(turns.index))
      .limit(1);

    if (snapshotRow === undefined) {
      for (const record of records) {
        report.unmatchedRecords.push({ gameId: game.id, characterId: record.characterId, reason: "No world snapshot exists for this game." });
      }
      continue;
    }

    const parsedWorld = WorldStateSchema.safeParse(snapshotRow.state);
    if (!parsedWorld.success) {
      for (const record of records) {
        report.unmatchedRecords.push({ gameId: game.id, characterId: record.characterId, reason: "Latest snapshot failed schema validation." });
      }
      continue;
    }

    let world = ensureCharacterAccounts(parsedWorld.data);
    const existingIds = new Set(world.characters.map((c) => c.id));
    let changed = false;

    for (const record of records) {
      report.recordsScanned++;
      if (existingIds.has(record.characterId)) {
        report.duplicatesSkipped++;
        continue;
      }

      world = {
        ...world,
        characters: [...world.characters, record.character],
        continuity: [
          ...world.continuity,
          {
            characterId: record.characterId,
            tier: "ordinary",
            notability: 0,
            encounterIds: [],
            lastingChanges: [],
            plan: null,
          },
        ],
      };
      existingIds.add(record.characterId);

      report.charactersAdded++;
      changed = true;
    }

    // A chat knowledgebase is enough to identify a legacy person safely.  It
    // becomes a canonical NPC using only explicit fields plus documented
    // scenario defaults (first valid province, zero liquid funds).  A bare
    // session or UI profile has no authoritative name, so it is reported for
    // review instead of inventing history.
    for (const kb of knowledgebases) {
      if (existingIds.has(kb.npcCharacterId)) continue;
      report.recordsScanned++;
      const owner = gamePlayers.find((player) => player.id === kb.playerId);
      const playerCharacter = owner === undefined ? undefined : world.characters.find((character) => character.id === owner.characterId);
      if (playerCharacter === undefined) {
        report.unmatchedRecords.push({ gameId: game.id, characterId: kb.npcCharacterId, reason: "Chat contact owner is not materialised in canonical world state." });
        continue;
      }
      const locationProvinceId = kb.locationProvinceId !== null && world.map.provinces.some((province) => province.id === kb.locationProvinceId)
        ? kb.locationProvinceId
        : playerCharacter.locationProvinceId;
      const created = createCanonicalNpc(world, {
        characterId: kb.npcCharacterId,
        name: kb.canonicalName,
        locationProvinceId,
        polityId: world.map.provinces.find((province) => province.id === locationProvinceId)?.controllerPolityId ?? playerCharacter.polityId,
        ...(kb.skills === null ? {} : { skills: kb.skills }),
        startingMoney: 0,
        createdAtStep: world.elapsedStep,
        creationReason: "Legacy chat contact materialised during NPC identity unification.",
      });
      if (created === null) {
        report.unmatchedRecords.push({ gameId: game.id, characterId: kb.npcCharacterId, reason: "Legacy chat contact has no safe canonical location or purse." });
        continue;
      }
      world = linkCanonicalCharacters(created.world, playerCharacter.id, kb.npcCharacterId, kb.declaredConnection, kb.relationshipScore, world.elapsedStep);
      world = linkCanonicalCharacters(world, kb.npcCharacterId, playerCharacter.id, kb.declaredConnection, kb.relationshipScore, world.elapsedStep);
      existingIds.add(kb.npcCharacterId);
      report.charactersAdded++;
      changed = true;
    }

    const kbIds = new Set(knowledgebases.map((kb) => `${kb.playerId}:${kb.npcCharacterId}`));
    for (const session of sessions) {
      if (session.npcCharacterId !== null && !kbIds.has(`${session.playerId}:${session.npcCharacterId}`)) {
        report.unmatchedRecords.push({ gameId: game.id, characterId: session.npcCharacterId, reason: "Dialogue session has no knowledgebase; preserving history for manual identity review." });
      }
    }
    for (const profile of profiles) {
      if (!existingIds.has(profile.characterId) && !knowledgebases.some((kb) => kb.npcCharacterId === profile.characterId)) {
        report.unmatchedRecords.push({ gameId: game.id, characterId: profile.characterId, reason: "UI profile has no canonical character or chat knowledgebase; insufficient identity data to materialise safely." });
      }
    }

    if (changed) {
      const worldJson = JSON.stringify(world);
      const stateHash = createHash("sha256").update(worldJson).digest("hex");
      await db
        .update(worldSnapshots)
        .set({ state: JSON.parse(worldJson) as unknown, stateHash })
        .where(eq(worldSnapshots.turnId, snapshotRow.turnId));
      report.gamesUpdated++;
    }
  }

  return report;
}

/** Re-scans without writing, to confirm a prior backfill left no duplicates and no gaps. */
export async function verifyNpcBackfill(db: ChronicaDatabase): Promise<{ duplicateCharacterIds: string[]; stillMissing: BackfillUnmatchedRecord[] }> {
  const duplicateCharacterIds: string[] = [];
  const stillMissing: BackfillUnmatchedRecord[] = [];
  const allGames = await db.select({ id: games.id }).from(games);

  for (const game of allGames) {
    const records = await listGameNpcRecords(db, game.id);
    if (records.length === 0) continue;

    const [snapshotRow] = await db
      .select({ state: worldSnapshots.state })
      .from(worldSnapshots)
      .innerJoin(turns, eq(turns.id, worldSnapshots.turnId))
      .where(eq(turns.gameId, game.id))
      .orderBy(desc(turns.index))
      .limit(1);
    const parsedWorld = snapshotRow === undefined ? undefined : WorldStateSchema.safeParse(snapshotRow.state);
    const characters = parsedWorld?.success === true ? parsedWorld.data.characters : [];

    const seen = new Set<string>();
    for (const character of characters) {
      if (seen.has(character.id)) duplicateCharacterIds.push(character.id);
      seen.add(character.id);
    }
    for (const record of records) {
      if (!seen.has(record.characterId)) {
        stillMissing.push({ gameId: game.id, characterId: record.characterId, reason: "Not present in the latest snapshot after backfill." });
      }
    }
  }

  return { duplicateCharacterIds, stillMissing };
}
