import "server-only";

import type { AiAdapter } from "@chronica/ai";
import type { GameMasterSession, Principal } from "@chronica/shared";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";

const CLOSING_PRINCIPAL: Principal = { kind: "closing" };

// The turn's small deterministic closing pass (docs/32, Part B.1): after the
// player-reasoning agent and every selected NPC/star-context agent have run
// against the shared session, one last bounded conversation reads what the
// stage now holds and reports it. This is the only agent offered
// `finish_turn` -- ending the turn is reserved to this step so no earlier
// agent's tool loop can end it prematurely on the rest of the turn's behalf.

export interface RunClosingAgentInput {
  readonly adapter: AiAdapter;
  readonly session: GameMasterSession;
  readonly atStep: number;
  readonly maxSteps?: number;
}

const SYSTEM_PROMPT = [
  "You are the closing pass for this turn. Every actor who had something to do has already acted through earlier tool calls this turn.",
  "Before reporting, call list_due_life_reviews and list_due_political_procedures -- if either lists anything, that is a gap only you can close now.",
  "Your only job is to read back what actually happened and submit the structured turn report. You cannot create or change anything except through the report's own bookkeeping.",
  "Every event you report must cite a factRef returned by an earlier tool result. When the report is complete and accurate, call finish_turn.",
].join("\n");

export async function runClosingAgent(input: RunClosingAgentInput): Promise<AgentLoopResult> {
  const tools = input.session.listTools().filter((tool) => tool.kind === "read" || tool.kind === "finish");
  return runAgentLoop({
    adapter: input.adapter,
    operation: "game_master",
    session: input.session,
    principal: CLOSING_PRINCIPAL,
    systemPrompt: SYSTEM_PROMPT,
    openingMessage: `Step ${input.atStep} is otherwise complete. Read back what happened and submit the turn report.`,
    tools,
    maxSteps: input.maxSteps ?? 6,
    logTag: `[closing-agent:step-${input.atStep}]`,
  });
}
