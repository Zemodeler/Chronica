/**
 * Backfills every legacy `gameNpcRecords` character into its game's latest
 * world snapshot (character-sim phase 1). Idempotent -- safe to re-run.
 * Prints a verification report; never deletes the legacy rows.
 */
import { backfillNpcCharacters, createDatabase, verifyNpcBackfill } from "@chronica/db";

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`${label} is unavailable.`);
  return value;
}

async function main(): Promise<void> {
  const database = createDatabase(required(process.env.DATABASE_URL?.trim(), "DATABASE_URL"));
  try {
    const report = await backfillNpcCharacters(database.db);
    const verification = await verifyNpcBackfill(database.db);
    console.log(JSON.stringify({ report, verification }, null, 2));
    if (verification.duplicateCharacterIds.length > 0 || verification.stillMissing.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
}

void main();
