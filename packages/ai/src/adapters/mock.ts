import type { AiOperation } from "@chronica/shared";
import type {
  AiAdapter,
  AiCallResult,
  AiConversationMessage,
  AiToolCall,
  AiToolCallResult,
  AiToolDefinition,
} from "../adapter";

// Deterministic fixture for tests. Returns a minimal valid JSON blob so callers
// that parse the content won't throw on unexpected structure.

/** One scripted assistant step in a tool-using conversation. */
export interface MockToolStep {
  readonly content?: string;
  readonly toolCalls?: readonly { readonly name: string; readonly arguments: Record<string, unknown> }[];
}

export interface MockAdapterOptions {
  /**
   * Steps replayed in order by `callWithTools`. Once exhausted, the adapter
   * returns a plain text step with no tool calls, which a Game Master loop
   * treats as "the model stopped without finishing".
   */
  readonly toolSteps?: readonly MockToolStep[];
  /** Every conversation the adapter was handed, in order, for assertions. */
  readonly onConversation?: (messages: readonly AiConversationMessage[], tools: readonly AiToolDefinition[]) => void;
}

export function createMockAdapter(fixedContent = "{}", options: MockAdapterOptions = {}): AiAdapter {
  let stepIndex = 0;
  let callCounter = 0;

  return {
    call(_operation: AiOperation): Promise<AiCallResult> {
      return Promise.resolve({
        content: fixedContent,
        model: "mock",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
    },
    callWithTools(
      _operation: AiOperation,
      _systemPrompt: string,
      messages: readonly AiConversationMessage[],
      tools: readonly AiToolDefinition[],
    ): Promise<AiToolCallResult> {
      options.onConversation?.(messages, tools);
      const step = options.toolSteps?.[stepIndex];
      stepIndex += 1;
      const toolCalls: AiToolCall[] = (step?.toolCalls ?? []).map((call) => {
        callCounter += 1;
        return { id: `mock-call-${callCounter}`, name: call.name, arguments: call.arguments };
      });
      return Promise.resolve({
        content: step?.content ?? "",
        model: "mock",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls,
        stopReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      });
    },
  };
}
