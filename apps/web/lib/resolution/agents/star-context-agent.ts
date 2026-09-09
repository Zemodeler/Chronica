import "server-only";

import type { AiAdapter } from "@chronica/ai";
import type { AuthorityIndex, Fact, GameMasterSession, Principal, StarContext, StarContextPayload, WorldInstant, WorldState } from "@chronica/shared";
import { RECORD_ENTITY_NOTE_TOOL, buildStarContextPayload, factsVisibleTo } from "@chronica/shared";
import { runAgentLoop, type AgentLoopResult } from "./agent-loop";
import { npcToolSurface } from "./npc-agent";

// A star-context agent (docs/32, Part B.2/B.4) speaks for a scope that has no
// single relevant living character -- a theatre, a distant polity, a region --
// using only institutional records (`buildStarContextPayload`) plus Facts
// discovered at this scope, never a private character's goals/beliefs/plots.
// When the scope already has a live representative character, this collapses
// to acting through them with the same tool surface an NPC agent gets; when
// it does not, the agent is read-only plus narration -- there is no character
// to attribute an action to, so none is offered.

export interface RunStarContextAgentInput {
  readonly adapter: AiAdapter;
  readonly session: GameMasterSession;
  readonly world: WorldState;
  readonly atStep: number;
  readonly context: StarContext;
  readonly authorityIndex: AuthorityIndex;
  readonly facts: readonly Fact[];
  readonly atInstant: WorldInstant;
  readonly maxSteps?: number;
}

function summarizePayload(context: StarContext, payload: StarContextPayload, visibleFacts: readonly Fact[]): string {
  const lines: string[] = [`You speak for ${context.label} (${context.level} scope: ${context.scopeRef.kind}:${context.scopeRef.id}).`];
  if (payload.forces.length > 0) {
    lines.push(`Forces in scope: ${payload.forces.map((f) => `${f.name} (${f.id}), commanded by ${f.commanderCharacterId ?? "no one"}, morale ${f.moraleBps}`).join("; ")}.`);
  }
  if (payload.openProcedures.length > 0) {
    lines.push(`Open political procedures: ${payload.openProcedures.map((p) => `${p.type} [${p.stage}]`).join("; ")}.`);
  }
  if (payload.activeWarPolityPairs.length > 0) {
    lines.push(`Active wars touching this scope: ${payload.activeWarPolityPairs.map((w) => `${w.polityAId} vs ${w.polityBId}`).join("; ")}.`);
  }
  if (payload.activeSiegeSettlementIds.length > 0) {
    lines.push(`Settlements under siege: ${payload.activeSiegeSettlementIds.join(", ")}.`);
  }
  if (visibleFacts.length > 0) {
    lines.push(`What has happened at or affecting this scope: ${visibleFacts.slice(0, 12).map((f) => f.summary).join(" | ")}`);
  }
  return lines.join("\n");
}

export async function runStarContextAgent(input: RunStarContextAgentInput): Promise<AgentLoopResult> {
  const payload = buildStarContextPayload(input.world, input.context);
  const visibleFacts = factsVisibleTo(input.facts, input.context.scopeRef, input.atInstant);
  const representativeId = input.context.representativeCharacterId;

  const allTools = input.session.listTools();
  // Acting through a living representative gets the same scoped surface an
  // NPC agent gets (own-identity action tools only, never treasury/world-
  // authoring); with no representative, this context can only read and
  // record a note -- there is no character to bind a mutating principal to.
  const tools = representativeId !== null
    ? npcToolSurface(allTools)
    : allTools.filter((tool) => tool.kind === "read" || tool.name === RECORD_ENTITY_NOTE_TOOL);
  const principal: Principal = { kind: "star_context", representativeCharacterId: representativeId, scopeRef: input.context.scopeRef };

  const systemPrompt = [
    summarizePayload(input.context, payload, visibleFacts),
    representativeId !== null
      ? `You act through ${representativeId}, its living representative, at step ${input.atStep}.`
      : `This scope currently has no living representative -- you may read and record what continues here, but nothing here can act (no character to attribute an action to).`,
    "This is background continuation, not the player's own theatre: resolve it plausibly and economically, without inventing detail beyond what a distant, mostly self-running process would produce.",
    "When you have done what is warranted, stop calling tools.",
  ].join("\n");

  return runAgentLoop({
    adapter: input.adapter,
    operation: "game_master",
    session: input.session,
    principal,
    systemPrompt,
    openingMessage: `Continue ${input.context.label} for this decision point, or record that nothing of note happened.`,
    tools,
    maxSteps: input.maxSteps ?? (representativeId !== null ? 4 : 2),
    logTag: `[star-context-agent:${input.context.id}:step-${input.atStep}]`,
  });
}
