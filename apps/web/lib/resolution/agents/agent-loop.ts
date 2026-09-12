import "server-only";

import type { AiAdapter, AiConversationMessage, AiToolDefinition } from "@chronica/ai";
import type { GameMasterSession, GameMasterToolCall, GameMasterToolDefinition, Principal } from "@chronica/shared";

// The multi-agent dispatcher keeps one canonical mutator -- `GameMasterSession`
// -- but drives it from several separate, sequential LLM conversations
// instead of one. This is the one loop shape every agent type (NPC,
// star-context, the intent interpreter, closing) reuses: (a) it accepts an
// already-created, shared session rather than owning one, and (b) it accepts
// an explicit tool subset, so a sub-agent can never even name a tool outside
// its own bounded surface (most importantly, `finish_turn` -- reserved for
// the closing pass).

export interface AgentLoopInput {
  readonly adapter: AiAdapter;
  readonly operation: Parameters<AiAdapter["callWithTools"]>[0];
  readonly session: GameMasterSession;
  /**
   * Who this loop's tool calls are actually made as -- bound once here by
   * the orchestrator and enforced inside `GameMasterSession`, never trusted
   * from a model-supplied `actorId` argument (docs/32 corrective pass,
   * requirement 1).
   */
  readonly principal: Principal;
  readonly systemPrompt: string;
  readonly openingMessage: string;
  /** The exact tool surface offered this step -- a subset of `session.listTools()`. */
  readonly tools: readonly GameMasterToolDefinition[];
  readonly maxSteps: number;
  readonly logTag: string;
}

export interface AgentLoopResult {
  readonly termination: "step_budget" | "tool_budget" | "model_stopped" | "provider_error" | "session_finished";
  readonly modelSteps: number;
  readonly toolCallsMade: number;
  readonly providerError: string | null;
}

const NO_TOOL_CALL_NUDGE =
  "Nothing you wrote as text has any effect: only tool calls change the world. Call the tools you need, "
  + "or, if there is genuinely nothing more for you to do this turn, stop calling tools.";

/** One bounded tool-using conversation against a shared, already-staged session. Never creates or finishes the session itself. */
export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const { adapter, operation, session, tools, maxSteps, logTag } = input;
  const allowedNames = new Set(tools.map((tool) => tool.name));
  const toolDefinitions: AiToolDefinition[] = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));

  const messages: AiConversationMessage[] = [{ role: "user", content: input.openingMessage }];
  let termination: AgentLoopResult["termination"] = "step_budget";
  let providerError: string | null = null;
  let silentSteps = 0;
  let modelSteps = 0;
  let toolCallsMade = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    if (session.isFinished) { termination = "session_finished"; break; }
    if (session.exhausted) { termination = "tool_budget"; break; }

    let response;
    try {
      response = await adapter.callWithTools(operation, input.systemPrompt, messages, toolDefinitions);
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
      termination = "provider_error";
      console.error(`${logTag} provider call failed:`, error);
      break;
    }
    modelSteps += 1;

    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
      ...(response.providerItems === undefined ? {} : { providerItems: response.providerItems }),
    });

    if (response.toolCalls.length === 0) {
      silentSteps += 1;
      if (silentSteps >= 2) { termination = "model_stopped"; break; }
      messages.push({ role: "user", content: NO_TOOL_CALL_NUDGE });
      continue;
    }
    silentSteps = 0;

    const results = response.toolCalls.map((toolCall) => {
      if (!allowedNames.has(toolCall.name)) {
        return { callId: toolCall.id, name: toolCall.name, content: `"${toolCall.name}" is not available to you. Use only the tools you were given.` };
      }
      toolCallsMade += 1;
      const call: GameMasterToolCall = { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments };
      const outcome = session.invoke(call, input.principal);
      console.log(`${logTag} ${toolCall.name} -> ${outcome.ok ? "accepted" : "refused"}`);
      return { callId: toolCall.id, name: toolCall.name, content: outcome.factual };
    });
    messages.push({ role: "tool_results", results });

    if (session.isFinished) { termination = "session_finished"; break; }
    if (session.exhausted) { termination = "tool_budget"; break; }
  }

  return { termination, modelSteps, toolCallsMade, providerError };
}
