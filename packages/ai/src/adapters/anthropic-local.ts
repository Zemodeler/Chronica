import Anthropic from "@anthropic-ai/sdk";
import type { AiOperation, AiTier } from "@chronica/shared";
import type { AiAdapter, AiCallResult } from "../adapter";

const TIER_MODELS: Record<AiTier, string> = {
  basic: process.env.CHRONICA_AI_MODEL_BASIC ?? "claude-haiku-4-5",
  standard: process.env.CHRONICA_AI_MODEL_STANDARD ?? "claude-haiku-4-5",
  premium: process.env.CHRONICA_AI_MODEL_PREMIUM ?? "claude-haiku-4-5",
};

const STANDARD_TIER_OPERATIONS = new Set<AiOperation>([
  "adjudicate",
  "narrate",
  "resolve_solo_turn",
  "propose_near_events",
  "chronicle_narrator",
]);

function resolveModel(operation: AiOperation): string {
  const tier: AiTier = STANDARD_TIER_OPERATIONS.has(operation) ? "standard" : "basic";
  return TIER_MODELS[tier];
}

export function createAnthropicLocalAdapter(): AiAdapter {
  let client: Anthropic | undefined;

  function getClient(): Anthropic {
    if (!client) {
      client = new Anthropic();
    }
    return client;
  }

  return {
    async call(operation, systemPrompt, userMessage): Promise<AiCallResult> {
      const model = resolveModel(operation);
      const response = await getClient().messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });
      const block = response.content[0];
      if (block === undefined || block.type !== "text") {
        throw new Error("Anthropic returned no text content.");
      }
      return {
        content: block.text,
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
    },
  };
}
