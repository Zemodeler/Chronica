import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHandAdapter, handStem } from "./hand";

/** A model that is a person answering from files, so a game can be played with nothing spent. */
describe("the hand adapter", () => {
  it("writes the prompt, waits for its answer, and hands it back as the model's reply", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hand-"));
    const waiting: string[] = [];
    const adapter = createHandAdapter({ dir, pollMs: 10, onWaiting: (at) => waiting.push(at) });
    const reply = adapter.call("simulate_cognition", "SYSTEM", "## Hieron II [hieron-ii]");
    const stem = handStem("simulate_cognition", "## Hieron II [hieron-ii]");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(readFileSync(path.join(dir, `${stem}.prompt.txt`), "utf8")).toBe("## Hieron II [hieron-ii]");
    expect(readFileSync(path.join(dir, "system-simulate_cognition.txt"), "utf8")).toBe("SYSTEM");
    expect(waiting).toEqual([path.join(dir, `${stem}.prompt.txt`)]);
    writeFileSync(path.join(dir, `${stem}.json`), '{"actors": []}');
    const result = await reply;
    expect(result.content).toBe('{"actors": []}');
    expect(result.inputTokens + result.outputTokens).toBe(0);
    expect(adapter.free).toBe(true);
  });

  it("answers a prompt it has seen before from disk, without waiting", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hand-"));
    writeFileSync(path.join(dir, `${handStem("compose_chronicle", "the same")}.json`), '{"entries": []}');
    const adapter = createHandAdapter({ dir, pollMs: 10, timeoutMs: 50 });
    await expect(adapter.call("compose_chronicle", "S", "the same")).resolves.toMatchObject({ content: '{"entries": []}' });
    expect(existsSync(path.join(dir, "queue.log"))).toBe(false);
  });

  it("does not hand on an answer caught half-written", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hand-"));
    const adapter = createHandAdapter({ dir, pollMs: 10 });
    const stem = handStem("reconcile_facts", "x");
    const reply = adapter.call("reconcile_facts", "S", "x");
    writeFileSync(path.join(dir, `${stem}.json`), '{"facts": [');
    await new Promise((resolve) => setTimeout(resolve, 40));
    writeFileSync(path.join(dir, `${stem}.json`), '{"facts": []}');
    await expect(reply).resolves.toMatchObject({ content: '{"facts": []}' });
  });

  it("returns a tool step's calls with their arguments", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hand-"));
    const adapter = createHandAdapter({ dir, pollMs: 10 });
    const messages = [{ role: "user" as const, content: "Look at the world." }];
    const tools = [{ name: "inspect", description: "Look", parameters: {} }];
    const asked = JSON.stringify({ tools: tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), messages }, null, 2);
    writeFileSync(path.join(dir, `${handStem("simulate_orchestrate", asked)}.json`), '{"content": "", "toolCalls": [{"name": "inspect", "arguments": {"id": "rome"}}]}');
    const step = await adapter.callWithTools("simulate_orchestrate", "S", messages, tools);
    expect(step.toolCalls).toEqual([{ id: "hand-call-1", name: "inspect", arguments: { id: "rome" } }]);
    expect(step.stopReason).toBe("tool_calls");
  });
});
