import "server-only";

import type { AiAdapter } from "@chronica/ai";
import type { DeclaredIntent, GameMasterSession, GameMasterToolDefinition, Principal } from "@chronica/shared";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";

// The intent interpreter.
//
// Non-player actors declare what they mean to do (`declare_intent`) and never
// call a workflow themselves. This pass reads every intent declared this turn
// and works out which validated actions, if any, each one amounts to.
//
// One pass for the whole turn rather than one per actor: interpretation is the
// same job whoever declared the intent, and doing it once means an interpreter
// that can see two actors reaching for the same force, the same office, or the
// same treasury in the same moment -- which is exactly where a faithful
// reading differs from a naive one.
//
// It is bound by an `{kind:"interpreter"}` principal, and `GameMasterSession`
// will only let it act for characters that actually declared something. It
// cannot invent an actor, and it cannot finish the turn.

/**
 * Everything the interpreter may do: read the world and take actions. It is
 * denied `finish_turn` (the closing pass owns that), every `plan` tool (those
 * belong to the player's own orders), `declare_intent` itself (it carries out
 * intents, it does not author them), and the narrative flags, which are the
 * turn's voice rather than an actor's deed.
 */
export function interpreterToolSurface(tools: readonly GameMasterToolDefinition[]): GameMasterToolDefinition[] {
  return tools.filter((tool) => tool.kind === "read" || tool.kind === "action" || tool.kind === "define" || tool.kind === "capability");
}

export interface RunIntentInterpreterInput {
  readonly adapter: AiAdapter;
  readonly session: GameMasterSession;
  readonly atStep: number;
  /** Bounds the loop. A reaction to one event gets a much smaller budget than a full turn. */
  readonly maxSteps?: number;
  readonly logTag?: string;
}

function renderIntents(intents: readonly DeclaredIntent[]): string {
  return intents
    .map((intent) => {
      const referenced = intent.referencedEntityIds.length > 0
        ? ` They named these as involved: ${intent.referencedEntityIds.join(", ")} (verify each; a named id may be wrong).`
        : "";
      return `[${intent.id}] ${intent.actorName} (${intent.actorId}) intends: ${intent.intent}\n  Their reason: ${intent.reason}${referenced}`;
    })
    .join("\n\n");
}

function buildSystemPrompt(intents: readonly DeclaredIntent[], atStep: number): string {
  return [
    "You carry out what the world's characters have decided to do. You are not one of them and you want nothing yourself.",
    `It is step ${atStep}. These characters have each decided on something:`,
    "",
    renderIntents(intents),
    "",
    "For each one, work out what it actually amounts to in this world and do it with the tools you have. Read first when an id, a location, or a holding is not already certain -- an intent names what a person believes, and people are wrong about their world.",
    // The failure this guards against is the interpreter quietly turning an
    // ambitious intent into whatever nearby thing happened to be callable.
    "Be faithful, not accommodating. Carry out what was intended, at the scale it was intended, against the target it named. If part of an intent is possible and part is not, do the possible part and leave the rest undone. If none of it is possible, leave it undone entirely -- do not substitute a smaller or different act the tools happen to support, and do not record something adjacent so that the turn has an outcome. A character who wanted something the world would not give them is an ordinary event, and reporting it as such is correct.",
    "A refusal from a tool is the world answering. Read what it says: correct a wrong id and try again, but never argue with a refusal about authority, resources, or eligibility by finding another route to the same effect. That authority is exactly what the character does not have.",
    "You may act only for the characters listed above, and only on what they said. Never act for anyone else, and never add an intention nobody declared.",
    "If an intent is real and no tool covers it, define one with define_action and use it -- but only when the act is genuinely outside the catalogue, not when an existing tool is merely inconvenient.",
    "When every intent has been carried out or honestly left undone, stop calling tools.",
  ].join("\n");
}

/**
 * Run the interpretation pass. Returns undefined when nothing was declared,
 * so the caller spends no model call on an empty turn.
 */
export async function runIntentInterpreter(input: RunIntentInterpreterInput): Promise<AgentLoopResult | undefined> {
  const intents = input.session.intents;
  if (intents.length === 0) return undefined;

  const tools = interpreterToolSurface(input.session.listTools());
  const principal: Principal = { kind: "interpreter" };

  return runAgentLoop({
    adapter: input.adapter,
    operation: "game_master",
    session: input.session,
    principal,
    systemPrompt: buildSystemPrompt(intents, input.atStep),
    openingMessage: `Carry out the ${intents.length} declared intent${intents.length === 1 ? "" : "s"}, as far as this world allows.`,
    tools,
    // Enough to read before acting on each intent, without letting one turn's
    // interpretation consume the session's whole budget.
    maxSteps: input.maxSteps ?? Math.min(4 + intents.length * 2, 20),
    logTag: input.logTag ?? `[interpreter:step-${input.atStep}]`,
  });
}
