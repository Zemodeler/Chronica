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
export { createTimedPort, type TimedModelPort } from "./timed-port";
export { AiTimeoutError, aiMaxRetries, aiRequestTimeoutMs, isTimeout } from "./timeouts";
export { createAnthropicLocalAdapter } from "./adapters/anthropic-local";
export { createOpenAiLocalAdapter } from "./adapters/openai-local";
export { createMockAdapter, type MockAdapterOptions, type MockToolStep } from "./adapters/mock";
export { createHandAdapter, handStem, type HandAdapterOptions } from "./adapters/hand";
export {
  getConfiguredApiKey,
  getLocalAiProviderConfiguration,
  getSelectedLocalAiProvider,
  getSelectedLocalAiModel,
  selectLocalAiConfiguration,
  type LocalAiProvider,
  type LocalAiProviderConfiguration,
} from "./local-key-selection";

import { readFileSync } from "node:fs";
import type { AiAdapter } from "./adapter";
import { createAnthropicLocalAdapter } from "./adapters/anthropic-local";
import { createOpenAiLocalAdapter } from "./adapters/openai-local";
import { createMockAdapter, type MockToolStep } from "./adapters/mock";
import { getSelectedLocalAiProvider } from "./local-key-selection";
import path from "node:path";
import { createHandAdapter } from "./adapters/hand";

interface MockScriptFile {
  /** Returned verbatim by the plain (non-tool) `call`, e.g. for character declaration. */
  readonly content?: string;
  /** Replayed in order by `callWithTools`, e.g. for one turn's Game Master session. */
  readonly toolSteps?: readonly MockToolStep[];
}

/**
 * "mock" mode's script for the turn about to resolve, read fresh from the
 * JSON file at CHRONICA_MOCK_SCRIPT_FILE every time an adapter is created.
 * This exists so an end-to-end test can drive one specific, real outcome
 * (an actual `move_force` tool call, a specific character-declaration
 * response) without spending money or depending on a live provider's
 * non-determinism, and then rewrite or remove the file so the next call
 * falls back to the unscripted default (empty tool steps, "{}" content),
 * which exercises "the model stopped without finishing" on its own. Read
 * fresh rather than cached so each turn/call can script differently within
 * one server process. Never read outside "mock" mode.
 */
function readMockScriptFromEnvFile(): MockScriptFile | undefined {
  const path = process.env.CHRONICA_MOCK_SCRIPT_FILE?.trim();
  if (!path) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Factory — reads CHRONICA_AI_MODE to choose the adapter.
 *
 * "openai" (default): OpenAI API called directly from this process.
 * "local":            Anthropic API called directly from this process.
 * "mock":             deterministic fixture for tests.
 * "hand":             answered from files by a person, or by Claude working as
 *                     the model (`adapters/hand.ts`). Spends nothing. Prompts
 *                     and answers live in CHRONICA_HAND_DIR, by default
 *                     eval-out/hand under the working directory.
 * "worker":           reserved for M2 — calls the remote apps/worker HTTP endpoint.
 */
export function createAiAdapter(): AiAdapter {
  const mode = process.env.CHRONICA_AI_MODE ?? "openai";
  if (mode === "hand") {
    const dir = path.resolve(process.env.CHRONICA_HAND_DIR ?? "eval-out/hand");
    const timeout = Number(process.env.CHRONICA_HAND_TIMEOUT_MS ?? "");
    return createHandAdapter({
      dir,
      ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
      onWaiting: (promptPath) => console.log(`[ai] waiting for an answer to ${promptPath}`),
    });
  }
  if (mode !== "mock") {
    const localProvider = getSelectedLocalAiProvider();
    if (localProvider === "openai") return createOpenAiLocalAdapter();
    if (localProvider === "anthropic") return createAnthropicLocalAdapter();
  }
  switch (mode) {
    case "mock": {
      const script = readMockScriptFromEnvFile();
      return createMockAdapter(script?.content ?? "{}", script?.toolSteps ? { toolSteps: script.toolSteps } : {});
    }
    case "openai":
      return createOpenAiLocalAdapter();
    case "local":
      return createAnthropicLocalAdapter();
    default:
      throw new Error(`Unknown CHRONICA_AI_MODE: "${mode}". Use "openai", "local", "hand", or "mock".`);
  }
}
