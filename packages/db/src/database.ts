import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

/**
 * Keep each application instance well below the small connection limits used
 * by hosted Postgres plans. The idle timeout also releases pools orphaned by
 * development hot reloads instead of letting them consume slots indefinitely.
 *
 * Three was too few once the burst began making model calls concurrently.
 * Every model call takes a coin hold, which is a transaction, which is a
 * connection for as long as the call runs -- so the pool, not the provider,
 * was the ceiling on how many passages of a Chronicle could be written at
 * once. Ten is still modest for any Postgres worth deploying on, and the
 * environment can lower it where a plan is stricter than that.
 */
const POOL_MAX = (() => {
  const configured = Number(process.env.CHRONICA_DB_POOL_MAX?.trim());
  return Number.isInteger(configured) && configured > 0 ? configured : 10;
})();

const POSTGRES_OPTIONS = {
  max: POOL_MAX,
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
