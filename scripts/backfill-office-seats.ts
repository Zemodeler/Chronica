/**
 * Synthesizes an authoritative OfficeSeat (holder/vacancy/term/provenance)
 * for every office a character's pre-phase-4 `officeId` still names but no
 * seat record exists for yet (character-sim phase 4). Idempotent -- safe to
 * re-run.
 */
import { backfillOfficeSeats, createDatabase } from "@chronica/db";

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`${label} is unavailable.`);
  return value;
}

async function main(): Promise<void> {
  const database = createDatabase(required(process.env.DATABASE_URL?.trim(), "DATABASE_URL"));
  try {
    const report = await backfillOfficeSeats(database.db);
    console.log(JSON.stringify({ report }, null, 2));
  } finally {
    await database.close();
  }
}

void main();
