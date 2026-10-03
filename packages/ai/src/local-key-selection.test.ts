import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Compile the factory's workspace dependency graph during collection, outside hook deadlines.
import "./index";

describe("developer AI selection", () => {
  let settings: string;
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const dir = mkdtempSync(path.join(tmpdir(), "local-ai-"));
    settings = path.join(dir, "settings.json");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CHRONICA_LOCAL_AI_SETTINGS_FILE", settings);
    vi.stubEnv("CHRONICA_HAND_DIR", path.join(dir, "answers"));
    vi.stubEnv("CHRONICA_AI_MODE", "openai");
    vi.stubEnv("CHRONICA_HAND_RESPONDER", "codex");
    vi.stubEnv("CHRONICA_HAND_MODEL", "");
    vi.stubEnv("CHRONICA_LOCAL_CODEX_MODELS", "");
    vi.stubEnv("CHRONICA_LOCAL_OPENAI_MODELS", "");
    vi.stubEnv("OPENAI_API_KEY", "test-openai");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic");
    const responder = await import("./adapters/hand-codex");
    vi.spyOn(responder, "answerWithHandCodex").mockResolvedValue('{"actors":[]}');
    // Keep cold compilation of the factory's workspace dependencies out of the request test.
    await import("./index");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("offers Codex without API keys and persists GPT-6 Luna without credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const api = await import("./local-key-selection");
    expect(api.getLocalAiProviderConfiguration()).toMatchObject({ available: true, codexModels: expect.arrayContaining(["gpt-6-luna"]) });
    api.selectLocalAiConfiguration("codex", "gpt-6-luna");
    expect(api.getLocalAiProviderConfiguration()).toMatchObject({ activeProvider: "codex", activeModel: "gpt-6-luna" });
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({ activeProvider: "codex", activeModel: "gpt-6-luna" });
  });

  it("routes Codex through the free hand adapter, captures its model, and switches back to the API", async () => {
    const api = await import("./index");
    const responder = await import("./adapters/hand-codex");
    api.selectLocalAiConfiguration("codex", "gpt-6-sol");
    const adapter = api.createAiAdapter();
    expect(adapter.free).toBe(true);
    api.selectLocalAiConfiguration("openai", "gpt-6-luna");
    await expect(adapter.call("simulate_cognition", "S", "R")).resolves.toMatchObject({ model: "hand", inputTokens: 0 });
    expect(responder.answerWithHandCodex).toHaveBeenCalledWith("S", "R", expect.any(String), "gpt-6-sol");
    expect(api.createAiAdapter().free).not.toBe(true);
  });

  it("keeps the browser picker visible in hand mode and lets a saved API choice override that startup default", async () => {
    vi.stubEnv("CHRONICA_AI_MODE", "hand");
    const api = await import("./index");
    expect(api.getLocalAiProviderConfiguration()).toMatchObject({ available: true, activeProvider: "codex", activeModel: "gpt-6-luna" });
    api.selectLocalAiConfiguration("anthropic", "claude-haiku-4-5");
    expect(api.getSelectedLocalAiProvider()).toBe("anthropic");
    expect(api.createAiAdapter().free).not.toBe(true);
  });

  it("rejects unavailable models, unconfigured API providers, production, and mock mode", async () => {
    const api = await import("./local-key-selection");
    expect(() => api.selectLocalAiConfiguration("codex", "gpt-5-nano")).toThrow();
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => api.selectLocalAiConfiguration("openai", "gpt-6-luna")).toThrow();
    vi.stubEnv("NODE_ENV", "production");
    expect(api.getLocalAiProviderConfiguration().available).toBe(false);
    expect(() => api.selectLocalAiConfiguration("codex", "gpt-6-luna")).toThrow();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CHRONICA_AI_MODE", "mock");
    expect(api.getSelectedLocalAiProvider()).toBeNull();
    expect(() => api.selectLocalAiConfiguration("codex", "gpt-6-luna")).toThrow();
    expect(existsSync(settings)).toBe(false);
  });
});
