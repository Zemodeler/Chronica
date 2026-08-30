import OpenAI from "openai";
import type { AiOperation, AiTier } from "@chronica/shared";
import type { AiAdapter, AiCallResult } from "../adapter";

// Model assignments per tier. Override via env vars if needed.
const TIER_MODELS: Record<AiTier, string> = {
  basic: process.env.CHRONICA_AI_MODEL_BASIC ?? "gpt-4o-mini",
  standard: process.env.CHRONICA_AI_MODEL_STANDARD ?? "gpt-4o",
  premium: process.env.CHRONICA_AI_MODEL_PREMIUM ?? "gpt-4o",
};

// Operations that use standard tier (everything else is basic).
const STANDARD_TIER_OPERATIONS = new Set<AiOperation>([
  "adjudicate",
  "narrate",
  "resolve_solo_turn",
]);

function resolveModel(operation: AiOperation): string {
  const tier: AiTier = STANDARD_TIER_OPERATIONS.has(operation) ? "standard" : "basic";
  return TIER_MODELS[tier];
}

export function createOpenAiLocalAdapter(): AiAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is required for the local AI adapter.");
  }
  const client = new OpenAI({ apiKey });

  return {
    async call(operation, systemPrompt, userMessage): Promise<AiCallResult> {
      const model = resolveModel(operation);
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      });
      const choice = response.choices[0];
      if (choice === undefined) throw new Error("OpenAI returned no choices.");
      const content = choice.message.content ?? "";
      const usage = response.usage;
      return {
        content,
        model,
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      };
    },
  };
}
