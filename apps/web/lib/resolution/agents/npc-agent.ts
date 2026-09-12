import "server-only";

import type { AiAdapter } from "@chronica/ai";
import type { AuthorityIndex, Fact, GameMasterSession, GameMasterToolDefinition, NpcAgentContext, Principal, WorldInstant, WorldState } from "@chronica/shared";
import { buildNpcAgentContext } from "@chronica/shared";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";

// One NPC agent (docs/32, Part B.4): its own bounded tool-loop against the
// shared session, informed only by `buildNpcAgentContext`'s hard allowlist --
// own goals/beliefs/pressures/plots/commitments/relationships/authority, its
// own pending orders, and only the Facts visible to it. `finish_turn` is
// withheld -- ending the turn is the closing pass's job, not any actor's.
//
// An NPC does not call workflows. It reads, it decides, and it says what it
// means to do; `interpreter-agent.ts` afterwards works out which validated
// actions -- if any -- that intent amounts to, the same way it carries out
// the player's own directive-derived intent.
//
// This is what lets an NPC have the same reach as the player without handing
// it the player's tool belt. The old surface bounded an NPC by *category*
// (no treasury, no map, no world-authoring), which bounded the wrong thing:
// it stopped a governor from levying a tax his office plainly permits, while
// saying nothing about whether he should. Authority, not tool availability,
// is the right constraint on that, and the authority index already enforces
// it at execution. What an NPC may attempt is now the whole world; what it
// may *get* is whatever the session's own validation allows.
//
// Two backstops remain, neither of them prompt discipline:
//  1. Every call is bound to an `{kind:"npc", characterId}` principal,
//     enforced inside `GameMasterSession` -- a claimed `actorId` other than
//     its own character is refused before any lookup runs.
//  2. The surface below carries no mutating tool at all, so there is nothing
//     for a misbehaving agent to reach for in the first place.

/**
 * World tools an NPC may still call directly, because they are answers
 * rather than actions: someone put a question to this character and only
 * this character can answer it. Routing a reply through interpretation would
 * add a pass that decides nothing.
 */
const NPC_DIRECT_RESPONSE_TOOL_IDS = new Set(["record_response"]);

/**
 * The tool surface offered to one NPC agent: every read tool the base catalog
 * already scopes (`gm/read-tools.ts` -- never the unrestricted
 * `inspect_entity`/`inspect_context` world-tool readers, which return whole
 * entities with no actor-relative filtering), `declare_intent`, and the
 * replies above. Nothing here changes world state.
 */
export function npcToolSurface(tools: readonly GameMasterToolDefinition[]): GameMasterToolDefinition[] {
  return tools.filter((tool) => {
    if (tool.kind === "read") return tool.name !== "inspect_entity" && tool.name !== "inspect_context";
    if (tool.kind === "intent") return true;
    if (tool.kind === "plan") return tool.name === "respond_to_plan_assignment";
    if (tool.kind === "action") return NPC_DIRECT_RESPONSE_TOOL_IDS.has(tool.name);
    return false;
  });
}

export interface RunNpcAgentInput {
  readonly adapter: AiAdapter;
  readonly session: GameMasterSession;
  readonly world: WorldState;
  readonly atStep: number;
  readonly characterId: string;
  readonly authorityIndex: AuthorityIndex;
  readonly facts: readonly Fact[];
  readonly atInstant: WorldInstant;
  /** `SelectedCharacter.actionAllowance` -- this agent's own tool-call-budget bound (B.4). */
  readonly actionAllowance: number;
}

function summarize(context: NpcAgentContext): string {
  const lines: string[] = [
    `You are ${context.character.name} (${context.character.id}), a character in this world, acting entirely in your own interest.`,
    `Located in ${context.character.locationProvinceId}${context.character.polityId ? `, subject of polity ${context.character.polityId}` : ""}.`,
  ];
  if (context.goals.length > 0) lines.push(`Your goals: ${context.goals.map((g) => `${g.objective} (priority ${g.priority})`).join("; ")}.`);
  if (context.plots.length > 0) lines.push(`What you are plotting: ${context.plots.map((p) => `${p.objective} [${p.stage}]`).join("; ")}.`);
  if (context.pressures.length > 0) lines.push(`What weighs on you: ${context.pressures.map((p) => `${p.kind} (${p.intensity})`).join("; ")}.`);
  if (context.beliefs.length > 0) lines.push(`What you believe: ${context.beliefs.map((b) => b.claim).join("; ")}.`);
  if (context.commitments.length > 0) lines.push(`What you owe or are owed: ${context.commitments.map((c) => c.description).join("; ")}.`);
  if (context.ownAuthorityGrants.length > 0) {
    lines.push(`Your own standing authority: ${context.ownAuthorityGrants.map((g) => `${g.powers.join("/")} (${g.domain}) over ${g.scope.kind}:${g.scope.id} (${g.standing})`).join("; ")}.`);
  } else {
    lines.push("You hold no recorded standing authority over anyone or anything beyond yourself.");
  }
  if (context.pendingOrders.length > 0) {
    lines.push(`Orders awaiting your decision: ${context.pendingOrders.map((o) => `[${o.id}] from ${o.issuerRef.kind}:${o.issuerRef.id}, claimed authority ${o.authorityCheck.authorized ? "checks out" : "does not check out"}`).join("; ")}. Decide, in your own judgment, whether to comply, delay, or refuse each -- an order whose claimed authority does not check out is legal for you to comply with, but doing so is not the same as it being authorized.`);
  }
  if (context.visibleFacts.length > 0) {
    lines.push(`What has happened that you know of: ${context.visibleFacts.slice(0, 12).map((f) => f.summary).join(" | ")}`);
  }
  return lines.join("\n");
}

function buildSystemPrompt(context: NpcAgentContext, atStep: number, actionAllowance: number): string {
  return [
    summarize(context),
    `It is step ${atStep}.`,
    "You are not obliged to help the player, and nothing requires you to act at all -- a character with nothing pressing them may do nothing.",
    "Read what you need with the inspect tools, then say what you mean to do with declare_intent.",
    // The point of the separation, stated plainly, because an agent that
    // believes it is picking from a menu writes menu-shaped intentions.
    "Do not think in terms of what the game can do. Decide what this person would decide, and say it as they would: who you are acting on, where, with what, and why. What you intend is then carried out as far as the world genuinely allows -- possibly in full, possibly in part, possibly not at all. Wanting something you cannot have is a real thing to want.",
    `Declare at most ${actionAllowance} intent${actionAllowance === 1 ? "" : "s"}, and only for yourself.`,
    "When you have said what you mean to do, stop calling tools.",
  ].join("\n");
}

export async function runNpcAgent(input: RunNpcAgentInput): Promise<AgentLoopResult | undefined> {
  const context = buildNpcAgentContext(input.world, input.characterId, input.authorityIndex, input.facts, input.atInstant);
  if (context === undefined) return undefined;

  const tools = npcToolSurface(input.session.listTools());
  const principal: Principal = { kind: "npc", characterId: input.characterId };
  return runAgentLoop({
    adapter: input.adapter,
    operation: "game_master",
    session: input.session,
    principal,
    systemPrompt: buildSystemPrompt(context, input.atStep, input.actionAllowance),
    openingMessage: `You are ${context.character.name}. Decide what you mean to do at this point, or decide there is nothing for you to do.`,
    tools,
    maxSteps: Math.max(2, input.actionAllowance),
    logTag: `[npc-agent:${input.characterId}:step-${input.atStep}]`,
  });
}
