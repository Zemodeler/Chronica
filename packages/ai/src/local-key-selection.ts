import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type LocalAiProvider = "openai" | "anthropic" | "codex";

export type LocalAiProviderConfiguration = Readonly<{
  available: boolean;
  activeProvider: LocalAiProvider;
  activeModel: string;
  openAiConfigured: boolean;
  anthropicConfigured: boolean;
  openAiModels: readonly string[];
  anthropicModels: readonly string[];
  codexModels: readonly string[];
}>;

const LOCAL_SETTINGS_FILE = ".chronica.local-ai.json";

/**
 * This preference exists only for a local development server. It stores the
 * selected provider, never an API key; keys remain in the local environment
 * file.
 */
export function getLocalAiProviderConfiguration(): LocalAiProviderConfiguration {
  if (!isLocalDevelopment() || process.env.CHRONICA_AI_MODE === "mock") {
    return unavailableConfiguration();
  }

  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const openAiModels = modelsForProvider("openai");
  const anthropicModels = modelsForProvider("anthropic");
  const codexModels = modelsForProvider("codex");
  const preferredProvider = readSelectedProvider() ?? defaultProviderForCurrentAdapter();
  const activeProvider = preferredProvider === "codex" ? "codex" : preferredProvider === "openai" && openAiConfigured
    ? "openai"
    : preferredProvider === "anthropic" && anthropicConfigured
      ? "anthropic"
      : openAiConfigured ? "openai" : anthropicConfigured ? "anthropic" : preferredProvider;
  const selectedModel = readSelectedConfiguration()?.activeModel;
  const activeModels = activeProvider === "codex" ? codexModels : activeProvider === "openai" ? openAiModels : anthropicModels;
  return {
    available: true,
    activeProvider,
    activeModel: selectedModel !== undefined && activeModels.includes(selectedModel) ? selectedModel : activeModels[0]!,
    openAiConfigured,
    anthropicConfigured,
    openAiModels,
    anthropicModels,
    codexModels,
  };
}

export function selectLocalAiConfiguration(provider: LocalAiProvider, model: string): void {
  validateLocalAiConfiguration(provider, model);
  const settingsFile = settingsFilePath();
  const temporaryFile = `${settingsFile}.${process.pid}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify({ activeProvider: provider, activeModel: model }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryFile, settingsFile);
  cachedSelection = null;
}

/** Validate before installation/sign-in so invalid browser submissions have no side effects. */
export function validateLocalAiConfiguration(provider: LocalAiProvider, model: string): void {
  const configuration = getLocalAiProviderConfiguration();
  if (!configuration.available) {
    throw new Error("No configured local AI provider is available to select.");
  }
  if (provider === "openai" && !configuration.openAiConfigured) {
    throw new Error("The OpenAI API key is not configured.");
  }
  if (provider === "anthropic" && !configuration.anthropicConfigured) {
    throw new Error("The Anthropic API key is not configured.");
  }
  if (!modelsForProvider(provider).includes(model)) {
    throw new Error("The selected local AI model is not available for this provider.");
  }
}

export function getConfiguredApiKey(provider: "openai" | "anthropic"): string | undefined {
  return process.env[primaryKeyName(provider)]?.trim() || undefined;
}

export function getSelectedLocalAiProvider(): LocalAiProvider | null {
  const configuration = getLocalAiProviderConfiguration();
  if (!configuration.available) return null;
  return configuration.activeProvider;
}

export function getSelectedLocalAiModel(provider: LocalAiProvider): string | null {
  const configuration = getLocalAiProviderConfiguration();
  if (!configuration.available || configuration.activeProvider !== provider) return null;
  return configuration.activeModel;
}

function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

function defaultProviderForCurrentAdapter(): LocalAiProvider {
  const mode = process.env.CHRONICA_AI_MODE ?? "openai";
  return mode === "hand" ? "codex" : mode === "local" ? "anthropic" : "openai";
}

function primaryKeyName(provider: "openai" | "anthropic"): "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" {
  return provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
}

/**
 * The selection file, read at most once a second.
 *
 * `resolveModel` calls this on every single model call, so a development-only
 * preference file was being read synchronously from disk in the middle of the
 * request path, several times a turn. The window is short enough that picking
 * a different model on the account screen still takes effect at once.
 */
const SELECTION_CACHE_MS = 1_000;
let cachedSelection: { at: number; value: { activeProvider: LocalAiProvider; activeModel?: string } | null } | null = null;

function readSelectedConfiguration(): { activeProvider: LocalAiProvider; activeModel?: string } | null {
  const now = Date.now();
  if (cachedSelection !== null && now - cachedSelection.at < SELECTION_CACHE_MS) return cachedSelection.value;
  const value = readSelectedConfigurationFromDisk();
  cachedSelection = { at: now, value };
  return value;
}

function readSelectedConfigurationFromDisk(): { activeProvider: LocalAiProvider; activeModel?: string } | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsFilePath(), "utf8"));
    if (typeof parsed === "object" && parsed !== null && "activeProvider" in parsed) {
      if (parsed.activeProvider === "openai" || parsed.activeProvider === "anthropic" || parsed.activeProvider === "codex") {
        if ("activeModel" in parsed && typeof parsed.activeModel === "string") {
          return { activeProvider: parsed.activeProvider, activeModel: parsed.activeModel };
        }
        return { activeProvider: parsed.activeProvider };
      }
    }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  return null;
}

function readSelectedProvider(): LocalAiProvider | null {
  return readSelectedConfiguration()?.activeProvider ?? null;
}

function modelsForProvider(provider: LocalAiProvider): readonly string[] {
  if (provider === "codex") {
    const configured = process.env.CHRONICA_LOCAL_CODEX_MODELS?.split(",").map((model) => model.trim()).filter(Boolean);
    if (configured?.length) return [...new Set(configured)];
    return [...new Set([process.env.CHRONICA_HAND_MODEL?.trim() || "gpt-6-luna", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-astra"])];
  }
  const configured = provider === "openai" ? process.env.CHRONICA_LOCAL_OPENAI_MODELS : process.env.CHRONICA_LOCAL_ANTHROPIC_MODELS;
  const models = configured?.split(",").map((model) => model.trim()).filter(Boolean);
  if (models && models.length > 0) return [...new Set(models)];
  return provider === "openai"
    ? ["gpt-6-luna", "gpt-5-nano", "gpt-6-sol"]
    : ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"];
}

function unavailableConfiguration(): LocalAiProviderConfiguration {
  return {
    available: false,
    activeProvider: "openai",
    activeModel: "gpt-6-luna",
    openAiConfigured: false,
    anthropicConfigured: false,
    openAiModels: [],
    anthropicModels: [],
    codexModels: [],
  };
}

function settingsFilePath(): string {
  const configured = process.env.CHRONICA_LOCAL_AI_SETTINGS_FILE?.trim();
  return configured || join(process.cwd(), LOCAL_SETTINGS_FILE);
}
