import "server-only";

import type { AiAdapter, AiConversationMessage, AiToolDefinition } from "@chronica/ai";
import type {
  GameMasterSessionResult,
  GameMasterToolCall,
  OrderDirective,
  ScenarioChronicleRules,
  ScenarioGovernmentRules,
  SelectedCharacter,
  WorldState,
} from "@chronica/shared";
import { FINISH_TURN_TOOL, createGameMasterSession } from "@chronica/shared";
import type { InventedWorkflowDefinition } from "@chronica/shared";
import { buildGameMasterOpeningMessage, buildGameMasterSystemPrompt } from "./game-master-prompt";
import type { ResolutionPlayerContext } from "./prompts";
import type { FormedNpcProposal } from "./character-agency";

// The Game Master loop (GM refactor, requirement 3).
//
// This owns the conversation; the adapter owns one provider round-trip and the
// session owns the staged world. Nothing else can move state. The loop is
// deliberately dull:
//
//   ask the model  ->  it names tools  ->  the session runs them against the
//   stage  ->  the exact factual results go back  ->  ask again
//
// It ends when the session accepts a turn report, or when a bound is hit. A
// bounded end is not a failure: the tools that already ran did real, validated
// work on the stage, and the caller commits that with a deterministic report
// instead of the model's.

export interface RunGameMasterInput {
  readonly world: WorldState;
  readonly atStep: number;
  readonly actorCharacterId: string;
  readonly directives: readonly { readonly id: string; readonly directive: OrderDirective }[];
  readonly selectedCharacters: readonly SelectedCharacter[];
  /** Concrete NPC workflow proposals already formed by character agency this turn, offered as context -- never executed here. */
  readonly npcProposals?: readonly FormedNpcProposal[];
  readonly playerContext: ResolutionPlayerContext | undefined;
  readonly scenarioGovernment: ScenarioGovernmentRules | undefined;
  readonly scenarioChronicle: ScenarioChronicleRules | undefined;
  /** Actions this campaign defined in earlier turns, usable without redefining. */
  readonly definedActions?: readonly InventedWorkflowDefinition[];
  readonly maxSteps?: number;
}

export interface RunGameMasterResult extends GameMasterSessionResult {
  /** Why the loop stopped. Only "reported" means the model finished on its own. */
  readonly termination: "reported" | "step_budget" | "tool_budget" | "model_stopped" | "provider_error";
  readonly modelSteps: number;
  readonly providerError: string | null;
}

const DEFAULT_MAX_STEPS = 12;

function tag(atStep: number): string {
  return `[game-master:step-${atStep}]`;
}

/**
 * A step where the model produced no tool call at all. Prose is not an action,
 * so the loop tells it so and gives it one chance to act; a second silent step
 * ends the turn with whatever the stage already holds.
 */
const NO_TOOL_CALL_NUDGE =
  "Nothing you wrote as text has any effect: only tool calls change the world or end the turn. "
  + `Call the tools you need, then call ${FINISH_TURN_TOOL}.`;

export async function runGameMaster(
  adapter: AiAdapter,
  input: RunGameMasterInput,
): Promise<RunGameMasterResult> {
  const session = createGameMasterSession({
    world: input.world,
    atStep: input.atStep,
    actorCharacterId: input.actorCharacterId,
    directiveIds: input.directives.map((entry) => entry.id),
    definedActions: input.definedActions ?? [],
  });

  const systemPrompt = buildGameMasterSystemPrompt({
    world: input.world,
    actorCharacterId: input.actorCharacterId,
    atStep: input.atStep,
    directives: input.directives,
    selectedCharacters: input.selectedCharacters,
    npcProposals: input.npcProposals ?? [],
    playerContext: input.playerContext,
    scenarioGovernment: input.scenarioGovernment,
    scenarioChronicle: input.scenarioChronicle,
  });
  const tools: AiToolDefinition[] = session.listTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const messages: AiConversationMessage[] = [
    { role: "user", content: buildGameMasterOpeningMessage(input.atStep) },
  ];

  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  let termination: RunGameMasterResult["termination"] = "step_budget";
  let providerError: string | null = null;
  let silentSteps = 0;
  let modelSteps = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    let response;
    try {
      response = await adapter.callWithTools("game_master", systemPrompt, messages, tools);
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
      termination = "provider_error";
      console.error(`${tag(input.atStep)} provider call failed:`, error);
      break;
    }
    modelSteps += 1;

    // `providerItems` carries the model's own reasoning forward to the next
    // step. Dropping it would make the agent re-derive its plan from scratch
    // after every tool result.
    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
      ...(response.providerItems === undefined ? {} : { providerItems: response.providerItems }),
    });

    if (response.toolCalls.length === 0) {
      silentSteps += 1;
      if (silentSteps >= 2) {
        termination = "model_stopped";
        break;
      }
      messages.push({ role: "user", content: NO_TOOL_CALL_NUDGE });
      continue;
    }
    silentSteps = 0;

    const results = response.toolCalls.map((toolCall) => {
      const call: GameMasterToolCall = { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments };
      const outcome = session.invoke(call);
      console.log(`${tag(input.atStep)} ${toolCall.name} -> ${outcome.ok ? "ok" : "refused"}`);
      return { callId: toolCall.id, name: toolCall.name, content: outcome.factual };
    });
    messages.push({ role: "tool_results", results });

    if (session.isFinished) {
      termination = "reported";
      break;
    }
    if (session.exhausted) {
      termination = "tool_budget";
      break;
    }
  }

  const result = session.result();
  console.log(
    `${tag(input.atStep)} finished: termination=${termination} modelSteps=${modelSteps} actions=${result.executedInvocations.length} reads=${result.readCallCount} capabilityRequests=${result.capabilityRequests.length}`,
  );
  return { ...result, termination, modelSteps, providerError };
}
