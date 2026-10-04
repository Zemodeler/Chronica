import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerGameRequest, gameEffortFor, gameInstructions, gameSchemaFor } from "../game-request";

type Sent = { messages: { role: string; content: string }[]; response_format?: unknown; reasoning_effort?: string };
type Chunk = { choices: { delta: { content: string }; finish_reason: string }[]; usage: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details: { cached_tokens: number } } };
const fake = vi.hoisted(() => ({ create: vi.fn<(request: Sent) => Promise<AsyncIterable<Chunk>>>(), replies: [] as string[] }));
vi.mock("openai", () => ({ default: class {
  chat = { completions: { create: fake.create } };
} }));

describe("API and CLI game request parity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CHRONICA_HAND_EFFORT", "low");
    vi.stubEnv("CHRONICA_LOCAL_AI_SETTINGS_FILE", "nonexistent-speed-test-settings.json");
    fake.replies = [];
    fake.create.mockReset().mockImplementation(() => Promise.resolve((async function* () {
      yield await Promise.resolve({ choices: [{ delta: { content: fake.replies.shift() ?? "{}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } } });
    })()));
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("sends the CLI's instructions, strict schema and effort for every core stage", async () => {
    const { createOpenAiLocalAdapter } = await import("./openai-local");
    const adapter = createOpenAiLocalAdapter();
    const system = 'Preserve actor secrets.\n{"$schema":"draft","type":"object","properties":{}}';
    const operations = ["simulate_orchestrate", "simulate_cognition", "compose_chronicle", "reconcile_facts"] as const;
    for (const operation of operations) {
      fake.replies.push("{}");
      await adapter.call(operation, system, "supplied world");
      const sent = fake.create.mock.lastCall![0];
      expect(sent.messages).toEqual([{ role: "system", content: gameInstructions(system, true) }, { role: "user", content: "supplied world" }]);
      expect(sent.response_format).toEqual({ type: "json_schema", json_schema: { name: operation, strict: true, schema: gameSchemaFor(operation) } });
      expect(sent.reasoning_effort).toBe(gameEffortFor(operation));
      expect(sent.reasoning_effort).toBe("low");
    }
  });

  it("uses the same correction prompt and restored answer as the CLI", async () => {
    const { createOpenAiLocalAdapter } = await import("./openai-local");
    fake.replies.push("broken", '{"withdraw":[],"rewrite":[]}');
    const api = await createOpenAiLocalAdapter().call("reconcile_facts", "system", "world");
    const asked: string[] = [];
    const replies = ["broken", '{"withdraw":[],"rewrite":[]}'];
    const cli = await answerGameRequest("reconcile_facts", "world", (next) => {
      asked.push(next);
      return Promise.resolve(replies.shift()!);
    });
    expect(api.content).toBe(cli);
    expect(fake.create.mock.calls.map(([request]) => request.messages[1]!.content)).toEqual(asked);
    expect(fake.create).toHaveBeenCalledTimes(2);
    expect(api.inputTokens).toBe(40);
    expect(api.outputTokens).toBe(10);
  });

  it("passes persistent malformed output to the simulation after one correction", async () => {
    const send = vi.fn().mockResolvedValue("broken");
    expect(await answerGameRequest("simulate_cognition", "world", send)).toBe("broken");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
