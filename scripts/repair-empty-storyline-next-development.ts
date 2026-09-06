/**
 * Repairs world_snapshots rows saved with an empty `storyline.nextDevelopment`
 * (a bug in two resolution code paths, now fixed) so `WorldStateSchema.parse`
 * stops throwing on read. Idempotent -- safe to re-run.
 */
import { repairEmptyStorylineNextDevelopment, createDatabase } from "@chronica/db";

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`${label} is unavailable.`);
  return value;
}

async function main(): Promise<void> {
  const database = createDatabase(required(process.env.DATABASE_URL?.trim(), "DATABASE_URL"));
  try {
    const report = await repairEmptyStorylineNextDevelopment(database.db);
    console.log(JSON.stringify({ report }, null, 2));
  } finally {
    await database.close();
  }
}

void main();
