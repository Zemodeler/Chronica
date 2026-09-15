#!/usr/bin/env node
// Durable turn-resolution worker (unified action runtime, durable dispatch;
// AI-HANDSHAKE-PROMPTS/issue-01-durable-dispatch.md). Run this as a second,
// long-running process alongside `next start`/`npm run dev` -- it is the only
// thing that can resolve a queued turn once the request that submitted the
// order (and its best-effort `after()` wake-up) is gone. Correctness never
// depends on this script: the web app enqueues, and `claimTurnForResolution`
// makes concurrent claims from multiple workers or web instances safe.
//
// Local:      npm run worker
// Deployment: run this file with the same environment as the web server
//             (CHRONICA_PUBLIC_URL pointed at that server, and a
//             CHRONICA_WORKER_SECRET shared with it) under your process
//             supervisor of choice (systemd, pm2, a second container, ...).

import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(resolve(dirname(fileURLToPath(import.meta.url)), ".."), true, console, true);

const baseUrl = (process.env.CHRONICA_PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.CHRONICA_WORKER_SECRET?.trim();
const pollIntervalMs = Number(process.env.CHRONICA_WORKER_POLL_INTERVAL_MS ?? 2000);

if (!secret) {
  console.error("[turn-worker] CHRONICA_WORKER_SECRET is required (must match the web server's value).");
  process.exit(1);
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`[turn-worker] received ${signal}, stopping after the current tick.`);
    stopping = true;
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tick() {
  const response = await fetch(`${baseUrl}/api/internal/worker-tick`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!response.ok) {
    throw new Error(`worker-tick responded ${response.status}: ${await response.text().catch(() => "")}`);
  }
  return response.json();
}

async function main() {
  console.log(`[turn-worker] polling ${baseUrl} every ${pollIntervalMs}ms`);
  let consecutiveFailures = 0;
  while (!stopping) {
    try {
      const result = await tick();
      consecutiveFailures = 0;
      if (result.processedGameIds?.length) {
        console.log(`[turn-worker] resolved: ${result.processedGameIds.join(", ")}`);
      }
      for (const failure of result.errors ?? []) {
        console.error(`[turn-worker] game ${failure.gameId} failed: ${failure.message}`);
      }
    } catch (error) {
      consecutiveFailures += 1;
      console.error("[turn-worker] tick failed:", error instanceof Error ? error.message : error);
    }
    // Back off on repeated transport/auth failures so a down web server
    // doesn't turn this into a tight failing loop; a healthy tick always
    // waits exactly `pollIntervalMs`.
    const waitMs = consecutiveFailures > 0
      ? Math.min(pollIntervalMs * 2 ** Math.min(consecutiveFailures, 5), 30_000)
      : pollIntervalMs;
    await delay(waitMs);
  }
  console.log("[turn-worker] stopped.");
}

main();
