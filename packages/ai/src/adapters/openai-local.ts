import OpenAI from "openai";
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
import { parseToolArguments } from "../adapter";
import { getConfiguredApiKey, getSelectedLocalAiModel } from "../local-key-selection";

const JSON_MODE_OPERATIONS = new Set<AiOperation>([
  "enrich_npc_profile",
  "resolve_contact",
  "extract_knowledge",
  "propose_social_events",
  "declare_character",
  "confirm_character",
  "simulate_orchestrate",
  "simulate_cognition",
]);

// Model assignments per tier. Override via env vars if needed.
const TIER_MODELS: Record<AiTier, string> = {
  basic: process.env.CHRONICA_AI_MODEL_BASIC ?? "gpt-5-nano",
  standard: process.env.CHRONICA_AI_MODEL_STANDARD ?? "gpt-5.6-luna",
  premium: process.env.CHRONICA_AI_MODEL_PREMIUM ?? "gpt-5.6-sol",
};

// Operations that use standard tier (everything else is basic). None of the
// surviving operations (see docs/plans/delete-chronicle-orders-turns.md) were
// in the standard tier before this wipe -- preserved as empty rather than
// guessing a new tier assignment.
// The loop's reasoning calls: orchestration weighs an entire world slice and
// cognition roleplays several actors from their own knowledge. Both are the
// judgment the design rests on, so neither runs on the cheapest tier.
const STANDARD_TIER_OPERATIONS = new Set<AiOperation>(["simulate_orchestrate", "simulate_cognition"]);

// These are ceilings, not targets. They keep structured routing calls from
// spending a turn's latency and coins on prose the parser will discard, while
// leaving the chronicle enough room for its explicitly requested scenes. None
// of the surviving operations had an entry before this wipe -- preserved as
// empty (falls through to `undefined`, the original behavior for these ops).
const MAX_COMPLETION_TOKENS: Partial<Record<AiOperation, number>> = {};

// Responses-API budget for the tool loop: one step, not the whole turn. Set
// well above what the visible tool calls need, because reasoning tokens are
// drawn from the same budget. Empty for the same reason as above -- this
// always fell through to the 8_000 default for every surviving operation.
const MAX_OUTPUT_TOKENS: Partial<Record<AiOperation, number>> = {};

function resolveModel(operation: AiOperation): string {
  const selectedModel = getSelectedLocalAiModel("openai");
  if (selectedModel !== null) return selectedModel;
  const tier: AiTier = STANDARD_TIER_OPERATIONS.has(operation) ? "standard" : "basic";
  return TIER_MODELS[tier];
}

// The Game Master's tool loop runs on the Responses API, not chat completions.
//
// A reasoning model refuses function tools on /v1/chat/completions unless
// reasoning is switched off entirely:
//
//   400 Function tools with reasoning_effort are not supported for
//   <model> in /v1/chat/completions. To use function tools, use
//   /v1/responses or set reasoning_effort to 'none'.
//
// Turning reasoning off would be the cheap fix and the wrong one: deciding a
// whole turn against tool results is the one operation in this codebase that
// most needs to think. So the loop uses /v1/responses, which supports both,
// and carries the model's own reasoning items forward between steps through
// the opaque `providerItems` channel.

type ResponseInputItem = OpenAI.Responses.ResponseInputItem;

/**
 * Translate the caller-owned conversation into Responses input items.
 *
 * An assistant step is replayed from `providerItems` when the provider gave us
 * some — that preserves the reasoning items alongside the calls. Reconstructed
 * function calls are the fallback, which is correct but forgetful.
 */
function toResponsesInput(messages: readonly AiConversationMessage[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      input.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      if (Array.isArray(message.providerItems)) {
        input.push(...(message.providerItems as ResponseInputItem[]));
        continue;
      }
      for (const toolCall of message.toolCalls) {
        input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        });
      }
      continue;
    }
    for (const result of message.results) {
      input.push({ type: "function_call_output", call_id: result.callId, output: result.content });
    }
  }
  return input;
}

export function createOpenAiLocalAdapter(): AiAdapter {
  let client: OpenAI | undefined;

  function getClient(): OpenAI {
    if (!client) {
      client = new OpenAI({ apiKey: getConfiguredApiKey("openai") });
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
      const response = await getClient().responses.create({
        model,
        instructions: systemPrompt,
        input: toResponsesInput(messages),
        tools: tools.map((tool) => ({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          // The registry's own Zod schemas are the validator, and several are
          // richer than the strict-mode subset allows. Parameters are parsed
          // and refused deterministically by the staged session anyway.
          strict: false,
        })),
        tool_choice: "auto",
        // Reasoning tokens are drawn from this budget too, so it is well above
        // what the visible tool calls alone would need.
        max_output_tokens: MAX_OUTPUT_TOKENS[operation] ?? 8_000,
        reasoning: { effort: "low" },
      });

      const toolCalls: AiToolCall[] = response.output.flatMap((item) =>
        item.type === "function_call"
          ? [{ id: item.call_id, name: item.name, arguments: parseToolArguments(item.arguments) }]
          : [],
      );
      const cacheReadTokens = response.usage?.input_tokens_details?.cached_tokens ?? 0;
      return {
        content: response.output_text ?? "",
        model,
        inputTokens: Math.max(0, (response.usage?.input_tokens ?? 0) - cacheReadTokens),
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens: 0,
        toolCalls,
        stopReason: toolCalls.length > 0 ? "tool_calls" : response.status === "incomplete" ? "length" : "stop",
        // Replayed verbatim next step, reasoning items included.
        providerItems: response.output,
      };
    },
    async call(operation, systemPrompt, userMessage): Promise<AiCallResult> {
      const model = resolveModel(operation);
      const isJsonMode = JSON_MODE_OPERATIONS.has(operation);
      const baseMaxCompletionTokens = MAX_COMPLETION_TOKENS[operation];

      const attempt = async (maxCompletionTokens: number | undefined) => {
        const response = await getClient().chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          ...(isJsonMode ? { response_format: { type: "json_object" as const } } : {}),
          ...(maxCompletionTokens !== undefined ? { max_completion_tokens: maxCompletionTokens } : {}),
          // These are short, deterministic, schema-bound tasks (JSON in, JSON
          // out) that never need deep deliberation. On a reasoning model, an
          // unconstrained effort can spend the entire max_completion_tokens
          // budget on hidden reasoning tokens and leave nothing for the
          // visible answer -- message.content comes back "" even though
          // completion_tokens usage is nonzero. Left unset (undefined) for
          // non-JSON-mode calls such as chronicle_narrator, whose prose
          // quality benefits from the model's default effort.
          ...(isJsonMode ? { reasoning_effort: "low" as const } : {}),
        });
        const choice = response.choices[0];
        if (choice === undefined) throw new Error("OpenAI returned no choices.");
        return { choice, usage: response.usage };
      };

      let { choice, usage } = await attempt(baseMaxCompletionTokens);
      // Defensive retry: even at low reasoning effort, a sufficiently complex
      // prompt can still exhaust the budget before emitting content. Retrying
      // once with a larger ceiling is far cheaper than silently dropping the
      // player's order (the caller has no other signal that this happened --
      // it just sees an unparseable empty string).
      if ((choice.message.content ?? "") === "" && baseMaxCompletionTokens !== undefined) {
        ({ choice, usage } = await attempt(baseMaxCompletionTokens * 2));
      }
      const content = choice.message.content ?? "";
      // OpenAI reports prompt_tokens as the total prompt size, including tokens
      // read from its prompt cache.  The billing model stores mutually exclusive
      // categories, so remove cached tokens before recording regular input.
      const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const inputTokens = Math.max(0, (usage?.prompt_tokens ?? 0) - cacheReadTokens);
      return {
        content,
        model,
        inputTokens,
        outputTokens: usage?.completion_tokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens: 0,
      };
    },
  };
}
