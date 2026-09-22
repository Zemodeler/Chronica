import path from "node:path";
import os from "node:os";
import { defineConfig, devices } from "@playwright/test";
import { STATE_FILE } from "./e2e/paths";

// Real-browser end-to-end coverage for the turn-resolution / Chronicle /
// deterministic-military-fallback fix. The dev server this spins up always
// runs with CHRONICA_AI_MODE=mock, so no spec here can ever reach a live AI
// provider or spend money -- see CHRONICA_MOCK_SCRIPT_FILE below, which the
// specs themselves overwrite between turns to script exactly one AI outcome
// (or none, to exercise the deterministic fallback).
//
// Runs on its own dedicated port (3100), never 3000: a developer's own
// "npm run dev" may already be running on 3000 in real (non-mock) AI mode,
// and reusing that server here would silently defeat the mock-mode
// guarantee this whole spec exists to give. reuseExistingServer is
// deliberately false for the same reason -- this suite always starts (and
// tears down) its own mock-mode server rather than ever adopting someone
// else's. The command invokes "next dev" directly (not "npm run dev") so
// Playwright can actually kill the process it started -- npm on Windows
// wraps next dev in a child process that survives an npm-parent kill,
// which otherwise leaks a stray dev server on every run.
export const MOCK_SCRIPT_FILE = path.join(os.tmpdir(), "chronica-e2e-mock-script.json");
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Signing up and making a save per test cost more than the tests did --
    // against `next dev` every route compiles on its first hit. It happens
    // once here, and everything else starts from a world that exists.
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STATE_FILE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    cwd: __dirname,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: String(PORT),
      CHRONICA_AI_MODE: "mock",
      CHRONICA_MOCK_SCRIPT_FILE: MOCK_SCRIPT_FILE,
    },
  },
});
