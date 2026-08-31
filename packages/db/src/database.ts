import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

// Keep each application instance well below the small connection limits used
// by hosted Postgres plans. The idle timeout also releases pools orphaned by
// development hot reloads instead of letting them consume slots indefinitely.
const POSTGRES_OPTIONS = {
  max: 3,
  prepare: false,
  idle_timeout: 20,
  max_lifetime: 30 * 60,
} as const;

export function createDatabase(databaseUrl: string) {
  if (databaseUrl.trim() === "") throw new TypeError("A non-empty Postgres URL is required.");
  const client = postgres(databaseUrl, POSTGRES_OPTIONS);
  const db = drizzle(client, { schema });
  return {
    db,
    close: async (): Promise<void> => client.end(),
  };
}

export type ChronicaDatabase = ReturnType<typeof createDatabase>["db"];

// Module-level singleton for long-lived connections (e.g. SSE streams).
// The per-request createDatabase path is retained for all mutations.
let _sharedDb: ChronicaDatabase | null = null;

export function getSharedDatabase(databaseUrl: string): ChronicaDatabase {
  if (_sharedDb === null) {
    if (databaseUrl.trim() === "") throw new TypeError("A non-empty Postgres URL is required.");
    const client = postgres(databaseUrl, POSTGRES_OPTIONS);
    _sharedDb = drizzle(client, { schema });
  }
  return _sharedDb;
}
