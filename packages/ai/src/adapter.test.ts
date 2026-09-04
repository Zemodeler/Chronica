import { describe, expect, it } from "vitest";
import { AiOperationSchema, buildGameMasterTools } from "@chronica/shared";
import { parseToolArguments } from "./adapter";
import { createMockAdapter } from "./adapters/mock";

// The adapter layer's contract for the Game Master: one conversation step in,
// tool calls out, and nothing in between that could invent a call the model
// did not make or drop one it did.

describe("the game_master operation", () => {
  it("is a first-class routed operation", () => {
    expect(AiOperationSchema.options).toContain("game_master");
    expect(AiOperationSchema.safeParse("game_master").success).toBe(true);
  });

  it("keeps every retired director operation parseable, so archived rows still read", () => {
    for (const retired of ["assess_orders", "adjudicate", "reaction_director", "simulator", "character_director", "world_director", "workflow_manager"]) {
      expect(AiOperationSchema.safeParse(retired).success).toBe(true);
    }
  });
});

describe("tool definitions handed to a provider", () => {
  const tools = buildGameMasterTools();

  it("carry a JSON Schema object with a name and a description for every tool", () => {
    expect(tools.length).toBeGreaterThan(20);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters["type"]).toBe("object");
    }
  });

  it("require an explicit actor on every action tool", () => {
    const action = tools.find((tool) => tool.name === "create_force");
    expect(action).toBeDefined();
    const required = action!.parameters["required"] as string[];
    expect(required).toContain("actorId");
    expect(required).toContain("polityId");
    expect(action!.parameters["additionalProperties"]).toBe(false);
  });

  it("carry no keyword a provider's function-call validator will choke on", () => {
    const seen = new Set<string>();
    const walk = (node: unknown) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) { seen.add(key); walk(value); }
      }
    };
    for (const tool of tools) walk(tool.parameters);

    // Zod emits both; neither means anything to a tool definition, and a
    // provider that validates strictly rejects the whole call over them.
    expect(seen.has("$schema")).toBe(false);
    expect(seen.has("propertyNames")).toBe(false);
  });

  it("keeps a record-typed parameter after that stripping", () => {
    const sponsor = tools.find((tool) => tool.name === "sponsor_procedure");
    expect(Object.keys(sponsor!.parameters["properties"] as Record<string, unknown>)).toContain("linkedWorkflowParams");
  });

  it("take no actor on a read tool, which cannot act for anyone", () => {
    const read = tools.find((tool) => tool.name === "inspect_province");
    expect(read).toBeDefined();
    const properties = read!.parameters["properties"] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(["provinceId"]);
  });
});

describe("the mock adapter's tool loop", () => {
  it("replays scripted steps and stamps a distinct id on every call", async () => {
    const adapter = createMockAdapter("{}", {
      toolSteps: [
        { toolCalls: [{ name: "inspect_world", arguments: {} }, { name: "inspect_character", arguments: { characterId: "x" } }] },
        { content: "done" },
      ],
    });

    const first = await adapter.callWithTools("game_master", "system", [{ role: "user", content: "go" }], []);
    expect(first.stopReason).toBe("tool_calls");
    expect(first.toolCalls.map((call) => call.name)).toEqual(["inspect_world", "inspect_character"]);
    expect(new Set(first.toolCalls.map((call) => call.id)).size).toBe(2);

    const second = await adapter.callWithTools("game_master", "system", [{ role: "user", content: "go" }], []);
    expect(second.stopReason).toBe("stop");
    expect(second.toolCalls).toHaveLength(0);
    expect(second.content).toBe("done");
  });

  it("reports the conversation it was handed, including tool results", async () => {
    let seen: unknown;
    const adapter = createMockAdapter("{}", { onConversation: (messages) => { seen = messages; } });
    await adapter.callWithTools("game_master", "system", [
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
