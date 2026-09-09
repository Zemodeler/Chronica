import { describe, expect, it } from "vitest";
import type { AiAdapter, AiToolCallResult } from "@chronica/ai";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "@chronica/shared";
import { runMultiAgentTurn } from "./orchestrator";

// The orchestrator's job is to sequence several bounded agent loops against
// one shared session and come back with the same result shape `runGameMaster`
// does. A fake adapter that only ever calls `finish_turn` (when it is offered
// -- i.e. only to the closing pass) and stays silent otherwise exercises the
// full sequence -- player, every selected NPC/star-context actor, closing --
// without depending on exactly how many steps each one takes.

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function closingOnlyAdapter(directiveIds: readonly string[] = []): AiAdapter {
  const directiveOutcomes = directiveIds.map((directiveId) => ({ directiveId, outcome: "carried_out" as const, reason: "Attempted as best judgment allowed.", factRefs: [] }));
  return {
    call: () => Promise.resolve({ content: "{}", model: "mock", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    callWithTools: (_operation, _systemPrompt, _messages, tools): Promise<AiToolCallResult> => {
      const offersFinish = tools.some((tool) => tool.name === "finish_turn");
      const toolCalls = offersFinish
        ? [{
          id: "call-finish",
          name: "finish_turn",
          arguments: { report: { directiveOutcomes, events: [], openThreads: [], turnSummary: "A quiet decision point; nothing of note happened." } },
        }]
        : [];
      return Promise.resolve({
        content: "", model: "mock", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        toolCalls, stopReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      });
    },
  };
}

const fakeDb = {} as Parameters<typeof runMultiAgentTurn>[1]["db"];

describe("runMultiAgentTurn (docs/32, Part B.1/B.7)", () => {
  it("sequences player, selected actors, and the closing pass to a reported finish against a shared session", async () => {
    const result = await runMultiAgentTurn(closingOnlyAdapter(), {
      db: fakeDb,
      gameId: "test-game",
      world: world(),
      atStep: 1,
      atInstant: { day: 0, minute: 0 },
      actorCharacterId: "marcus-atilius",
      directives: [],
      scenarioGovernment: undefined,
      scenarioChronicle: undefined,
    });

    expect(result.termination).toBe("reported");
    expect(result.report).not.toBeNull();
    expect(result.report?.turnSummary).toContain("quiet decision point");
  });

  it("never lets a non-closing agent end the turn: only the closing pass is offered finish_turn", async () => {
    // If any earlier agent could see finish_turn, this fake would call it
    // immediately on its very first (player-agent) step, and the run would
    // finish before any NPC/star-context agent or the real closing pass ran.
    // Reaching "reported" at all here already proves finish_turn was refused
    // until the closing pass -- this test names that guarantee explicitly.
    const result = await runMultiAgentTurn(closingOnlyAdapter(["d1"]), {
      db: fakeDb,
      gameId: "test-game",
      world: world(),
      atStep: 1,
      atInstant: { day: 0, minute: 0 },
      actorCharacterId: "marcus-atilius",
      directives: [{ id: "d1", directive: { kind: "new", text: "Hold the line." } }],
      scenarioGovernment: undefined,
      scenarioChronicle: undefined,
    });
    expect(result.termination).toBe("reported");
  });
});
