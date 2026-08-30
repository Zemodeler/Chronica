export type { AiAdapter, AiCallResult } from "./adapter";
export { callWithCoinGate, InsufficientCoinsError, AiParseError } from "./coin-gate";
export { createAnthropicLocalAdapter } from "./adapters/anthropic-local";
export { createOpenAiLocalAdapter } from "./adapters/openai-local";
export { createMockAdapter } from "./adapters/mock";

import type { AiAdapter } from "./adapter";
import { createAnthropicLocalAdapter } from "./adapters/anthropic-local";
import { createOpenAiLocalAdapter } from "./adapters/openai-local";
import { createMockAdapter } from "./adapters/mock";

/**
 * Factory — reads CHRONICA_AI_MODE to choose the adapter.
 *
 * "openai" (default): OpenAI API called directly from this process.
 * "local":            Anthropic API called directly from this process.
 * "mock":             deterministic fixture for tests.
 * "worker":           reserved for M2 — calls the remote apps/worker HTTP endpoint.
 */
export function createAiAdapter(): AiAdapter {
  const mode = process.env.CHRONICA_AI_MODE ?? "openai";
  switch (mode) {
    case "mock":
      return createMockAdapter();
    case "openai":
      return createOpenAiLocalAdapter();
    case "local":
      return createAnthropicLocalAdapter();
    default:
      throw new Error(`Unknown CHRONICA_AI_MODE: "${mode}". Use "openai", "local", or "mock".`);
  }
}
