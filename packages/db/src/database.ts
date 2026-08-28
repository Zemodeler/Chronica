import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export function createDatabase(databaseUrl: string) {
  if (databaseUrl.trim() === "") throw new TypeError("A non-empty Postgres URL is required.");
  const client = postgres(databaseUrl, { max: 10, prepare: false });
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
    const client = postgres(databaseUrl, { max: 5, prepare: false });
    _sharedDb = drizzle(client, { schema });
  }
  return _sharedDb;
}
