/**
 * Folds each game's still-pending legacy `npc_commitments` rows into the
 * canonical, replayable `world.commitments` ledger (character-sim phase 3).
 * Idempotent -- safe to re-run.
 */
import { backfillLegacyCommitments, createDatabase } from "@chronica/db";

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`${label} is unavailable.`);
  return value;
}

async function main(): Promise<void> {
  const database = createDatabase(required(process.env.DATABASE_URL?.trim(), "DATABASE_URL"));
  try {
    const report = await backfillLegacyCommitments(database.db);
    console.log(JSON.stringify({ report }, null, 2));
  } finally {
    await database.close();
  }
}

void main();
