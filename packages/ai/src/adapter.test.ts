import { describe, expect, it } from "vitest";
import { parseToolArguments } from "./adapter";
import { createMockAdapter } from "./adapters/mock";

// The adapter layer's own tool-call loop contract: one conversation step in,
// tool calls out, and nothing in between that could invent a call the model
// did not make or drop one it did. The Game Master tool registry this used to
// exercise against was removed along with the rest of the workflow-execution
// engine (see docs/plans/delete-chronicle-orders-turns.md).

describe("the mock adapter's tool loop", () => {
  it("replays scripted steps and stamps a distinct id on every call", async () => {
    const adapter = createMockAdapter("{}", {
      toolSteps: [
        { toolCalls: [{ name: "inspect_world", arguments: {} }, { name: "inspect_character", arguments: { characterId: "x" } }] },
        { content: "done" },
      ],
    });

    const first = await adapter.callWithTools("dialogue_principal", "system", [{ role: "user", content: "go" }], []);
    expect(first.stopReason).toBe("tool_calls");
    expect(first.toolCalls.map((call) => call.name)).toEqual(["inspect_world", "inspect_character"]);
    expect(new Set(first.toolCalls.map((call) => call.id)).size).toBe(2);

    const second = await adapter.callWithTools("dialogue_principal", "system", [{ role: "user", content: "go" }], []);
    expect(second.stopReason).toBe("stop");
    expect(second.toolCalls).toHaveLength(0);
    expect(second.content).toBe("done");
  });

  it("reports the conversation it was handed, including tool results", async () => {
    let seen: unknown;
    const adapter = createMockAdapter("{}", { onConversation: (messages) => { seen = messages; } });
    await adapter.callWithTools("dialogue_principal", "system", [
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "inspect_world", arguments: {} }] },
      { role: "tool_results", results: [{ callId: "c1", name: "inspect_world", content: "Step 1." }] },
    ], []);

    expect(Array.isArray(seen)).toBe(true);
    expect((seen as { role: string }[]).map((message) => message.role)).toEqual(["user", "assistant", "tool_results"]);
  });
});

describe("parseToolArguments", () => {
  it("never throws on whatever a provider sends", () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
    expect(parseToolArguments("not json at all")).toEqual({});
    // A non-object payload is not arguments; the session refuses it factually.
    expect(parseToolArguments("[1,2,3]")).toEqual({});
    expect(parseToolArguments("null")).toEqual({});
  });
});
