import "server-only";

import type { AiAdapter } from "@chronica/ai";
import type { GameMasterSession, OrderDirective, Principal } from "@chronica/shared";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";

// The player-reasoning agent (docs/32, Part B.3): the first, always-run,
// uncounted-against-budget agent of the turn. It sees only the player's own
// directives and authority standing, and attempts them with the same
// full workflow surface any actor gets -- it is not a classifier bolted onto
// the old GM prompt, it is a separate LLM conversation against the shared
// session. `finish_turn` is withheld: ending the turn is the closing pass's
// job (B.1), not this agent's.

export interface RunPlayerAgentInput {
  readonly adapter: AiAdapter;
  readonly session: GameMasterSession;
  readonly atStep: number;
  readonly actorCharacterId: string;
  readonly directives: readonly { readonly id: string; readonly directive: OrderDirective }[];
  readonly maxSteps?: number;
}

function directiveLine(entry: { readonly id: string; readonly directive: OrderDirective }): string {
  const { directive } = entry;
  if (directive.kind === "new") return `- [${entry.id}] ${directive.text}`;
  if (directive.kind === "revise") return `- [${entry.id}] revise ${directive.actionId}: ${directive.text}`;
  return `- [${entry.id}] cancel ${directive.actionId}`;
}

function buildSystemPrompt(input: RunPlayerAgentInput): string {
  return [
    "You are the player-reasoning agent for one turn of a historical life-simulation game.",
    `You act only as character ${input.actorCharacterId}, at step ${input.atStep}.`,
    "Your only job is to attempt the player's own directives, in their own words, as faithfully as you can.",
    "An omitted detail (a workflow name, a troop count, an account id) is yours to infer or handle with a narrow follow-up read -- never a reason to drop a directive.",
    "Only stop short of attempting a directive when it is genuinely, consequentially ambiguous (which of two named targets, an amount that changes the outcome's character) -- in that case attempt what you safely can and describe the gap in a record_entity_note.",
    "Read what you need with the inspect tools before acting. Use the action tool that matches each directive. You do not end the turn: when you have attempted every directive you reasonably can, stop calling tools.",
  ].join("\n");
}

function buildOpeningMessage(input: RunPlayerAgentInput): string {
  if (input.directives.length === 0) return "The player submitted no directives this turn. Confirm there is nothing standing to attend to, then stop.";
  return ["The player's directives this turn:", ...input.directives.map(directiveLine)].join("\n");
}

export async function runPlayerAgent(input: RunPlayerAgentInput): Promise<AgentLoopResult> {
  const tools = input.session.listTools().filter((tool) => tool.kind !== "finish");
  const principal: Principal = { kind: "player", characterId: input.actorCharacterId };
  return runAgentLoop({
    adapter: input.adapter,
    operation: "game_master",
    session: input.session,
    principal,
    systemPrompt: buildSystemPrompt(input),
    openingMessage: buildOpeningMessage(input),
    tools,
    maxSteps: input.maxSteps ?? Math.max(6, input.directives.length * 3),
    logTag: `[player-agent:step-${input.atStep}]`,
  });
}
