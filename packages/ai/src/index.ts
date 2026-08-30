export type { AiAdapter, AiCallResult } from "./adapter";
export { callWithCoinGate, InsufficientCoinsError } from "./coin-gate";
export { createOpenAiLocalAdapter } from "./adapters/openai-local";
export { createMockAdapter } from "./adapters/mock";

import type { AiAdapter } from "./adapter";
import { createOpenAiLocalAdapter } from "./adapters/openai-local";
import { createMockAdapter } from "./adapters/mock";

/**
 * Factory — reads CHRONICA_AI_MODE to choose the adapter.
 *
 * "local"  (default in dev): OpenAI API called directly from this process.
 * "mock":  deterministic fixture for tests.
 * "worker": reserved for M2 — calls the remote apps/worker HTTP endpoint.
 *
 * To switch to the cloud worker when M2 ships, set CHRONICA_AI_MODE=worker
 * and implement the worker adapter without touching call sites.
 */
export function createAiAdapter(): AiAdapter {
  const mode = process.env.CHRONICA_AI_MODE ?? "local";
  switch (mode) {
    case "mock":
      return createMockAdapter();
    case "local":
      return createOpenAiLocalAdapter();
    default:
      throw new Error(`Unknown CHRONICA_AI_MODE: "${mode}". Use "local" or "mock".`);
  }
}
