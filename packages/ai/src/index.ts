export type {
  AiAdapter,
  AiCallResult,
  AiConversationMessage,
  AiToolCall,
  AiToolCallResult,
  AiToolDefinition,
  AiToolResultMessage,
} from "./adapter";
export { parseToolArguments } from "./adapter";
export { callWithCoinGate, callWithToolsAndCoinGate, InsufficientCoinsError, AiParseError } from "./coin-gate";
export { createAnthropicLocalAdapter } from "./adapters/anthropic-local";
export { createOpenAiLocalAdapter } from "./adapters/openai-local";
export { createMockAdapter, type MockAdapterOptions, type MockToolStep } from "./adapters/mock";
export {
  getConfiguredApiKey,
  getLocalAiProviderConfiguration,
  getSelectedLocalAiProvider,
  getSelectedLocalAiModel,
  selectLocalAiConfiguration,
  type LocalAiProvider,
  type LocalAiProviderConfiguration,
} from "./local-key-selection";

import type { AiAdapter } from "./adapter";
import { createAnthropicLocalAdapter } from "./adapters/anthropic-local";
import { createOpenAiLocalAdapter } from "./adapters/openai-local";
import { createMockAdapter } from "./adapters/mock";
import { getSelectedLocalAiProvider } from "./local-key-selection";

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
  if (mode !== "mock") {
    const localProvider = getSelectedLocalAiProvider();
    if (localProvider === "openai") return createOpenAiLocalAdapter();
    if (localProvider === "anthropic") return createAnthropicLocalAdapter();
  }
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
