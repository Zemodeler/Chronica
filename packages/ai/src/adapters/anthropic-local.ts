import Anthropic from "@anthropic-ai/sdk";
import type { AiOperation } from "@chronica/shared";
import type {
  AiAdapter,
  AiCallResult,
  AiConversationMessage,
  AiTier,
  AiToolCall,
  AiToolCallResult,
  AiToolDefinition,
} from "../adapter";
import { getConfiguredApiKey, getSelectedLocalAiModel } from "../local-key-selection";

// Operations that must return raw JSON — we use an assistant prefill of "{" to
// prevent the model from emitting prose preamble before the JSON object.
const JSON_MODE_OPERATIONS = new Set<AiOperation>([
  "enrich_npc_profile",
  "resolve_contact",
  "extract_knowledge",
  "propose_social_events",
  "declare_character",
  "confirm_character",
]);

const TIER_MODELS: Record<AiTier, string> = {
  basic: process.env.CHRONICA_AI_MODEL_BASIC ?? "claude-haiku-4-5",
  standard: process.env.CHRONICA_AI_MODEL_STANDARD ?? "claude-haiku-4-5",
  premium: process.env.CHRONICA_AI_MODEL_PREMIUM ?? "claude-haiku-4-5",
};

// None of the surviving operations (see docs/plans/delete-chronicle-orders-turns.md)
// were in the standard tier before this wipe -- preserved as empty rather than
// guessing a new tier assignment.
const STANDARD_TIER_OPERATIONS = new Set<AiOperation>([]);

function resolveModel(operation: AiOperation): string {
  const selectedModel = getSelectedLocalAiModel("anthropic");
  if (selectedModel !== null) return selectedModel;
  const tier: AiTier = STANDARD_TIER_OPERATIONS.has(operation) ? "standard" : "basic";
  return TIER_MODELS[tier];
}

/** Translate the caller-owned conversation into Anthropic messages. */
function toAnthropicMessages(messages: readonly AiConversationMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.content.length > 0) content.push({ type: "text", text: message.content });
      for (const toolCall of message.toolCalls) {
        content.push({ type: "tool_use", id: toolCall.id, name: toolCall.name, input: toolCall.arguments });
      }
      // An assistant turn with no content at all is not a valid message; the
      // loop only records a step that produced something, but guard anyway.
      if (content.length > 0) out.push({ role: "assistant", content });
      continue;
    }
    out.push({
      role: "user",
      content: message.results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.callId,
        content: result.content,
      })),
    });
  }
  return out;
}

export function createAnthropicLocalAdapter(): AiAdapter {
  let client: Anthropic | undefined;

  function getClient(): Anthropic {
    if (!client) {
      client = new Anthropic({ apiKey: getConfiguredApiKey("anthropic") });
    }
    return client;
  }

  return {
    async callWithTools(
      operation: AiOperation,
      systemPrompt: string,
      messages: readonly AiConversationMessage[],
      tools: readonly AiToolDefinition[],
    ): Promise<AiToolCallResult> {
      const model = resolveModel(operation);
      const response = await getClient().messages.create({
        model,
        max_tokens: 8_192,
        system: systemPrompt,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters as Anthropic.Tool.InputSchema,
        })),
        messages: toAnthropicMessages(messages),
      });
      const toolCalls: AiToolCall[] = response.content.flatMap((block) =>
        block.type === "tool_use"
          ? [{
              id: block.id,
              name: block.name,
              arguments:
                typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)
                  ? (block.input as Record<string, unknown>)
                  : {},
            }]
          : [],
      );
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
      return {
        content: text,
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        toolCalls,
        stopReason: response.stop_reason === "tool_use" ? "tool_calls" : response.stop_reason === "max_tokens" ? "length" : "stop",
      };
    },

    async call(operation, systemPrompt, userMessage): Promise<AiCallResult> {
      const model = resolveModel(operation);
      const isJsonMode = JSON_MODE_OPERATIONS.has(operation);
      const response = await getClient().messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          { role: "user", content: userMessage },
          // Assistant prefill forces the model to start with "{" and skip any prose preamble.
          ...(isJsonMode ? [{ role: "assistant" as const, content: "{" }] : []),
        ],
      });
      const block = response.content[0];
      if (block === undefined || block.type !== "text") {
        throw new Error("Anthropic returned no text content.");
      }
      // Restore the prefill character that the API strips from the response.
      const content = isJsonMode ? `{${block.text}` : block.text;
      return {
        content,
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
    },
  };
}
