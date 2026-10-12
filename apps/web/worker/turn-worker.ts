/**
 * The turn worker as its own process: `npm run worker -w @chronica/web`.
 *
 * Carries out the durable turns the web servers queue, so the web can be
 * restarted, scaled or deployed without failing a turn in flight. Run any
 * number of these against one database; set `CHRONICA_TURN_WORKER=external`
 * on the web servers so they only queue. See apps/web/TURN-WORKER.md.
 *
 * Reads the same configuration as the web (the repository root's `.env*`
 * files, then the environment). Stops on SIGINT/SIGTERM: it takes no new turn,
 * waits up to `CHRONICA_TURN_WORKER_DRAIN_MS` (60 s) for the ones in hand, and
 * hands any still running back to the queue for the next worker.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvConfig } from "@next/env";

/** The repository root: the nearest directory up from here whose package.json declares workspaces. */
function repositoryRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && "workspaces" in (JSON.parse(readFileSync(manifest, "utf8")) as object)) return dir;
    if (dirname(dir) === dir) return from;
  }
}

async function main(): Promise<void> {
  loadEnvConfig(repositoryRoot(process.cwd()), process.env.NODE_ENV !== "production", console, true);
  // Imported once the configuration is in the environment: the database pool
  // and the AI adapter read theirs as they load.
  const { sweepOrphanedBursts } = await import("../lib/orphan-sweep");
  const { startTurnWorker, workerConcurrency } = await import("../lib/turn-worker");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    console.error("[turn worker] DATABASE_URL is required.");
    process.exit(1);
  }

  const swept = await sweepOrphanedBursts(databaseUrl).catch((error: unknown) => { console.warn("[turn worker] the startup sweep failed:", error); return null; });
  if (swept !== null && (swept.bursts > 0 || swept.turns > 0 || swept.holds > 0)) console.warn(`[turn worker] cleared ${swept.bursts} orphaned burst(s), ${swept.turns} durable turn(s) no worker can finish and ${swept.holds} stale coin hold(s)`);

  const drain = Number(process.env.CHRONICA_TURN_WORKER_DRAIN_MS?.trim());
  const worker = startTurnWorker({
    databaseUrl,
    concurrency: workerConcurrency(),
    ...(Number.isFinite(drain) && drain >= 0 && process.env.CHRONICA_TURN_WORKER_DRAIN_MS?.trim() ? { drainMs: drain } : {}),
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.info(`[turn worker ${worker.workerId}] ${signal}: stopping`);
    void worker.stop().then(() => process.exit(0), (error: unknown) => { console.error("[turn worker] did not stop cleanly:", error); process.exit(1); });
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  // The loop's timers do not hold the process open; this does, until a signal.
  setInterval(() => undefined, 60_000);
}

void main();
