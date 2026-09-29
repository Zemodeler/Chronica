import type { AiOperation } from "@chronica/shared";

/**
 * Model tier an adapter picks per operation. Adapter-internal only -- the
 * turn-resolution routing profile this once shared space with in
 * `@chronica/shared` (`actions/ai-routing.ts`) was removed along with the
 * rest of the workflow-execution engine (see
 * docs/plans/delete-chronicle-orders-turns.md).
 */
export type AiTier = "basic" | "standard" | "premium";

export interface AiCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

// Structured tool-use turn (GM refactor, requirement 3).
//
// `call` is a single prompt in, single string out. That is the right shape for
// a classifier or a narrator, and the wrong shape for a game master, which has
// to look at the world, act on it, see exactly what the deterministic engine
// did, and decide again. `callWithTools` is that second shape: one provider
// round-trip that may come back with tool calls, run against a conversation
// the caller owns and extends with real tool results.
//
// The adapter does not run the loop and does not execute tools. It converts
// one conversation into one assistant step. The caller (apps/web's game-master
// runner) owns the loop, the staged world, and every tool result, so the model
// can never be handed anything the engine did not produce.

export interface AiToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema (draft-07) for the tool's arguments. */
  readonly parameters: Record<string, unknown>;
}

export interface AiToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface AiToolResultMessage {
  readonly callId: string;
  readonly name: string;
  /** Verbatim factual text produced by the engine. Never model-authored. */
  readonly content: string;
}

export type AiConversationMessage =
  | { readonly role: "user"; readonly content: string }
  | {
    readonly role: "assistant";
    readonly content: string;
    readonly toolCalls: readonly AiToolCall[];
    /**
     * Whatever the provider needs to continue its own reasoning, carried back
     * verbatim on the next step. On a reasoning model this holds the reasoning
     * items, which is the difference between an agent that thinks across a
     * turn and one that starts over at every tool result. Opaque by design:
     * the loop copies it, never inspects it, and a provider that has no such
     * state simply leaves it undefined.
     */
    readonly providerItems?: unknown;
  }
  | { readonly role: "tool_results"; readonly results: readonly AiToolResultMessage[] };

export interface AiToolCallResult extends AiCallResult {
  /** Tool calls the model asked for this step, in the order it asked for them. */
  readonly toolCalls: readonly AiToolCall[];
  /**
   * Why the provider stopped. "tool_calls" means it wants results back;
   * "stop" means it produced text and asked for nothing.
   */
  readonly stopReason: "tool_calls" | "stop" | "length";
  /** See `AiConversationMessage`'s assistant variant; pass straight back on the next step. */
  readonly providerItems?: unknown;
}

export interface AiAdapter {
  /**
   * An adapter that spends nothing: its answers come from a person, not a
   * provider (`adapters/hand.ts`). The coin gate lets its calls through
   * without a hold -- there is nothing to reserve, and a hold left waiting on
   * a person would outlive the stale-hold sweep. The mock adapter is not
   * free: its tests exist to exercise the gate.
   */
  readonly free?: boolean;
  call(operation: AiOperation, systemPrompt: string, userMessage: string): Promise<AiCallResult>;
  /**
   * One step of a tool-using conversation. Implementations must return the
   * model's tool calls with arguments already parsed from JSON; a call whose
   * arguments do not parse is returned with an empty argument object so the
   * caller can refuse it factually rather than crash.
   */
  callWithTools(
    operation: AiOperation,
    systemPrompt: string,
    messages: readonly AiConversationMessage[],
    tools: readonly AiToolDefinition[],
  ): Promise<AiToolCallResult>;
}

/** Parse provider-supplied tool arguments without ever throwing. */
export function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
