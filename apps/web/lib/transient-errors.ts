/**
 * Errors that say nothing about the turn: the database dropped the
 * connection, restarted, or picked this transaction to break a deadlock.
 *
 * Only these are worth another attempt of a durable turn. Everything else --
 * a provider refusing the account, a world that would not load, the world
 * moving under the turn -- would fail again the same way, and every attempt
 * makes model calls; retrying those would charge the player for the same
 * failure twice.
 */

/** Postgres SQLSTATEs: connection exceptions (08), operator intervention (57P0x), serialization failure, deadlock, too many connections. */
const TRANSIENT_SQLSTATES = new Set(["08000", "08001", "08003", "08004", "08006", "57P01", "57P02", "57P03", "40001", "40P01", "53300"]);
/** What Node's sockets and postgres-js say when the connection itself went away. */
const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT"]);

export function isTransientInfrastructureError(error: unknown): boolean {
  for (let current = error, depth = 0; typeof current === "object" && current !== null && depth < 8; current = (current as { cause?: unknown }).cause, depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && (TRANSIENT_SQLSTATES.has(code) || TRANSIENT_CODES.has(code))) return true;
  }
  return false;
}
