/**
 * Replaces any character whose canonical `mind` is still the flat neutral
 * schema default with one properly derived from their role, skills, office,
 * age, and culture (character-sim phase 2). Idempotent -- safe to re-run.
 */
import { backfillCharacterMinds, createDatabase } from "@chronica/db";

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`${label} is unavailable.`);
  return value;
}

async function main(): Promise<void> {
  const database = createDatabase(required(process.env.DATABASE_URL?.trim(), "DATABASE_URL"));
  try {
    const report = await backfillCharacterMinds(database.db);
    console.log(JSON.stringify({ report }, null, 2));
  } finally {
    await database.close();
  }
}

void main();
