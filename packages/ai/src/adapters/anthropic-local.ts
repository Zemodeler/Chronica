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
import { AiTimeoutError, aiMaxMs, aiMaxRetries, aiRequestTimeoutMs, stallWatchdog } from "../timeouts";

// Operations that must return raw JSON — we use an assistant prefill of "{" to
// prevent the model from emitting prose preamble before the JSON object.
const JSON_MODE_OPERATIONS = new Set<AiOperation>([
  "enrich_npc_profile",
  "resolve_contact",
  "extract_knowledge",
  "propose_social_events",
  "declare_character",
  "confirm_character",
  "simulate_orchestrate",
  "simulate_cognition",
  // Parsed as JSON and always was; it was simply never listed, so a line of
  // prose preamble dropped the whole report to the plain-facts fallback.
  "compose_chronicle",
]);

/**
 * How much room an answer is given.
 *
 * This was a flat 4096 for every operation, which is less than the
 * orchestrator's own schema permits: twenty-four deltas, sixteen facts and
 * twelve scheduled events do not fit, so a full answer was cut off mid-object,
 * failed to parse, and bought a second full-price call. A ceiling below what
 * the schema allows is not a budget, it is a guarantee of a repair.
 */
const MAX_OUTPUT_TOKENS: Partial<Record<AiOperation, number>> = {
  simulate_orchestrate: 8_192,
  simulate_cognition: 8_192,
};
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

const TIER_MODELS: Record<AiTier, string> = {
  basic: process.env.CHRONICA_AI_MODEL_BASIC ?? "claude-haiku-4-5",
  standard: process.env.CHRONICA_AI_MODEL_STANDARD ?? "claude-haiku-4-5",
  premium: process.env.CHRONICA_AI_MODEL_PREMIUM ?? "claude-haiku-4-5",
};

// None of the surviving operations (see docs/plans/delete-chronicle-orders-turns.md)
// were in the standard tier before this wipe -- preserved as empty rather than
// guessing a new tier assignment.
// The loop's reasoning calls: orchestration weighs an entire world slice and
// cognition roleplays several actors from their own knowledge. Both are the
// judgment the design rests on, so neither runs on the cheapest tier.
const STANDARD_TIER_OPERATIONS = new Set<AiOperation>(["simulate_orchestrate", "simulate_cognition"]);

function resolveModel(operation: AiOperation): string {
  const selectedModel = getSelectedLocalAiModel("anthropic");
  if (selectedModel !== null) return selectedModel;
  const tier: AiTier = STANDARD_TIER_OPERATIONS.has(operation) ? "standard" : "basic";
  return TIER_MODELS[tier];
}

/**
 * The system prompt, marked for the provider's cache.
 *
 * Every system prompt in this codebase is a module constant, and the two the
 * simulation loop leans on are enormous: sixty thousand characters for the
 * orchestrator and forty-five for cognition, most of it generated JSON schema.
 * They were re-sent in full on every call of every turn. A smoke test has
 * asserted for some time that the prompt "is cached on every call after the
 * first"; on this adapter that was simply not true, because nothing ever asked
 * for it.
 */
function cacheable(systemPrompt: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
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

/**
 * One client for the life of the process, not one per turn.
 *
 * `createAiAdapter()` is called once per order, and this used to live inside
 * the factory closure, so every turn opened a fresh TLS connection before its
 * first token. The key is read from the environment, which does not change
 * under us; the model is resolved per call and is not baked in here.
 */
let sharedClient: Anthropic | undefined;

function getClient(): Anthropic {
  if (!sharedClient) {
    sharedClient = new Anthropic({
      apiKey: getConfiguredApiKey("anthropic"),
      timeout: aiMaxMs(),
      maxRetries: aiMaxRetries(),
    });
  }
  return sharedClient;
}

export function createAnthropicLocalAdapter(): AiAdapter {
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
        system: cacheable(systemPrompt),
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
      // Streamed for the same reason as the OpenAI adapter: so the deadline can
      // be "thirty seconds of silence" rather than "thirty seconds", which is
      // the difference between abandoning a dead call and abandoning a working
      // one that had a lot to say.
      const watchdog = stallWatchdog(aiRequestTimeoutMs());
      const stream = getClient().messages.stream({
        model,
        max_tokens: MAX_OUTPUT_TOKENS[operation] ?? DEFAULT_MAX_OUTPUT_TOKENS,
        system: cacheable(systemPrompt),
        messages: [
          { role: "user", content: userMessage },
          // Assistant prefill forces the model to start with "{" and skip any prose preamble.
          ...(isJsonMode ? [{ role: "assistant" as const, content: "{" }] : []),
        ],
      }, { signal: watchdog.signal, timeout: aiMaxMs() });

      // No degeneration watch on this path, unlike the OpenAI one.
      //
      // Abandoning a stream part-way means building the result out of what has
      // arrived, and the usage figures the coin ledger settles against only
      // come with the finished message -- so a half-read answer here would be
      // an unbilled one. That is worth solving before this adapter carries a
      // live game; until then the output ceiling above is what bounds a
      // runaway, which is where the OpenAI path was until it was measured.
      let response;
      try {
        for await (const _event of stream) watchdog.alive();
        response = await stream.finalMessage();
      } catch (error) {
        if (watchdog.signal.aborted) throw new AiTimeoutError(operation, aiRequestTimeoutMs());
        throw error;
      } finally {
        watchdog.done();
      }

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
