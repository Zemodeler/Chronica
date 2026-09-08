import "server-only";

import type { AiAdapter, AiConversationMessage, AiToolDefinition } from "@chronica/ai";
import type {
  GameMasterSessionResult,
  GameMasterToolCall,
  GameMasterToolOutcome,
  OrderDirective,
  ScenarioChronicleRules,
  ScenarioClock,
  ScenarioGovernmentRules,
  ScenarioLifeRules,
  SelectedCharacter,
  WorldState,
} from "@chronica/shared";
import { FINISH_TURN_TOOL, createGameMasterSession } from "@chronica/shared";
import type { InventedWorkflowDefinition } from "@chronica/shared";
import { buildGameMasterOpeningMessage, buildGameMasterSystemPrompt } from "./game-master-prompt";
import type { ResolutionPlayerContext } from "./prompts";

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
  readonly playerContext: ResolutionPlayerContext | undefined;
  readonly scenarioGovernment: ScenarioGovernmentRules | undefined;
  readonly scenarioChronicle: ScenarioChronicleRules | undefined;
  /** Scenario life/clock rules, so the Game Master's own life-review read tool can report age/rate facts. */
  readonly scenarioLife?: ScenarioLifeRules | undefined;
  readonly scenarioClock?: ScenarioClock | undefined;
  /** Actions this campaign defined in earlier turns, usable without redefining. */
  readonly definedActions?: readonly InventedWorkflowDefinition[];
  /** Off by default (docs/27) -- see `GameMasterSessionOptions.allowInventedActions`. */
  readonly allowInventedActions?: boolean;
  readonly maxSteps?: number;
  readonly persistentPlans?: boolean;
}

export interface RunGameMasterResult extends GameMasterSessionResult {
  /** Why the loop stopped. Only "reported" means the model finished on its own. */
  readonly termination: "reported" | "step_budget" | "tool_budget" | "model_stopped" | "provider_error";
  readonly modelSteps: number;
  readonly providerError: string | null;
}

// A living world needs room for the player's order, foreign reactions, and a
// domestic development.  Twelve model steps routinely ended after the first
// reaction, leaving the newly required activity budget unreachable.
const DEFAULT_MAX_STEPS = 18;

function tag(atStep: number): string {
  return `[game-master:step-${atStep}]`;
}

/** Keep each tool outcome on one log line while preserving the engine's reason. */
function logToolOutcome(atStep: number, toolName: string, outcome: GameMasterToolOutcome): void {
  const reason = outcome.factual.replace(/\s+/g, " ").trim()
    || (outcome.ok ? "The session accepted the call." : "The session did not provide a refusal reason.");
  console.log(`${tag(atStep)} ${toolName} -> ${outcome.ok ? "accepted" : "refused"} reason=${JSON.stringify(reason)}`);
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
  const planningAllowance = input.persistentPlans ? Math.min(32, (input.world.playerPlans ?? []).filter(p => p.ownerId === input.actorCharacterId && p.status === "active").length + input.directives.filter(d => d.directive.kind === "new").length) : 0;
  const session = createGameMasterSession({
    world: input.world,
    atStep: input.atStep,
    actorCharacterId: input.actorCharacterId,
    directiveIds: input.directives.map((entry) => entry.id),
    ...(input.persistentPlans ? { directives: input.directives } : {}),
    definedActions: input.definedActions ?? [],
    allowInventedActions: input.allowInventedActions ?? false,
    scenarioLife: input.scenarioLife,
    scenarioClock: input.scenarioClock,
    // Reads, reports, and the player’s own orders are not NPC actions. Keep
    // room for them while scaling the tool loop with the relevance-derived
    // agency available this turn.
    maxToolCalls: Math.max(60, input.selectedCharacters.reduce((sum, character) => sum + character.actionAllowance, 0) + 24) + planningAllowance * 2,
  });

  const systemPrompt = buildGameMasterSystemPrompt({
    world: session.stagedWorld,
    actorCharacterId: input.actorCharacterId,
    atStep: input.atStep,
    directives: input.directives,
    selectedCharacters: input.selectedCharacters,
    playerContext: input.playerContext,
    scenarioGovernment: input.scenarioGovernment,
    scenarioChronicle: input.scenarioChronicle,
    allowInventedActions: input.allowInventedActions ?? false,
  });
  const tools: AiToolDefinition[] = session.listTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const messages: AiConversationMessage[] = [
    { role: "user", content: buildGameMasterOpeningMessage(input.atStep) },
  ];

  const maxSteps = input.maxSteps ?? Math.max(
    DEFAULT_MAX_STEPS + planningAllowance,
    input.selectedCharacters.reduce((sum, character) => sum + character.actionAllowance, 0) + 2 + planningAllowance,
  );
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
      logToolOutcome(input.atStep, toolCall.name, outcome);
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
