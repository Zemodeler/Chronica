import { createDatabase, expireStaleHolds, reapStaleBursts } from "@chronica/db";
import { ABANDONED_ERROR, BURST_STALE_MS, STALE_HOLD_MS, livenessAt } from "./burst-status";

/**
 * What the last server left running, cleared when this one starts.
 *
 * Reaping used to be lazy: a burst whose process died with the server stayed
 * `running` until somebody opened that game or gave it an order, and the
 * coins its unfinished call held stayed held. Now the server sweeps every
 * game as it starts, and once more a heartbeat's grace later -- a burst the
 * old process was running seconds before it died still looks alive at the
 * first sweep, and cannot at the second.
 */
export async function sweepOrphanedBursts(databaseUrl: string, now = new Date()): Promise<{ bursts: number; holds: number }> {
  const { db, close } = createDatabase(databaseUrl);
  try {
    const [bursts, holds] = await Promise.all([
      reapStaleBursts(db, null, livenessAt(now), ABANDONED_ERROR),
      expireStaleHolds(db, new Date(now.getTime() - STALE_HOLD_MS)),
    ]);
    return { bursts, holds };
  } finally {
    await close();
  }
}

/** Sweeps now and again after `BURST_STALE_MS`; never throws, never holds the process open. */
export function scheduleOrphanSweeps(databaseUrl: string): void {
  const sweep = (): void => {
    void sweepOrphanedBursts(databaseUrl).then(
      ({ bursts, holds }) => { if (bursts > 0 || holds > 0) console.warn(`[startup] cleared ${bursts} orphaned burst(s) and ${holds} stale coin hold(s)`); },
      (error: unknown) => { console.warn("[startup] the orphaned-burst sweep failed:", error); },
    );
  };
  sweep();
  setTimeout(sweep, BURST_STALE_MS + 5_000).unref();
}
