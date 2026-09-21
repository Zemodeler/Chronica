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
import { watchForDegeneration } from "../degeneration";
import { AiTimeoutError, aiMaxMs, aiMaxRetries, aiRequestTimeoutMs, stallWatchdog } from "../timeouts";

const JSON_MODE_OPERATIONS = new Set<AiOperation>([
  "enrich_npc_profile",
  "resolve_contact",
  "extract_knowledge",
  "propose_social_events",
  "declare_character",
  "confirm_character",
  "simulate_orchestrate",
  "simulate_cognition",
  // The Chronicle's answer is parsed as JSON and always was -- its prompt ends
  // "Answer with JSON and nothing else" -- but it was never listed here, so it
  // ran without `response_format` and a single line of prose preamble dropped
  // the whole report to the plain-facts fallback.
  "compose_chronicle",
]);

/**
 * Operations whose thinking is cheap, kept separate from the format decision above.
 *
 * These two were one list, which tied *how the answer is shaped* to *how hard
 * the model thinks about it*. The consequence was invisible and expensive: the
 * Chronicle was not in the JSON set, so it also got no reasoning ceiling, and
 * ran at the model's default effort -- the most deliberative setting in the
 * whole turn, spent on the one call whose output is a schema. Separating them
 * lets the historian keep the deliberation its prose depends on while the two
 * structured calls stay cheap.
 */
const LOW_EFFORT_OPERATIONS = new Set<AiOperation>([
  "enrich_npc_profile",
  "resolve_contact",
  "extract_knowledge",
  "propose_social_events",
  "declare_character",
  "confirm_character",
  "simulate_orchestrate",
  "simulate_cognition",
]);

type ReasoningEffort = "low" | "medium" | "high";

/**
 * What the historian is allowed to spend on thinking.
 *
 * Left unset it is the provider's default, which is what the prose was written
 * against. It is an environment knob rather than a constant because in local
 * development every operation resolves to the same model -- the selected-model
 * override below bypasses the tier table entirely -- so the Chronicle runs on
 * the reasoning model rather than the cheap one, and that is worth being able
 * to dial without a code change.
 */
const CHRONICLE_EFFORT = process.env.CHRONICA_AI_CHRONICLE_EFFORT?.trim() as ReasoningEffort | undefined;

function reasoningEffortFor(operation: AiOperation): ReasoningEffort | undefined {
  if (operation === "compose_chronicle") return CHRONICLE_EFFORT;
  return LOW_EFFORT_OPERATIONS.has(operation) ? "low" : undefined;
}

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

// These are ceilings, not targets: a runaway guard, deliberately well above
// what a full answer needs. On a reasoning model the hidden reasoning is drawn
// from this same budget, so a tight ceiling does not save time -- it truncates,
// fails the schema, and buys a second full-price call, which is the most
// expensive thing that can happen to a turn. Sending nothing at all, which is
// what this map did while it was empty, means a pathological generation has no
// ceiling whatsoever.
// Measured against real bursts: the longest honest answers were about 4,000
// output tokens for orchestration and 3,100 for a half-cast of cognition, so
// these are roughly double what the work actually needs.
//
// They were briefly twice this, on the reasoning that a ceiling which
// truncates is worse than none. A live burst showed the other half of that
// trade: one cognition call degenerated into filler -- literal
// "1p2q3r4s5t6u..." -- and ran to exactly 16,000 tokens over seventy-five
// seconds, which was two-fifths of the whole turn. A runaway is stopped by the
// ceiling or not at all, and the stall deadline cannot help, because a model
// producing nonsense is still producing.
const MAX_COMPLETION_TOKENS: Partial<Record<AiOperation, number>> = {
  simulate_orchestrate: 8_000,
  simulate_cognition: 8_000,
  compose_chronicle: 4_000,
};

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

/** One client for the life of the process -- see the note in anthropic-local.ts. */
let sharedClient: OpenAI | undefined;

function getClient(): OpenAI {
  if (!sharedClient) {
    sharedClient = new OpenAI({
      apiKey: getConfiguredApiKey("openai"),
      timeout: aiMaxMs(),
      maxRetries: aiMaxRetries(),
    });
  }
  return sharedClient;
}

export function createOpenAiLocalAdapter(): AiAdapter {
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
      const effort = reasoningEffortFor(operation);
      const baseMaxCompletionTokens = MAX_COMPLETION_TOKENS[operation];

      // Streamed so the deadline can be a stall rather than a total. A
      // reasoning model is silent while it thinks and then answers steadily,
      // so "took longer than thirty seconds" and "stopped answering" are
      // entirely different events, and only the second is worth abandoning.
      const attempt = async (maxCompletionTokens: number | undefined) => {
        const watchdog = stallWatchdog(aiRequestTimeoutMs());
        const stream = await getClient().chat.completions.create({
          model,
          stream: true,
          stream_options: { include_usage: true },
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
          // completion_tokens usage is nonzero. Left unset (undefined) where
          // prose quality benefits from the model's default effort.
          ...(effort === undefined ? {} : { reasoning_effort: effort }),
        }, { signal: watchdog.signal, timeout: aiMaxMs() });

        let content = "";
        let finishReason: string | null = null;
        let usage: OpenAI.Completions.CompletionUsage | undefined;
        const degeneration = watchForDegeneration(operation);
        try {
          for await (const chunk of stream) {
            // Any sign of life restarts the clock. Reasoning happens before the
            // first token, so this is what separates a model thinking hard from
            // a connection that has died.
            watchdog.alive();
            const choice = chunk.choices[0];
            const said = choice?.delta?.content ?? "";
            content += said;
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (chunk.usage) usage = chunk.usage;

            // Still typing, no longer saying anything. Cut it off here rather
            // than paying out the rest of the ceiling: what comes back is
            // treated exactly like any other truncated answer, so the salvage
            // and the repair get their turn, only seconds in instead of a
            // minute.
            const spiral = degeneration.feed(said);
            if (spiral !== null) {
              console.warn(`[ai] ${operation} stopped making sense on ${model} (${spiral}); abandoning the answer.`);
              finishReason = "length";
              break;
            }
          }
        } catch (error) {
          // An abort here is our own watchdog, not the provider's refusal.
          if (watchdog.signal.aborted) throw new AiTimeoutError(operation, aiRequestTimeoutMs());
          throw error;
        } finally {
          watchdog.done();
        }

        // A call that ran into its ceiling was paid for and will be thrown
        // away by the schema, then repaired at full price. Silent, until now.
        if (finishReason === "length") {
          console.warn(`[ai] ${operation} hit its output ceiling (${maxCompletionTokens ?? "none"}) on ${model}; the answer is truncated and will need repairing.`);
        }
        return { content, usage };
      };

      let { content, usage } = await attempt(baseMaxCompletionTokens);
      // Defensive retry: even at low reasoning effort, a sufficiently complex
      // prompt can still exhaust the budget before emitting content. Retrying
      // once with a larger ceiling is far cheaper than silently dropping the
      // player's order (the caller has no other signal that this happened --
      // it just sees an unparseable empty string).
      if (content === "" && baseMaxCompletionTokens !== undefined) {
        ({ content, usage } = await attempt(baseMaxCompletionTokens * 2));
      }
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
