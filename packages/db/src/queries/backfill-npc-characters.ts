import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { WorldStateSchema } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { games, turns, worldSnapshots } from "../schema/game";
import { listGameNpcRecords } from "./dialogue";
import { upsertCharacterProfile } from "./character-social";

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
    unmatchedRecords: [],
  };

  const allGames = await db.select({ id: games.id }).from(games);

  for (const game of allGames) {
    report.gamesScanned++;
    const records = await listGameNpcRecords(db, game.id);
    if (records.length === 0) continue;
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

    let world = parsedWorld.data;
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

      await upsertCharacterProfile(db, {
        gameId: game.id,
        characterId: record.characterId,
        version: 1,
        roleLabel: record.roleLabel,
        biography: null,
        voiceSummary: null,
        presentationDetails: {},
        updatedAtStep: world.elapsedStep,
      });
      report.charactersAdded++;
      changed = true;
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
