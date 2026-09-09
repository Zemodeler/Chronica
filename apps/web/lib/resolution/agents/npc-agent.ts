import "server-only";

import type { AiAdapter } from "@chronica/ai";
import type { AuthorityIndex, Fact, GameMasterSession, GameMasterToolDefinition, NpcAgentContext, Principal, WorldInstant, WorldState } from "@chronica/shared";
import { buildNpcAgentContext, WORKFLOW_REGISTRY } from "@chronica/shared";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";

// One NPC agent (docs/32, Part B.4): its own bounded tool-loop against the
// shared session, informed only by `buildNpcAgentContext`'s hard allowlist --
// own goals/beliefs/pressures/plots/commitments/relationships/authority, its
// own pending orders, and only the Facts visible to it. `finish_turn` is
// withheld, same reasoning as the player agent.
//
// Two independent backstops keep this agent inside its own identity and a
// scoped tool surface, neither of them prompt discipline (docs/32 corrective
// pass, requirement 1):
//  1. Every tool call this agent makes is bound to an `{kind:"npc",
//     characterId}` principal, enforced inside `GameMasterSession` itself --
//     a claimed `actorId` other than its own character is refused before any
//     lookup or authority check runs, regardless of what this prompt says.
//  2. `npcToolSurface` below narrows *which* tools this agent is even
//     offered: every well-scoped read tool, but only the personal/order
//     action tools and registered workflows whose category cannot move a
//     treasury, found a settlement, or author new world entities -- an NPC
//     reasons and acts entirely in its own name, never across the whole
//     world's ledger.

/** Registered-workflow categories an NPC agent may act through -- deliberately excludes "economic"/"material"/"map" (treasury, world-authoring). */
const NPC_ACTION_CATEGORIES = new Set(["character", "military", "political", "narrative"]);
/** World-tool ids an NPC agent may call -- its own orders/commitments, never force-raising, settlement-founding, or grant-authoring. */
const NPC_WORLD_TOOL_IDS = new Set(["issue_order", "record_response", "record_fact", "create_commitment"]);

/**
 * The tool surface offered to one NPC agent: every read tool the base
 * catalog already scopes (`gm/read-tools.ts` -- never the unrestricted
 * `inspect_entity`/`inspect_context` world-tool readers, which return whole
 * entities/institutions with no actor-relative filtering), plus a curated
 * action surface. `finish_turn` is never offered here (`kind !== "finish"`
 * on top of the allowlist below would be redundant, but is kept for
 * defense-in-depth against a future tool being added with the wrong kind).
 */
export function npcToolSurface(tools: readonly GameMasterToolDefinition[]): GameMasterToolDefinition[] {
  return tools.filter((tool) => {
    if (tool.kind === "finish") return false;
    if (tool.kind === "read") return tool.name !== "inspect_entity" && tool.name !== "inspect_context";
    if (tool.kind === "plan") return tool.name === "respond_to_plan_assignment";
    if (tool.kind !== "action") return false;
    // A registered workflow (curated or auto-wrapped into the world-tool
    // catalog under the same id) is scoped by its own category; a pure
    // world tool with no registry entry (issue_order/record_response/
    // record_fact/create_commitment, or a world-authoring tool like
    // create_force/create_entity) is scoped by an explicit id allowlist.
    const category = WORKFLOW_REGISTRY.get(tool.name)?.category;
    return category !== undefined ? NPC_ACTION_CATEGORIES.has(category) : NPC_WORLD_TOOL_IDS.has(tool.name);
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

function buildSystemPrompt(context: NpcAgentContext, atStep: number): string {
  return [
    summarize(context),
    `It is step ${atStep}.`,
    "You are not obliged to help the player, and nothing requires you to act at all -- a character with nothing pressing them may do nothing.",
    "Read what you need with the inspect tools. Act only through the tools you were given; nothing else has any effect.",
    "When you have done what you judge worth doing this turn, stop calling tools.",
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
    systemPrompt: buildSystemPrompt(context, input.atStep),
    openingMessage: `Act as ${context.character.name} for this decision point, or decide there is nothing for you to do.`,
    tools,
    maxSteps: Math.max(2, input.actionAllowance),
    logTag: `[npc-agent:${input.characterId}:step-${input.atStep}]`,
  });
}
