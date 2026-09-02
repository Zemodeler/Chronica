import OpenAI from "openai";
import type { AiOperation, AiTier } from "@chronica/shared";
import type { AiAdapter, AiCallResult } from "../adapter";
import { getConfiguredApiKey, getSelectedLocalAiModel } from "../local-key-selection";

const JSON_MODE_OPERATIONS = new Set<AiOperation>([
  "interpret_order",
  "assess_orders",
  "adjudicate",
  "propose_near_events",
  "propose_far_events",
  "propose_coarse_events",
  "character_director",
  "reaction_director",
  "simulator",
  "world_director",
  "chronicle_narrator",
  "enrich_npc_profile",
  "resolve_contact",
  "extract_knowledge",
  "propose_social_events",
  "workflow_manager",
  "declare_character",
  "confirm_character",
]);

// Model assignments per tier. Override via env vars if needed.
const TIER_MODELS: Record<AiTier, string> = {
  basic: process.env.CHRONICA_AI_MODEL_BASIC ?? "gpt-5-nano",
  standard: process.env.CHRONICA_AI_MODEL_STANDARD ?? "gpt-5.6-luna",
  premium: process.env.CHRONICA_AI_MODEL_PREMIUM ?? "gpt-5.6-sol",
};

// Operations that use standard tier (everything else is basic).
const STANDARD_TIER_OPERATIONS = new Set<AiOperation>([
  "adjudicate",
  "narrate",
  "resolve_solo_turn",
  "propose_near_events",
  "chronicle_narrator",
  "character_director",
  "reaction_director",
  "simulator",
  "world_director",
  "workflow_manager",
]);

function resolveModel(operation: AiOperation): string {
  const selectedModel = getSelectedLocalAiModel("openai");
  if (selectedModel !== null) return selectedModel;
  const tier: AiTier = STANDARD_TIER_OPERATIONS.has(operation) ? "standard" : "basic";
  return TIER_MODELS[tier];
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
    async call(operation, systemPrompt, userMessage): Promise<AiCallResult> {
      const model = resolveModel(operation);
      const isJsonMode = JSON_MODE_OPERATIONS.has(operation);
      const response = await getClient().chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        ...(isJsonMode ? { response_format: { type: "json_object" as const } } : {}),
      });
      const choice = response.choices[0];
      if (choice === undefined) throw new Error("OpenAI returned no choices.");
      const content = choice.message.content ?? "";
      const usage = response.usage;
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
