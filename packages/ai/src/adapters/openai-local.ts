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

// These are ceilings, not targets. They keep structured routing calls from
// spending a turn's latency and coins on prose the parser will discard, while
// leaving the chronicle enough room for its explicitly requested scenes.
const MAX_COMPLETION_TOKENS: Partial<Record<AiOperation, number>> = {
  interpret_order: 700,
  assess_orders: 500,
  adjudicate: 1_000,
  reaction_director: 1_200,
  simulator: 1_600,
  character_director: 1_600,
  world_director: 1_800,
  workflow_manager: 1_600,
  chronicle_narrator: 3_000,
};

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
